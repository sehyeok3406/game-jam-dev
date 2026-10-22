import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  SqliteProjectRepository,
  readPublication,
  readProjectMembers,
} from '../src/adapters/sqlite/project-repository.ts';
import { createCheckpointStore } from '../src/server/persistence/checkpoint-store.ts';
import { createLifecycleStore } from '../src/server/persistence/lifecycle-store.ts';
import { createProjectPersistence } from '../src/server/persistence/project-persistence.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const project = (id = randomUUID()) => ({
  id,
  name: '인공 구형 프로젝트',
  revision: 7,
  files: { 'project.md': '# 현재 원문', 'ideas/a.md': '한글 본문' },
  history: [
    {
      entry: { id: randomUUID(), revision: 7 },
      before: { 'ideas/a.md': '이전 본문' },
      after: { 'ideas/a.md': '한글 본문' },
    },
  ],
  members: [{ id: 'm', role: 'admin', tokenHash: '비공개 해시' }],
  recoveryHash: '비공개 복구',
  inviteHash: '비공개 초대',
  applied: [{ id: 'receipt', memberId: 'm', result: 9 }],
  job: null,
  lastRun: null,
  authorship: {},
  revisions: { 'project.md': 1, 'ideas/a.md': 7 },
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-r08-test-'));
  const cleanup = [];
  t.after(async () => {
    for (const close of cleanup) await close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, filename: path.join(root, 'sync.sqlite'), cleanup };
}
function legacy(filename, p) {
  const db = new DatabaseSync(filename);
  db.exec(
    'CREATE TABLE blobs(hash TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE projects(id TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  const encode = (files) =>
    Object.fromEntries(
      Object.entries(files).map(([key, raw]) => {
        db.prepare('INSERT OR IGNORE INTO blobs VALUES (?,?)').run(
          hash(raw),
          raw,
        );
        return [key, hash(raw)];
      }),
    );
  const row = JSON.stringify({
    ...p,
    files: encode(p.files),
    history: p.history.map((h) => ({
      ...h,
      before: encode(h.before),
      after: encode(h.after),
    })),
  });
  db.prepare('INSERT INTO projects VALUES (?,?)').run(p.id, row);
  db.close();
  return row;
}

test('legacy version 0 read-only projections expose only requested fields and never migrate', async (t) => {
  const { filename } = await fixture(t),
    p = project();
  legacy(filename, p);
  const bytes = await fs.readFile(filename);
  assert.deepEqual(readPublication(filename, p.id), {
    name: p.name,
    revision: p.revision,
    files: p.files,
  });
  assert.deepEqual(readProjectMembers(filename, p.id), {
    members: [{ tokenHash: p.members[0].tokenHash, removed: undefined }],
  });
  assert.equal(readPublication(filename, randomUUID()), null);
  assert.deepEqual(await fs.readFile(filename), bytes);
  const db = new DatabaseSync(filename, { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'")
      .get(),
    undefined,
  );
  db.close();
});

test('version 0 migrates once without rewriting JSON/blobs, commits receipts/history and reopens', async (t) => {
  const { filename } = await fixture(t),
    p = project(),
    original = legacy(filename, p);
  let repo = new SqliteProjectRepository(filename);
  assert.deepEqual(await repo.loadAll(), [p]);
  let db = new DatabaseSync(filename);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(
    db.prepare('SELECT value FROM projects WHERE id=?').get(p.id).value,
    original,
  );
  assert.equal(
    db.prepare('SELECT count(*) n FROM schema_migrations').get().n,
    1,
  );
  db.close();
  p.files['ideas/a.md'] = '차기 원문';
  p.revision++;
  p.applied.push({ id: '새 receipt', memberId: 'm', result: 10 });
  await repo.commit(p);
  await repo.close();
  repo = new SqliteProjectRepository(filename);
  assert.deepEqual(await repo.load(p.id), p);
  assert.equal(await repo.load('missing'), null);
  db = new DatabaseSync(filename);
  assert.equal(
    db.prepare('SELECT count(*) n FROM schema_migrations').get().n,
    1,
  );
  db.close();
  await repo.close();
});

test('future schemas fail before pragma/schema/data writes and release the connection', async (t) => {
  const { filename } = await fixture(t),
    p = project();
  legacy(filename, p);
  let db = new DatabaseSync(filename);
  db.exec('PRAGMA user_version=999');
  db.close();
  const bytes = await fs.readFile(filename);
  assert.throws(() => new SqliteProjectRepository(filename), /스키마.*999/);
  assert.throws(() => readPublication(filename, p.id), /스키마.*999/);
  assert.throws(() => readProjectMembers(filename, p.id), /스키마.*999/);
  await assert.rejects(
    createCollaborationServer({
      dataDirectory: path.dirname(filename),
      port: 0,
    }),
    /스키마.*999/,
  );
  assert.deepEqual(await fs.readFile(filename), bytes);
  assert.equal(await fs.stat(filename + '-wal').catch(() => null), null);
  db = new DatabaseSync(filename);
  db.exec('PRAGMA user_version=0');
  db.close();
  const repo = new SqliteProjectRepository(filename);
  await repo.close();
});

test('failed schema migration rolls back version and new tables, and can retry', async (t) => {
  const { filename } = await fixture(t);
  legacy(filename, project());
  const db = new DatabaseSync(filename);
  db.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TRIGGER block_migration BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT, 'migration-abort'); END",
  );
  assert.throws(() => new SqliteProjectRepository(filename), /migration-abort/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='project_tombstones'")
      .get(),
    undefined,
  );
  db.exec('DROP TRIGGER block_migration');
  db.close();
  const repo = new SqliteProjectRepository(filename);
  await repo.close();
});

