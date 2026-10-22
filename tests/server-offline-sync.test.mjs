import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import matter from '../src/markdown.ts';
import { createOfflineSyncService } from '../src/server/services/offline-sync-service.ts';
import { planOfflineChanges } from '../src/server/services/offline-changes.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { assertAiMutation, mergeAiFileLocks } from '../src/ai-file-lock.ts';
import { queueFileLock } from '../src/ai-task-queue.ts';
import { advanceProperties } from '../src/sync-properties.ts';
import { CANVAS_SHEETS_PATH } from '../src/canvas-sheets.ts';
import { sourceMetadata, htmlSourcePath } from '../src/html-source.ts';
import { SyncStore } from '../src/sync-store.ts';

const doc = (id, body = '원본', patch = {}) =>
  matter.stringify(body, {
    id,
    title: id,
    type: 'idea',
    sources: [],
    x: 10,
    y: 20,
    ...patch,
  });
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const html = '<h1>보존할 원본 HTML</h1>',
  htmlPath = 'output/index.html',
  metaPath = htmlSourcePath(htmlPath);
function fixture(options = {}) {
  let current = options.project ?? {
    id: randomUUID(),
    name: '오프라인 검증',
    revision: 1,
    files: { 'ideas/a.md': doc('a'), 'ideas/b.md': doc('b') },
    revisions: { 'ideas/a.md': 1, 'ideas/b.md': 1 },
    propertyVersions: {},
    history: [],
    applied: [],
    job: null,
    authorship: {},
    members: [
      { id: 'editor', nickname: '팀원', role: 'editor', tokenHash: 'editor' },
      {
        id: 'other',
        nickname: '다른 팀원',
        role: 'editor',
        tokenHash: 'other',
      },
      { id: 'viewer', nickname: '뷰어', role: 'viewer', tokenHash: 'viewer' },
    ],
  };
  const queue = new ProjectQueue(),
    locks = new Map(),
    notices = [],
    calls = [];
  const policy = createAccessPolicy({
    matches: (a, b) => a === b,
    now: () => 1000,
    seen: () => {},
    locks: () => locks,
  });
  const service = createOfflineSyncService({
    editable: policy.editable,
    assertBases: policy.assertBases,
    assertAiMutation: (p, after) =>
      assertAiMutation(
        mergeAiFileLocks([p.job?.fileLock, queueFileLock(p.aiQueue ?? [])]),
        p.files,
        after,
      ),
    clone: structuredClone,
    recordChanges: (p, m, files, label) => {
      calls.push('record');
      const before = p.files,
        changed = Object.keys({ ...before, ...files }).filter(
          (key) => before[key] !== files[key],
        );
      p.revision++;
      p.propertyVersions = advanceProperties(
        p.propertyVersions ?? {},
        before,
        files,
        p.revision,
      );
      for (const key of changed) p.revisions[key] = (p.revisions[key] ?? 0) + 1;
      p.history.push({
        entry: {
          id: randomUUID(),
          actorId: m.id,
          label,
          kind: 'user',
          status: 'completed',
          files: changed.map((relativePath) => ({ relativePath })),
        },
        before: { ...before },
        after: { ...files },
      });
      p.files = files;
    },
    persist: async (p) => {
      calls.push('persist');
      await options.beforeCommit?.(p);
      options.store?.save(p);
      current = p;
      notices.push(p.revision);
    },
    envelope: (p) => ({
      files: p.files,
      revisions: p.revisions,
      state: { revision: p.revision },
    }),
  });
  const input = (patch = {}) => ({
    id: randomUUID(),
    changes: { 'ideas/a.md': doc('a', '오프라인 수정') },
    revisions: { ...current.revisions },
    canvasSheetsVersion: 1,
    ...patch,
  });
  const run = (payload, token = 'editor') =>
    queue.run(current.id, () =>
      service.execute(current, policy.authenticate(current, token), payload),
    );
  return {
    service,
    input,
    run,
    queue,
    locks,
    notices,
    calls,
    get current() {
      return current;
    },
  };
}

test('offline snapshot planning is pure and supports atomic create/update/delete with Unicode contents', () => {
  const f = fixture(),
    before = structuredClone(f.current.files),
    after = planOfflineChanges(f.current.files, {
      changes: {
        'ideas/a.md': doc('a', '한글\n두 번째 줄'),
        'ideas/b.md': null,
        'docs/새 문서.md': doc('new', '신규 문서'),
      },
    });
  assert.deepEqual(f.current.files, before);
  assert.equal(after['ideas/b.md'], undefined);
  assert.equal(matter(after['ideas/a.md']).content, '한글\n두 번째 줄\n');
  assert.ok(after['docs/새 문서.md']);
});

