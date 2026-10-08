import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Snapshot } from './project-store.ts';

type Stored = {
  id: string;
  files: Snapshot;
  history: { before: Snapshot; after: Snapshot }[];
};
/** One FULL WAL transaction commits blobs, metadata, history and request receipts. */
export class SyncStore<T extends Stored> {
  private db: DatabaseSync;
  private hashes = new Map<string, string>();
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, value TEXT NOT NULL);',
    );
  }
  private encode(files: Snapshot) {
    return Object.fromEntries(
      Object.entries(files).map(([relative, raw]) => {
        let hash = this.hashes.get(raw);
        if (!hash) {
          hash = createHash('sha256').update(raw).digest('hex');
          this.db
            .prepare('INSERT OR IGNORE INTO blobs VALUES (?, ?)')
            .run(hash, raw);
          this.hashes.set(raw, hash);
        }
        return [relative, hash];
      }),
    );
  }
  save(project: T) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = {
        ...project,
        files: this.encode(project.files),
        history: project.history.map((entry) => ({
          ...entry,
          before: this.encode(entry.before),
          after: this.encode(entry.after),
        })),
      };
      this.db
        .prepare(
          'INSERT INTO projects VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
        )
        .run(project.id, JSON.stringify(value));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.hashes.clear();
      throw error;
    }
  }
  load(): T[] {
    const decode = (files: Snapshot) =>
      Object.fromEntries(
        Object.entries(files).map(([relative, hash]) => {
          const row = this.db
            .prepare('SELECT value FROM blobs WHERE hash=?')
            .get(hash);
          if (!row || typeof row.value !== 'string')
            throw new Error('협업 저장소의 파일 사본이 누락되었습니다.');
          this.hashes.set(row.value, hash);
          return [relative, row.value];
        }),
      );
    return this.db
      .prepare('SELECT value FROM projects')
      .all()
      .map((row) => {
        const value = JSON.parse(String(row.value));
        return {
          ...value,
          files: decode(value.files),
          history: value.history.map((entry: T['history'][number]) => ({
            ...entry,
            before: decode(entry.before),
            after: decode(entry.after),
          })),
        } as T;
      });
  }
  close() {
    this.db.close();
  }
}

/** Read the committed source for host publication, without exposing session metadata. */
export function readSyncFiles(
  filename: string,
  id: string,
): { name: string; revision: number; files: Snapshot } | null {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const row = db.prepare('SELECT value FROM projects WHERE id=?').get(id);
    if (!row) return null;
    const project = JSON.parse(String(row.value));
    const files: Snapshot = {};
    for (const [relative, hash] of Object.entries(project.files)) {
      const blob = db
        .prepare('SELECT value FROM blobs WHERE hash=?')
        .get(String(hash));
      if (!blob || typeof blob.value !== 'string')
        throw new Error('협업 자료 복구가 필요합니다.');
      files[relative] = blob.value;
    }
    return { name: project.name, revision: project.revision, files };
  } finally {
    db.close();
  }
}