test('commit abort rolls back blobs/project/history/receipt and clears body hash cache for retry', async (t) => {
  const { filename } = await fixture(t),
    p = project(),
    repo = new SqliteProjectRepository(filename);
  await repo.commit(p);
  const db = new DatabaseSync(filename),
    before = db.prepare('SELECT value FROM projects').get().value;
  const count = db.prepare('SELECT count(*) n FROM blobs').get().n;
  db.exec(
    "CREATE TRIGGER block_commit BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'commit-abort'); END",
  );
  const next = structuredClone(p);
  next.files['new.md'] = '트랜잭션 신규';
  next.history.push({ before: {}, after: { 'new.md': '트랜잭션 신규' } });
  next.applied.push({ id: 'same-id' });
  await assert.rejects(repo.commit(next), /commit-abort/);
  assert.equal(db.prepare('SELECT value FROM projects').get().value, before);
  assert.equal(db.prepare('SELECT count(*) n FROM blobs').get().n, count);
  db.exec('DROP TRIGGER block_commit');
  db.close();
  await repo.commit(next);
  await repo.close();
  const reopened = new SqliteProjectRepository(filename);
  assert.deepEqual(await reopened.load(p.id), next);
  await reopened.close();
});

test('two repository connections and independent project queues preserve both commits and isolated rollback', async (t) => {
  const { filename } = await fixture(t),
    a = new SqliteProjectRepository(filename),
    b = new SqliteProjectRepository(filename);
  const first = project(),
    second = project(),
    queue = new ProjectQueue();
  const db = new DatabaseSync(filename);
  db.exec(
    `CREATE TRIGGER fail_one BEFORE INSERT ON projects WHEN NEW.id='${first.id}' BEGIN SELECT RAISE(ABORT, 'one-abort'); END`,
  );
  const results = await Promise.allSettled([
    queue.run(first.id, () => a.commit(first)),
    queue.run(second.id, () => b.commit(second)),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(await a.load(first.id), null);
  assert.deepEqual(await a.load(second.id), second);
  db.exec('DROP TRIGGER fail_one');
  db.close();
  await queue.run(first.id, () => a.commit(first));
  assert.equal((await b.loadAll()).length, 2);
  await a.close();
  await b.close();
});

test('missing and corrupt blobs (including history-only bodies) fail closed instead of dropping content', async (t) => {
  for (const action of [
    'DELETE FROM blobs WHERE hash=?',
    "UPDATE blobs SET value='破損' WHERE hash=?",
  ]) {
    const { filename } = await fixture(t),
      p = project();
    legacy(filename, p);
    const db = new DatabaseSync(filename);
    db.prepare(action).run(hash('이전 본문'));
    db.close();
    const repo = new SqliteProjectRepository(filename);
    await assert.rejects(repo.loadAll(), /사본/);
    // Publication intentionally reads only current files, without decoding private history.
    assert.deepEqual(readPublication(filename, p.id).files, p.files);
    await repo.close();
  }
});

test('purge atomically commits tombstone, keeps referenced blobs and forbids stale-ID resurrection', async (t) => {
  const { filename } = await fixture(t),
    a = project(),
    b = project(),
    repo = new SqliteProjectRepository(filename);
  a.files['only-a.md'] = '지울 본문';
  await repo.commit(a);
  await repo.commit(b);
  const db = new DatabaseSync(filename);
  db.exec(
    "CREATE TRIGGER block_purge BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'purge-abort'); END",
  );
  await assert.rejects(repo.purge(a.id, 3), /purge-abort/);
  assert.equal(await repo.tombstone(a.id), undefined);
  assert.deepEqual(await repo.load(a.id), a);
  db.exec('DROP TRIGGER block_purge');
  await repo.purge(a.id, 3);
  assert.equal(await repo.load(a.id), null);
  assert.equal(await repo.tombstone(a.id), 3);
  assert.equal((await repo.tombstones()).get(a.id), 3);
  assert.equal(
    db.prepare('SELECT value FROM blobs WHERE hash=?').get(hash('지울 본문')),
    undefined,
  );
  assert.deepEqual(await repo.load(b.id), b);
  await assert.rejects(repo.commit(a), /완전 삭제/);
  assert.equal(readPublication(filename, a.id), null);
  db.close();
  await repo.close();
});

async function persistenceFixture(t) {
  const f = await fixture(t),
    repository = new SqliteProjectRepository(f.filename),
    projects = new Map(),
    notices = [],
    errors = [];
  const checkpoints = createCheckpointStore(f.root),
    lifecycle = await createLifecycleStore(f.root);
  const persistence = createProjectPersistence({
    repository,
    projects,
    checkpoints,
    lifecycle,
    committed: (id) => notices.push(id),
    recoveryError: (id, phase) => errors.push({ id, phase }),
  });
  f.cleanup.push(() => repository.close());
  return {
    ...f,
    repository,
    projects,
    checkpoints,
    lifecycle,
    persistence,
    notices,
    errors,
  };
}

test('first checkpoint/runtime export failure keeps the DB commit and receipt published, then flush repairs it', async (t) => {
  const f = await persistenceFixture(t),
    p = project();
  await fs.mkdir(path.join(f.root, p.id));
  await fs.mkdir(path.join(f.root, p.id, 'runtime.tmp'));
  await f.persistence.persist(p);
  assert.deepEqual(await f.repository.load(p.id), p);
  assert.equal(f.projects.get(p.id), p);
  assert.deepEqual(f.notices, [p.id]);
  assert.deepEqual(f.errors, [{ id: p.id, phase: 'checkpoint' }]);
  await fs.rmdir(path.join(f.root, p.id, 'runtime.tmp'));
  await f.persistence.flush();
  assert.deepEqual(await f.checkpoints.recover(p.id), {
    ...p,
    createdAt: (await f.checkpoints.recover(p.id)).createdAt,
    modifiedAt: (await f.checkpoints.recover(p.id)).modifiedAt,
  });
  assert.equal(f.persistence.failures().size, 0);
});

test('head export failure and lifecycle marker failure cannot undo the durable active/trashed result', async (t) => {
  const f = await persistenceFixture(t),
    p = project();
  p.lifecycle = { status: 'active', version: 1 };
  await fs.writeFile(path.join(f.root, '.project-lifecycle'), 'blocked');
  await fs.mkdir(path.join(f.root, p.id, 'head.json'), { recursive: true });
  await f.persistence.persist(p);
  await assert.rejects(f.persistence.exportCheckpoint(p));
  assert.deepEqual(await f.repository.load(p.id), p);
  assert.equal(f.lifecycle.pending(), 1);
  await fs.unlink(path.join(f.root, '.project-lifecycle'));
  await fs.rmdir(path.join(f.root, p.id, 'head.json'));
  await f.persistence.flush();
  assert.equal(f.lifecycle.pending(), 0);
  const trashed = structuredClone(p);
  trashed.lifecycle.status = 'trashed';
  await f.persistence.persist(trashed);
  assert.equal(readPublication(f.filename, p.id), null);
  assert.equal(readProjectMembers(f.filename, p.id), null);
  assert.equal(f.projects.get(p.id).lifecycle.status, 'trashed');
});

test('failed DB commit emits no recovery files or success and keeps the current project intact', async (t) => {
  const f = await persistenceFixture(t),
    p = project();
  await f.persistence.persist(p);
  const before = await fs.readFile(
    path.join(f.root, p.id, 'runtime.json'),
    'utf8',
  );
  const next = structuredClone(p);
  next.revision++;
  next.files['new.md'] = '신규';
  const db = new DatabaseSync(f.filename);
  db.exec(
    "CREATE TRIGGER block_write BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'db-abort'); END",
  );
  await assert.rejects(f.persistence.persist(next), /db-abort/);
  assert.equal(f.projects.get(p.id), p);
  assert.deepEqual(f.notices, [p.id]);
  assert.equal(
    await fs.readFile(path.join(f.root, p.id, 'runtime.json'), 'utf8'),
    before,
  );
  db.close();
});

test('checkpoint/runtime jobs serialize across a timer export and a newer project commit', async (t) => {
  const f = await persistenceFixture(t),
    p = project();
  await f.persistence.persist(p);
  const next = structuredClone(p);
  next.revision++;
  next.files['new.md'] = '차기';
  await Promise.all([
    f.persistence.exportCheckpoint(p),
    f.persistence.persist(next),
  ]);
  await f.persistence.flush();
  assert.equal((await f.checkpoints.recover(p.id)).revision, next.revision);
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(f.root, p.id, 'runtime.json'), 'utf8'),
    ).revision,
    next.revision,
  );
});