test('offline changes require a nonempty object of at most 500 entries and string/null values', () => {
  const f = fixture(),
    before = structuredClone(f.current.files);
  for (const changes of [
    undefined,
    null,
    [],
    0,
    'text',
    {},
    Object.fromEntries(
      Array.from({ length: 501 }, (_, n) => [`ideas/${n}.md`, null]),
    ),
    { 'ideas/a.md': false },
    { 'ideas/a.md': 42 },
    { 'ideas/a.md': { body: '잘못된 값' } },
  ]) {
    assert.throws(() => planOfflineChanges(f.current.files, { changes }), {
      status: 400,
    });
    assert.deepEqual(f.current.files, before);
  }
  const after = planOfflineChanges(
    {},
    {
      changes: Object.fromEntries(
        Array.from({ length: 500 }, (_, n) => [`ideas/${n}.md`, `문서 ${n}`]),
      ),
    },
  );
  assert.equal(Object.keys(after).length, 500);
});

test('offline planning rejects unsafe paths and an invalid final snapshot without mutating any file', () => {
  const f = fixture(),
    before = structuredClone(f.current.files);
  for (const key of [
    '../project.md',
    'C:/private.md',
    'ideas/../secret.md',
    'ideas/back\\slash.md',
    '.env',
    'ideas/a..md',
  ])
    assert.throws(() =>
      planOfflineChanges(f.current.files, {
        changes: { 'ideas/a.md': doc('a', '먼저 처리'), [key]: '금지' },
      }),
    );
  assert.throws(
    () =>
      planOfflineChanges(f.current.files, {
        changes: { 'ideas/c.md': doc('a', 'ID 중복') },
      }),
    /ID가 중복/,
  );
  assert.throws(
    () =>
      planOfflineChanges(f.current.files, {
        changes: { 'ideas/A.md': doc('A') },
      }),
    /대소문자/,
  );
  assert.deepEqual(f.current.files, before);
});

test('offline planning rejects task, canvas and result writes/deletes even when the caller is trusted', () => {
  const f = fixture();
  for (const key of [
    '.ai/tasks/new.md',
    CANVAS_SHEETS_PATH,
    'output/index.html',
    'output/README.md',
  ])
    for (const value of ['덮어쓰기', null])
      assert.throws(
        () =>
          planOfflineChanges(f.current.files, { changes: { [key]: value } }),
        { status: 403 },
      );
});

test('offline HTML metadata permits only an existing workflow change and preserves HTML/source identity', () => {
  const files = {
      [htmlPath]: html,
      [metaPath]: sourceMetadata(htmlPath, html, {}, () => 1000),
    },
    parsed = matter(files[metaPath]);
  const changed = matter.stringify(parsed.content, {
    ...parsed.data,
    workflow_status_id: 'done',
    workflow_order: 2,
    status_property_enabled: true,
  });
  const after = planOfflineChanges(files, { changes: { [metaPath]: changed } });
  assert.equal(after[htmlPath], html);
  assert.equal(matter(after[metaPath]).data.html_source, htmlPath);
  assert.equal(matter(after[metaPath]).data.workflow_status_id, 'done');
  for (const value of [
    null,
    files[metaPath],
    matter.stringify('다른 본문', {
      ...parsed.data,
      workflow_status_id: 'done',
    }),
    matter.stringify(parsed.content, { ...parsed.data, id: 'changed' }),
    matter.stringify(parsed.content, {
      ...parsed.data,
      html_source: 'output/versions/v1.html',
    }),
  ])
    assert.throws(
      () => planOfflineChanges(files, { changes: { [metaPath]: value } }),
      { status: 403 },
    );
  assert.throws(
    () => planOfflineChanges({}, { changes: { [metaPath]: changed } }),
    { status: 403 },
  );
});

test('offline commit returns only after persistence and preserves current files/history/receipts while waiting', async () => {
  const gate = defer(),
    entered = defer(),
    f = fixture({
      beforeCommit: async () => {
        entered.resolve();
        await gate.promise;
      },
    }),
    before = structuredClone(f.current);
  let completed = false;
  const pending = f.run(f.input()).then((result) => {
    completed = true;
    return result;
  });
  await entered.promise;
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  assert.equal(completed, false);
  gate.resolve();
  const result = await pending;
  assert.equal(result.state.revision, 2);
  assert.equal(f.current.history[0].entry.label, '오프라인 작업 동기화');
  assert.equal(f.current.history[0].entry.actorId, 'editor');
  assert.equal(f.current.applied[0].result, null);
  assert.deepEqual(f.calls, ['record', 'persist']);
  assert.deepEqual(f.notices, [2]);
});

