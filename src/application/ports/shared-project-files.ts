import type { Snapshot } from '../../contracts/project.ts';

export type ProjectFileEffects = {
  pauseWatcher(): Promise<() => Promise<void>>;
  trashItem(absolute: string): Promise<void>;
};
export interface SharedProjectFiles {
  ensure(snapshot?: Snapshot): Promise<void>;
  capture(): Promise<Snapshot>;
  move(
    before: Snapshot,
    after: Snapshot,
  ): Promise<{
    baseline: Snapshot;
    rollback(): Promise<void>;
    finish(): Promise<void>;
  }>;
  apply(
    before: Snapshot,
    changes: Record<string, string | null>,
  ): Promise<void>;
  trash(before: Snapshot, after: Snapshot): Promise<void>;
  cleanup(before: Snapshot, after: Snapshot): Promise<void>;
}
