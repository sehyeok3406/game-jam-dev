import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import matter from '../src/markdown.ts';
import { createHistoryService } from '../src/server/services/history-service.ts';
import { planHistoryRestoration } from '../src/server/services/history-restoration.ts';
import {
  listProjectHistory,
  readProjectHistory,
} from '../src/server/services/history-query.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { assertAiMutation } from '../src/ai-file-lock.ts';
import { SyncStore } from '../src/sync-store.ts';
const doc = (body, patch = {}) =>
  matter.stringify(body, { id: 'a', title: '문서', x: 10, y: 20, ...patch });
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(options = {}) {
  const old = doc('이전'),
    latest = doc('수정');
  let current = options.project ?? {
    id: randomUUID(),
    name: '기록 검증',
    revision: 1,
    files: { 'ideas/a.md': latest, 'ideas/b.md': '별도 문서' },
    revisions: { 'ideas/a.md': 1 },
    propertyVersions: {},
    history: [
      {
        entry: {
          id: 'edit',
          actorId: 'editor',
          kind: 'user',
          status: 'completed',
          label: '문서 편집',
          files: [{ relativePath: 'ideas/a.md' }],
        },
        before: { 'ideas/a.md': old },
        after: { 'ideas/a.md': latest },
      },
    ],
    applied: [],
    job: null,
    authorship: {},
    members: ['admin', 'editor', 'other', 'viewer'].map((id) => ({
      id,
      nickname: id,
      tokenHash: id,
      role: id === 'other' ? 'editor' : id,
    })),
  };
  const queue = new ProjectQueue(),
    locks = new Map(),
    notices = [],
    checkpoints = [];
  const policy = createAccessPolicy({
    matches: (a, b) => a === b,
    now: () => 1000,
    locks: () => locks,
    seen: () => {},
  });
  const service = createHistoryService({
    admin: policy.admin,
    editable: policy.editable,
    locks: () => locks,
    clone: structuredClone,
    assertAiMutation: (p, files) =>
      assertAiMutation(p.job?.fileLock, p.files, files),
    recordChanges: (p, m, files, label, kind = 'user') => {
      const before = p.files,
        paths = Object.keys({ ...before, ...files }).filter(
          (k) => before[k] !== files[k],
        );
      p.revision++;
      for (const k of paths) p.revisions[k] = (p.revisions[k] ?? 0) + 1;
      p.history.push({
        entry: {
          id: randomUUID(),
          actorId: m.id,
          label,
          kind,
          status: 'completed',
          files: paths.map((relativePath) => ({ relativePath })),
        },
        before: { ...before },
        after: { ...files },
      });
      p.files = files;
    },
    persist: async (p) => {
      await options.beforeCommit?.();
      options.store?.save(p);
      current = p;
      notices.push(p.revision);
    },
    checkpoint: async (p) => {
      checkpoints.push(p.revision);
      await options.checkpoint?.();
    },
    envelope: (p) => ({ files: p.files, state: { revision: p.revision } }),
  });
  const run = (action, input = {}, actor = 'editor') =>
    queue.run(current.id, () =>
      service.execute(
        current,
        policy.authenticate(current, actor),
        action,
        input,
      ),
    );
  return {
    service,
    run,
    queue,
    locks,
    notices,
    checkpoints,
    get current() {
      return current;
    },
    change: (patch = {}) => ({
      id: 'edit',
      direction: 'undo',
      operationId: randomUUID(),
      ...patch,
    }),
    restore: (patch = {}) => ({
      id: 'edit',
      revision: current.revision,
      ...patch,
    }),
  };
}

test('history queries retain newest-first order and read before/after/missing files without writing', async () => {
  const f = fixture();
  f.current.history.push({
    ...structuredClone(f.current.history[0]),
    entry: { ...f.current.history[0].entry, id: 'second' },
  });
  const before = structuredClone(f.current);
  assert.deepEqual(
    listProjectHistory(f.current).map((e) => e.id),
    ['second', 'edit'],
  );
  assert.equal(
    await f.run(
      'history-read',
      { id: 'edit', version: 'before', relativePath: 'ideas/a.md' },
      'viewer',
    ),
    before.history[0].before['ideas/a.md'],
  );
  assert.equal(
    readProjectHistory(f.current, {
      id: 'edit',
      version: 'after',
      relativePath: 'ideas/missing.md',
    }),
    null,
  );
  for (const input of [
    { id: 'missing', version: 'before', relativePath: 'ideas/a.md' },
    { id: 'edit', version: 'bad', relativePath: 'ideas/a.md' },
    { id: 'edit', version: 'before', relativePath: '../secret' },
  ])
    assert.throws(() => readProjectHistory(f.current, input));
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
});