test('offline same-ID concurrent replay writes once; another actor cannot reuse the receipt', async () => {
  const f = fixture(),
    payload = f.input();
  const [first, replay] = await Promise.all([f.run(payload), f.run(payload)]);
  assert.deepEqual(replay, first);
  assert.equal(f.current.history.length, 1);
  assert.equal(f.current.applied.length, 1);
  assert.equal(f.notices.length, 1);
  await assert.rejects(f.run(payload, 'other'), /작업 ID가 충돌/);
  assert.equal(f.notices.length, 1);
});

test('offline receipt replay retains old precedence over new edit permissions and payload validation', async () => {
  const f = fixture(),
    payload = f.input();
  await f.run(payload);
  f.current.members[0].role = 'viewer';
  const replay = await f.run({ ...payload, changes: null });
  assert.equal(replay.state.revision, 2);
  assert.equal(f.current.history.length, 1);
  await assert.rejects(f.run(f.input()), { status: 403 });
  f.current.members[0].removed = true;
  await assert.rejects(f.run(payload), { status: 403 });
});

test('offline canvas capability and operation ID validation still run before receipt replay', async () => {
  const f = fixture(),
    payload = f.input();
  await f.run(payload);
  f.current.files[CANVAS_SHEETS_PATH] = 'present';
  await assert.rejects(
    f.run({ ...payload, canvasSheetsVersion: 0 }),
    /업데이트/,
  );
  delete f.current.files[CANVAS_SHEETS_PATH];
  for (const id of [undefined, 'bad', '../escape', 123])
    await assert.rejects(f.run({ ...payload, id }), { status: 400 });
  assert.equal(f.current.history.length, 1);
});

test('offline multi-file revision conflict rejects the whole batch and corrected same-ID retry succeeds', async () => {
  const f = fixture(),
    payload = f.input({
      changes: { 'ideas/a.md': doc('a', '수정'), 'ideas/b.md': null },
      revisions: { 'ideas/a.md': 1, 'ideas/b.md': 0 },
    }),
    before = structuredClone(f.current);
  await assert.rejects(f.run(payload), /다른 참여자가 변경/);
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  await f.run({ ...payload, revisions: { ...f.current.revisions } });
  assert.equal(f.current.files['ideas/b.md'], undefined);
  assert.equal(f.current.revisions['ideas/b.md'], 2);
  assert.equal(f.current.applied[0].id, payload.id);
});

test('offline foreign content lock blocks publication while an owned lock permits it', async () => {
  const f = fixture(),
    payload = f.input();
  f.locks.set('ideas/a.md', { memberId: 'other' });
  await assert.rejects(f.run(payload), /편집 중/);
  assert.deepEqual(f.notices, []);
  f.locks.set('ideas/a.md', { memberId: 'editor' });
  await f.run(payload);
  assert.equal(f.current.revision, 2);
});

test('offline property metadata still requires file revisions and can preserve another actors content lock', async () => {
  const f = fixture();
  f.current.propertySync = true;
  f.locks.set('ideas/a.md', { memberId: 'other' });
  const payload = f.input({
    changes: { 'ideas/a.md': doc('a', '원본', { x: 90 }) },
    revisions: { 'ideas/a.md': 0 },
  });
  await assert.rejects(f.run(payload), /다른 참여자가 변경/);
  payload.revisions['ideas/a.md'] = 1;
  await f.run(payload);
  assert.equal(matter(f.current.files['ideas/a.md']).data.x, 90);
  assert.equal(matter(f.current.files['ideas/a.md']).content, '원본\n');
});

test('offline publication enforces both scoped AI execution and queued material protection', async () => {
  for (const source of ['job', 'queue']) {
    const f = fixture(),
      lock = { paths: ['ideas/a.md'], folders: [] };
    if (source === 'job') f.current.job = { fileLock: lock };
    else f.current.aiQueue = [{ status: 'queued', fileLock: lock }];
    await assert.rejects(f.run(f.input()), /AI|잠겨/);
    assert.deepEqual(f.notices, []);
    await f.run(
      f.input({ changes: { 'ideas/b.md': doc('b', '별도 문서 수정') } }),
    );
    assert.equal(f.current.revision, 2);
  }
  const f = fixture();
  f.current.job = { id: 'legacy' };
  await assert.rejects(f.run(f.input()), /AI 작업/);
  assert.deepEqual(f.notices, []);
});

