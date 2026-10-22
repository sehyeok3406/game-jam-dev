import type { Snapshot } from '../../contracts/project.ts';

/** Existing JSON shape; each commit includes files, history and request receipts. */
export type StoredProject = {
  id: string;
  files: Snapshot;
  history: { before: Snapshot; after: Snapshot }[];
};

/** A commit resolves at the DB boundary, independently of recovery file export.
 * The caller still owns project queues. Implementations must not await external
 * work inside a transaction. A purged ID must never become writable again.
 */
export interface CollaborationProjectRepository<T extends StoredProject> {
  loadAll(): Promise<T[]>;
  load(id: string): Promise<T | null>;
  commit(project: T): Promise<void>;
  tombstone(id: string): Promise<number | undefined>;
  tombstones(): Promise<ReadonlyMap<string, number>>;
  purge(id: string, version: number): Promise<void>;
  close(): Promise<void>;
}