test('history undo/redo preserves a concurrent color change and unrelated documents', async () => {
  const f = fixture();
  f.current.files['ideas/a.md'] = doc('수정', { background_color: 'green' });
  await f.run('history-change', f.change());
  assert.equal(matter(f.current.files['ideas/a.md']).content, '이전\n');
  assert.equal(
    matter(f.current.files['ideas/a.md']).data.background_color,
    'green',
  );
  await f.run('history-change', f.change({ direction: 'redo' }));
  assert.equal(matter(f.current.files['ideas/a.md']).content, '수정\n');
  assert.equal(f.current.files['ideas/b.md'], '별도 문서');
  assert.equal(f.current.applied.length, 2);
});

test('history undo rejects another authors entry, non-user history and viewer, including admin acting on another author', async () => {
  const f = fixture();
  for (const actor of ['other', 'admin', 'viewer'])
    await assert.rejects(f.run('history-change', f.change(), actor), {
      status: 403,
    });
  f.current.history[0].entry.kind = 'ai';
  await assert.rejects(f.run('history-change', f.change()), { status: 403 });
  assert.deepEqual(f.notices, []);
});

test('history undo receipt is actor-bound and still checks editable before replay', async () => {
  const f = fixture(),
    input = f.change();
  await Promise.all([
    f.run('history-change', input),
    f.run('history-change', input),
  ]);
  assert.equal(f.current.history.length, 2);
  assert.equal(f.notices.length, 1);
  await assert.rejects(
    f.run('history-change', input, 'other'),
    /작업 ID가 충돌/,
  );
  f.current.members.find((m) => m.id === 'editor').role = 'viewer';
  await assert.rejects(f.run('history-change', input), { status: 403 });
});

test('history content undo rejects any active lock while metadata-only undo remains compatible', async () => {
  const f = fixture();
  f.locks.set('ideas/a.md', { memberId: 'editor' });
  await assert.rejects(f.run('history-change', f.change()), /편집이 끝난/);
  f.current.history[0].before['ideas/a.md'] = doc('수정', { x: 0 });
  await f.run('history-change', f.change());
  assert.equal(matter(f.current.files['ideas/a.md']).data.x, 0);
});

test('history undo rejects invalid direction/operation ID and conflicting current contents without recording', async () => {
  const f = fixture();
  for (const patch of [{ direction: 'wrong' }, { operationId: 'bad' }])
    await assert.rejects(f.run('history-change', f.change(patch)));
  f.current.files['ideas/a.md'] = doc('다른 참여자 변경');
  await assert.rejects(f.run('history-change', f.change()));
  assert.deepEqual(f.notices, []);
});

test('restoration planning retains unrelated files, supports before/after and rejects unsafe partial bundles', () => {
  const f = fixture(),
    record = f.current.history[0],
    before = structuredClone(f.current.files);
  assert.equal(
    planHistoryRestoration(f.current.files, record, {})['ideas/a.md'],
    record.before['ideas/a.md'],
  );
  assert.equal(
    planHistoryRestoration(f.current.files, record, { version: 'after' })[
      'ideas/a.md'
    ],
    record.after['ideas/a.md'],
  );
  for (const relativePath of [
    'sections/one.md',
    'assets/images/' + 'a'.repeat(64) + '.png',
    'output/imported/import-' + randomUUID() + '.html',
  ]) {
    const bundled = {
      ...record,
      entry: {
        ...record.entry,
        files: [...record.entry.files, { relativePath }],
      },
    };
    assert.throws(
      () =>
        planHistoryRestoration(f.current.files, bundled, {
          relativePath: 'ideas/a.md',
        }),
      /함께 복원/,
    );
  }
  assert.deepEqual(f.current.files, before);
});

