import type { Snapshot } from '../../contracts/project.ts';
import type { PropertyVersions } from '../../contracts/sync-properties.ts';
import type { FileAuthorshipMap } from '../../contracts/documents.ts';
import type { CommandName } from '../../contracts/commands.ts';
import type { CanvasViewChanges } from '../../contracts/canvas-view.ts';

export type SharedProjectView = {
  files: Snapshot;
  revisions: Record<string, number>;
  properties: PropertyVersions;
  authorship: FileAuthorshipMap;
};
export interface SharedEditingProject {
  read(): SharedProjectView;
  command(
    channel: CommandName,
    input: unknown,
  ): Promise<{ result: unknown; historyId: string | null }>;
  changeHistory(id: string, direction: 'undo' | 'redo'): Promise<unknown>;
}
export interface SharedCanvasView {
  read(
    files: Snapshot,
    revisions: Record<string, number>,
    properties: PropertyVersions,
    collapsed: Map<string, boolean>,
    known: Record<string, string>,
  ): CanvasViewChanges;
}
