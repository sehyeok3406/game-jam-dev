import type { CanvasDocument } from '../../contracts/documents.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { HistoryEntry } from '../../contracts/history.ts';

export interface LocalProjectRepository {
  capture(paths?: string[]): Promise<Snapshot>;
  apply(
    before: Snapshot,
    changes: Record<string, string | null>,
    cancelled?: () => boolean,
  ): Promise<void>;
  history(): Promise<HistoryEntry[]>;
  readHistory(
    id: string,
    relative: string,
    version: 'before' | 'after',
  ): Promise<string | null>;
  restoreHistory(
    id: string,
    relative?: string,
    version?: 'before' | 'after',
  ): Promise<unknown>;
  saveHistory(
    before: Snapshot,
    after: Snapshot,
    entry: Omit<HistoryEntry, 'files'>,
  ): Promise<HistoryEntry>;
  recover(): Promise<unknown>;
}

export type StoredDocument = {
  document: CanvasDocument;
  raw: string;
  storedTitle: unknown;
};
export interface DocumentRepository {
  asset(relative: string): Promise<string>;
  read(relativePath: string): Promise<StoredDocument>;
  patchMetadata(
    relativePath: string,
    expected: string,
    changes: Record<string, unknown>,
  ): Promise<CanvasDocument>;
  replace(
    relativePath: string,
    expected: string,
    content: { title: string; body: string },
  ): Promise<CanvasDocument>;
}
