import { ServerLimits } from '../../contracts/server-limits.ts';
import type { Project, Member } from '../project-state.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { HistoryEntry } from '../../shared.ts';
import {
  initializeWorkflows,
  assertWorkflowReferences,
} from '../../document-workflow.ts';
import { advanceProperties } from '../../sync-properties.ts';
import { withTaskHistory } from '../../ai-task-history.ts';
import { advanceAuthorship } from '../../file-authorship.ts';
/** Prepare candidate history/revisions/authorship; caller owns clone/commit/publication. */
export function createProjectHistoryWriter(ports: {
  now: () => number;
  id: () => string;
}) {
  const recordChanges = (
    project: Project,
    member: Member,
    after: Snapshot,
    label: string,
    kind: HistoryEntry['kind'] = 'user',
    extra: Partial<HistoryEntry> = {},
  ) => {
    // Reducers initialize explicit creations. Undo/restore must reproduce exact stored metadata.
    if (kind === 'ai') after = initializeWorkflows(project.files, after, true);
    assertWorkflowReferences(after, project.files);
    const touched = Object.keys({ ...project.files, ...after }).filter(
      (relative) => project.files[relative] !== after[relative],
    );
    const beforeFiles: Snapshot = {},
      afterFiles: Snapshot = {};
    for (const relative of touched) {
      if (project.files[relative] !== undefined)
        beforeFiles[relative] = project.files[relative];
      if (after[relative] !== undefined) afterFiles[relative] = after[relative];
      project.revisions[relative] = (project.revisions[relative] ?? 0) + 1;
    }
    project.revision++;
    project.propertyVersions = advanceProperties(
      project.propertyVersions ?? {},
      project.files,
      after,
      project.revision,
    );
    project.modifiedAt = ports.now();
    project.history.push({
      entry: withTaskHistory(
        {
          id: ports.id(),
          label,
          kind,
          status: 'completed',
          createdAt: ports.now(),
          finishedAt: ports.now(),
          actorId: member.id,
          actorName: member.nickname,
          action: label,
          revision: project.revision,
          files: touched.map((relativePath) => ({
            relativePath,
            before: beforeFiles[relativePath] !== undefined,
            after: afterFiles[relativePath] !== undefined,
          })),
          ...extra,
        },
        project.files,
        after,
      ),
      before: beforeFiles,
      after: afterFiles,
    });
    project.authorship = advanceAuthorship(
      project.authorship,
      beforeFiles,
      afterFiles,
      {
        ...project.history.at(-1)!.entry,
        // Failed AI runs may still commit a task status, but never their outputs.
        status: 'completed',
      },
    );
    project.history = project.history.slice(-ServerLimits.history);
    project.files = after;
  };
  return recordChanges;
}
