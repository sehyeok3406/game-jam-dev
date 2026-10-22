import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../../contracts/project.ts';
import type {
  CollaborationProjectRepository,
  StoredProject,
} from '../../application/ports/collaboration-project-repository.ts';
import { migrate, assertSchema } from './migrations.ts';

/** One FULL WAL transaction commits blobs, metadata, history and request receipts. */
export class SqliteProjectStore<T extends StoredProject> {
  private db: DatabaseSync;
  private closed = false;
  private hashes = new Map<string, string>();
  constructor(filename: string, readOnly = false) {
    this.db = new DatabaseSync(filename, { readOnly });
    try {
      if (readOnly) assertSchema(this.db);
      else migrate(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
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
      if (this.tombstone(project.id) !== undefined)
        throw new Error('완전 삭제한 프로젝트는 다시 저장할 수 없습니다.');
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
  private decode(files: Snapshot): Snapshot {
    return Object.fromEntries(
      Object.entries(files).map(([relative, hash]) => {
        const row = this.db
          .prepare('SELECT value FROM blobs WHERE hash=?')
          .get(hash);
        if (!row || typeof row.value !== 'string')
          throw new Error('협업 저장소의 파일 사본이 누락되었습니다.');
        if (createHash('sha256').update(row.value).digest('hex') !== hash)
          throw new Error('협업 저장소의 파일 사본 해시가 일치하지 않습니다.');
        this.hashes.set(row.value, hash);
        return [relative, row.value];
      }),
    );
  }
  load(id?: string): T[] {
    const rows =
      id === undefined
        ? this.db.prepare('SELECT id, value FROM projects').all()
        : this.db.prepare('SELECT id, value FROM projects WHERE id=?').all(id);
    return rows.map((row) => {
      const value = JSON.parse(String(row.value));
      if (value.id !== row.id || this.tombstone(value.id) !== undefined)
        throw new Error('협업 저장소의 프로젝트 식별자가 올바르지 않습니다.');
      return {
        ...value,
        files: this.decode(value.files),
        history: value.history.map((entry: T['history'][number]) => ({
          ...entry,
          before: this.decode(entry.before),
          after: this.decode(entry.after),
        })),
      } as T;
    });
  }
  tombstone(id: string) {
    // A legacy read-only version 0 database may predate the tombstone table.
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_tombstones'",
        )
        .get()
    )
      return undefined;
    return this.db
      .prepare('SELECT version FROM project_tombstones WHERE id=?')
      .get(id)?.version as number | undefined;
  }
  purge(id: string, version: number) {
    this.tombstone(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO project_tombstones VALUES (?, ?)')
        .run(id, version);
      this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
      const referenced = new Set<string>();
      for (const row of this.db.prepare('SELECT value FROM projects').all()) {
        const value = JSON.parse(String(row.value));
        for (const files of [
          value.files,
          ...value.history.flatMap(
            (h: { before: Snapshot; after: Snapshot }) => [h.before, h.after],
          ),
        ])
          for (const hash of Object.values(files)) referenced.add(String(hash));
      }
      for (const row of this.db.prepare('SELECT hash FROM blobs').all())
        if (!referenced.has(String(row.hash)))
          this.db
            .prepare('DELETE FROM blobs WHERE hash=?')
            .run(String(row.hash));
      this.db.exec('COMMIT');
      this.hashes.clear();
      // Compaction is maintenance, not a reason to report a committed purge as failed.
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        /* WAL remains durable. */
      }
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  tombstones(): ReadonlyMap<string, number> {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_tombstones'",
        )
        .get()
    )
      return new Map();
    return new Map(
      this.db
        .prepare('SELECT id, version FROM project_tombstones')
        .all()
        .map((row) => [String(row.id), Number(row.version)]),
    );
  }
  metrics() {
    return {
      cachedBodies: this.hashes.size,
      cachedBodyBytes: [...this.hashes.keys()].reduce(
        (n, raw) => n + Buffer.byteLength(raw),
        0,
      ),
    };
  }
  async backup(destination: string) {
    await backup(this.db, destination);
  }
  publication(
    id: string,
  ): { name: string; revision: number; files: Snapshot } | null {
    const row = this.db
      .prepare('SELECT value FROM projects WHERE id=?')
      .get(id);
    if (!row || this.tombstone(id) !== undefined) return null;
    const project = JSON.parse(String(row.value));
    if (project.id !== id)
      throw new Error('협업 저장소의 프로젝트 식별자가 올바르지 않습니다.');
    if (
      !project ||
      (project.lifecycle && project.lifecycle.status !== 'active')
    )
      return null;
    return {
      name: project.name,
      revision: project.revision,
      files: this.decode(project.files),
    };
  }
  members(
    id: string,
  ): { members: { tokenHash: string; removed?: boolean }[] } | null {
    const row = this.db
      .prepare('SELECT value FROM projects WHERE id=?')
      .get(id);
    if (!row || this.tombstone(id) !== undefined) return null;
    const p = JSON.parse(String(row.value));
    if (p.id !== id || (p.lifecycle && p.lifecycle.status !== 'active'))
      return null;
    return {
      members: p.members.map((m: { tokenHash: string; removed?: boolean }) => ({
        tokenHash: m.tokenHash,
        removed: m.removed,
      })),
    };
  }
  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}

/** Async application boundary over synchronous, non-yielding SQLite transactions. */
export class SqliteProjectRepository<
  T extends StoredProject,
> implements CollaborationProjectRepository<T> {
  private store: SqliteProjectStore<T>;
  constructor(filename: string) {
    this.store = new SqliteProjectStore<T>(filename);
  }
  async loadAll() {
    return this.store.load();
  }
  async load(id: string) {
    return this.store.load(id)[0] ?? null;
  }
  async commit(project: T) {
    this.store.save(project);
  }
  async tombstone(id: string) {
    return this.store.tombstone(id);
  }
  async tombstones() {
    return this.store.tombstones();
  }
  async purge(id: string, version: number) {
    this.store.purge(id, version);
  }
  async close() {
    this.store.close();
  }
  async backup(destination: string) {
    await this.store.backup(destination);
  }
  metrics() {
    return this.store.metrics();
  }
}

/** Read-only projections never initialize/migrate a server database. */
export function readPublication(filename: string, id: string) {
  const store = new SqliteProjectStore(filename, true);
  try {
    return store.publication(id);
  } finally {
    store.close();
  }
}
export function readProjectMembers(filename: string, id: string) {
  const store = new SqliteProjectStore(filename, true);
  try {
    return store.members(id);
  } finally {
    store.close();
  }
}
