import { ServerLimits } from '../../contracts/server-limits.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { Project, Member } from '../project-state.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import { CANVAS_SHEETS_PATH } from '../../canvas-sheets.ts';
import { ApiError } from './errors.ts';
import { planOfflineChanges } from './offline-changes.ts';

type Ports = {
  editable: (project: Project, member: Member) => void;
  assertAiMutation: (project: Project, after: Snapshot) => void;
  assertBases: (
    project: Project,
    before: Snapshot,
    after: Snapshot,
    revisions: Record<string, number>,
    member: Member,
  ) => void;
  clone: (project: Project) => Project;
  recordChanges: (
    project: Project,
    member: Member,
    files: Snapshot,
    label: string,
  ) => void;
  persist: (project: Project) => Promise<void>;
  envelope: (project: Project, member: Member) => CollaborationEnvelope;
};
/** Called inside the existing project queue with its current authenticated actor.
 * Common ingress, lifecycle and capability gates stay at that queued entry point.
 */
export function createOfflineSyncService(ports: Ports) {
  async function execute(
    project: Project,
    member: Member,
    input: Record<string, unknown>,
  ) {
    if (project.files[CANVAS_SHEETS_PATH] && input.canvasSheetsVersion !== 1)
      throw new ApiError(
        '캔버스가 있는 프로젝트를 동기화하려면 앱을 v0.11.0 이상으로 업데이트해주세요.',
      );
    const operationId = input.id;
    if (typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(operationId))
      throw new ApiError('동기화 작업 ID가 올바르지 않습니다.', 400);
    const applied = project.applied.find((item) => item.id === operationId);
    if (applied) {
      if (applied.memberId !== member.id)
        throw new ApiError('작업 ID가 충돌했습니다.');
      return ports.envelope(project, member);
    }
    ports.editable(project, member);
    const nextFiles = planOfflineChanges(project.files, input);
    ports.assertAiMutation(project, nextFiles);
    ports.assertBases(
      project,
      project.files,
      nextFiles,
      input.revisions as Record<string, number>,
      member,
    );
    const next = ports.clone(project);
    ports.recordChanges(next, member, nextFiles, '오프라인 작업 동기화');
    next.applied.push({
      id: operationId,
      memberId: member.id,
      result: null,
    });
    next.applied = next.applied.slice(-ServerLimits.receipts);
    await ports.persist(next);
    return ports.envelope(next, member);
  }
  return { execute };
}