test('lifecycle retries cannot overwrite a newer marker and checkpoint recovery rejects another project ID', async (t) => {
  const { root } = await fixture(t),
    lifecycle = await createLifecycleStore(root),
    id = randomUUID();
  await Promise.all([
    lifecycle.save(id, 'trashing', 1),
    lifecycle.flush(),
    lifecycle.save(id, 'purged', 2),
  ]);
  await lifecycle.flush();
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(root, '.project-lifecycle', id + '.json'),
        'utf8',
      ),
    ),
    { status: 'purged', version: 2 },
  );
  const checkpoints = createCheckpointStore(root),
    p = project(id);
  await checkpoints.write(p);
  const head = JSON.parse(
    await fs.readFile(path.join(root, id, 'head.json'), 'utf8'),
  );
  await fs.writeFile(
    path.join(root, id, 'checkpoints', head.checkpoint, 'state.json'),
    JSON.stringify(project()),
  );
  await assert.rejects(checkpoints.recover(id), /식별자/);
});

test('publication fails on missing or corrupt current blobs instead of exporting partial contents', async (t) => {
  for (const sql of [
    'DELETE FROM blobs WHERE hash=?',
    "UPDATE blobs SET value='corrupt' WHERE hash=?",
  ]) {
    const { filename } = await fixture(t),
      p = project();
    legacy(filename, p);
    const db = new DatabaseSync(filename);
    db.prepare(sql).run(hash('한글 본문'));
    db.close();
    assert.throws(() => readPublication(filename, p.id), /사본/);
  }
});