test('offline queued publication rechecks current role/revocation/revision after the earlier operation', async () => {
  for (const kind of ['role', 'revoked', 'revision']) {
    const f = fixture(),
      payload = f.input(),
      gate = defer();
    const prior = f.queue.run(f.current.id, async () => {
      await gate.promise;
      if (kind === 'role') f.current.members[0].role = 'viewer';
      else if (kind === 'revoked') f.current.members[0].removed = true;
      else {
        f.current.files['ideas/a.md'] = doc('a', '서버 수정');
        f.current.revisions['ideas/a.md'] = 2;
      }
    });
    const rejected = assert.rejects(
      f.run(payload),
      kind === 'revision' ? /다른 참여자가 변경/ : { status: 403 },
    );
    gate.resolve();
    await Promise.all([prior, rejected]);
    assert.deepEqual(f.notices, []);
    assert.equal(f.current.applied.length, 0);
  }
});

test('offline failed commit preserves original metadata and receipts; retry and replay commit once', async () => {
  let fail = true;
  const f = fixture({
      beforeCommit: async () => {
        if (fail) throw Error('offline-commit-failed');
      },
    }),
    payload = f.input(),
    before = structuredClone(f.current);
  await assert.rejects(f.run(payload), /offline-commit-failed/);
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  fail = false;
  await f.run(payload);
  await f.run(payload);
  assert.equal(f.current.history.length, 1);
  assert.equal(f.current.applied.length, 1);
  assert.equal(f.notices.length, 1);
});

test('offline receipt retention stays at 500 and an evicted stale edit cannot replace newer content', async () => {
  const f = fixture();
  f.current.applied = Array.from({ length: 500 }, () => ({
    id: randomUUID(),
    memberId: 'editor',
    result: null,
  }));
  const evicted = f.current.applied[0].id,
    payload = f.input();
  await f.run(payload);
  assert.equal(f.current.applied.length, 500);
  assert.equal(f.current.applied[0].id === evicted, false);
  assert.equal(f.current.applied.at(-1).id, payload.id);
  await assert.rejects(
    f.run({
      ...payload,
      id: evicted,
      changes: { 'ideas/a.md': doc('a', '古い編集') },
      revisions: { 'ideas/a.md': 1 },
    }),
    /다른 참여자가 변경/,
  );
  assert.equal(f.current.history.length, 1);
});

test('offline no-op batch retains legacy receipt/history behavior without requiring unchanged file bases', async () => {
  const f = fixture();
  await f.run(
    f.input({
      changes: { 'ideas/a.md': f.current.files['ideas/a.md'] },
      revisions: { 'ideas/a.md': 0 },
    }),
  );
  assert.equal(f.current.revision, 2);
  assert.equal(f.current.revisions['ideas/a.md'], 1);
  assert.deepEqual(f.current.history[0].entry.files, []);
  assert.equal(f.current.applied.length, 1);
});

test('actual SQLite abort rolls back offline files/blobs/history/receipt and retry survives reopen/replay', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-offline-db-')),
    file = path.join(root, 'sync.sqlite'),
    store = new SyncStore(file),
    db = new DatabaseSync(file);
  t.after(() => {
    db.close();
    store.close();
  });
  const f = fixture({ store });
  store.save(f.current);
  const before = structuredClone(f.current),
    stored = store.load(),
    blobs = Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n),
    payload = f.input({
      changes: {
        'ideas/a.md': doc('a', '오프라인 수정'),
        'ideas/b.md': null,
        'ideas/new.md': doc('new', '새 파일'),
      },
    });
  db.exec(
    "CREATE TRIGGER fail_offline BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'offline-abort'); END;",
  );
  await assert.rejects(f.run(payload), /offline-abort/);
  assert.deepEqual(f.current, before);
  assert.deepEqual(store.load(), stored);
  assert.equal(
    Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n),
    blobs,
  );
  assert.deepEqual(f.notices, []);
  db.exec('DROP TRIGGER fail_offline');
  await f.run(payload);
  const reopened = new SyncStore(file);
  try {
    const restored = reopened.load().find((p) => p.id === f.current.id),
      g = fixture({ project: restored, store: reopened });
    await g.run(payload);
    assert.equal(g.current.history.length, 1);
    assert.equal(g.current.applied.length, 1);
    assert.equal(g.current.files['ideas/b.md'], undefined);
    assert.ok(g.current.files['ideas/new.md']);
    assert.deepEqual(g.notices, []);
  } finally {
    reopened.close();
  }
});