test('history restore requires admin, current project revision and absence of all edit locks', async () => {
  const f = fixture();
  await assert.rejects(f.run('restore', f.restore()), { status: 403 });
  await assert.rejects(
    f.run('restore', f.restore({ revision: 0 }), 'admin'),
    /변경/,
  );
  f.locks.set('ideas/b.md', {});
  await assert.rejects(f.run('restore', f.restore(), 'admin'), /편집이 끝난/);
  f.locks.clear();
  f.current.history[0].entry.status = 'failed';
  await assert.rejects(f.run('restore', f.restore(), 'admin'), /복원할 기록/);
  assert.deepEqual(f.notices, []);
});

test('history restore records kind restore and waits for commit before checkpoint and reply', async () => {
  const gate = defer(),
    entered = defer(),
    f = fixture({
      beforeCommit: async () => {
        entered.resolve();
        await gate.promise;
      },
    }),
    before = structuredClone(f.current);
  const pending = f.run('restore', f.restore(), 'admin');
  await entered.promise;
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.checkpoints, []);
  gate.resolve();
  await pending;
  assert.equal(f.current.history.at(-1).entry.kind, 'restore');
  assert.deepEqual(f.checkpoints, [2]);
});

test('history undo and restore enforce scoped AI protection without changing the current snapshot', async () => {
  for (const action of ['history-change', 'restore']) {
    const f = fixture();
    f.current.job = { fileLock: { paths: ['ideas/a.md'], folders: [] } };
    const before = structuredClone(f.current);
    await assert.rejects(
      f.run(
        action,
        action === 'restore' ? f.restore() : f.change(),
        action === 'restore' ? 'admin' : 'editor',
      ),
    );
    assert.deepEqual(f.current, before);
    assert.deepEqual(f.notices, []);
  }
});

test('history restore keeps committed data if postcommit checkpoint fails and stale revision prevents a second restore', async () => {
  const f = fixture({
      checkpoint: async () => {
        throw Error('checkpoint-after-commit');
      },
    }),
    input = f.restore();
  await assert.rejects(
    f.run('restore', input, 'admin'),
    /checkpoint-after-commit/,
  );
  assert.equal(f.current.revision, 2);
  assert.equal(matter(f.current.files['ideas/a.md']).content, '이전\n');
  await assert.rejects(f.run('restore', input, 'admin'), /変更|변경/);
  assert.equal(f.current.history.length, 2);
});

test('history queued operations use current revision and role after a prior queued operation', async () => {
  for (const kind of ['revision', 'role']) {
    const f = fixture(),
      gate = defer(),
      input = f.restore();
    const prior = f.queue.run(f.current.id, async () => {
      await gate.promise;
      if (kind === 'revision') f.current.revision++;
      else f.current.members.find((m) => m.id === 'admin').role = 'viewer';
    });
    const rejected = assert.rejects(f.run('restore', input, 'admin'));
    gate.resolve();
    await Promise.all([prior, rejected]);
    assert.deepEqual(f.notices, []);
  }
});

for (const action of ['history-change', 'restore'])
  test(`actual SQLite abort preserves ${action} files/history/receipts and successful retry survives reopen`, async (t) => {
    const root = await fs.mkdtemp(
        path.join(os.tmpdir(), 'gamejam-history-db-'),
      ),
      file = path.join(root, 'sync.sqlite'),
      store = new SyncStore(file),
      db = new DatabaseSync(file);
    t.after(() => {
      db.close();
      store.close();
    });
    const f = fixture({ store }),
      input = action === 'restore' ? f.restore() : f.change(),
      actor = action === 'restore' ? 'admin' : 'editor';
    store.save(f.current);
    const before = structuredClone(f.current),
      stored = store.load(),
      blobs = Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n);
    db.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'history-abort'); END;",
    );
    await assert.rejects(f.run(action, input, actor), /history-abort/);
    assert.deepEqual(f.current, before);
    assert.deepEqual(store.load(), stored);
    assert.equal(
      Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n),
      blobs,
    );
    assert.deepEqual(f.notices, []);
    assert.deepEqual(f.checkpoints, []);
    db.exec('DROP TRIGGER fail_history');
    await f.run(action, input, actor);
    const reopened = new SyncStore(file);
    try {
      const restored = reopened.load().find((p) => p.id === f.current.id);
      assert.equal(restored.history.length, 2);
      assert.equal(matter(restored.files['ideas/a.md']).content, '이전\n');
      if (action === 'history-change') {
        const g = fixture({ project: restored });
        await g.run(action, input, actor);
        assert.deepEqual(g.notices, []);
      }
    } finally {
      reopened.close();
    }
  });
