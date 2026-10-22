import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;
export function assertSchema(db: DatabaseSync) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (!Number.isSafeInteger(version) || version < 0 || version > SCHEMA_VERSION)
    throw new Error(`지원하지 않는 협업 저장소 스키마입니다: ${version}`);
  return version;
}

/** Version 0 uses the same blobs/project JSON. No user content is rewritten. */
export function migrate(db: DatabaseSync) {
  const version = assertSchema(db); // Before any pragma/table/file mutation.
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
  if (version === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_tombstones(id TEXT PRIMARY KEY, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
      PRAGMA user_version=1;
    `);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
