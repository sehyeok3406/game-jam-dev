import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import matter from '../src/markdown.ts';
import { createCommandService } from '../src/server/services/command-service.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { applyExternalCommand } from '../src/application/editing/command-service.ts';
import { advanceProperties } from '../src/sync-properties.ts';
import { SyncStore } from '../src/sync-store.ts';
import { CANVAS_SHEETS_PATH } from '../src/canvas-sheets.ts';

const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(options = {}) {
  const member = { id: 'editor', role: 'editor', tokenHash: 'token' };
  let current = options.project ?? {
    id: randomUUID(),
    revision: 1,
    files: {
      'ideas/a.md': matter.stringify('한글 원본\n', {
        id: 'a',
        title: '메모',
        x: 10,
        y: 20,
        width: 340,
        height: 300,
      }),
    },
    revisions: { 'ideas/a.md': 1 },
    propertyVersions: {},
    members: [member],
    history: [],
    applied: [],
    job: null,
  };
  const notices = [],
    calls = [],
    locks = new Map(),
    queue = new ProjectQueue();
  const policy = createAccessPolicy({
    matches: (token, hash) => token === hash,
    now: () => 1000,
    seen: () => {},
    locks: () => locks,
  });
  const service = createCommandService({
    ...policy,
    locks: () => locks,
    reduce: (...args) => {
      calls.push('reduce');
      return applyExternalCommand(...args, { now: () => 1000, id: randomUUID });
    },
    assertAiMutation: () => {
      if (options.guardError) throw options.guardError;
    },
    clone: structuredClone,
    recordChanges: (next, actor, files, label) => {
      calls.push('record');
      const before = next.files;
      const paths = Object.keys({ ...before, ...files }).filter(
        (p) => before[p] !== files[p],
      );
      next.revision++;
      next.propertyVersions = advanceProperties(
        next.propertyVersions ?? {},
        before,
        files,
        next.revision,
      );
      for (const p of paths) next.revisions[p] = (next.revisions[p] ?? 0) + 1;
      next.history.push({
        entry: {
          id: randomUUID(),
          label,
          actorId: actor.id,
          files: paths.map((relativePath) => ({ relativePath })),
        },
        before: { ...before },
        after: { ...files },
      });
      next.files = files;
    },
    persist: async (next) => {
      calls.push('persist');
      await options.beforeCommit?.(next);
      options.store?.save(next);
      current = next;
      notices.push(next.revision);
    },
    envelope: (project) => ({
      state: { revision: project.revision },
      files: project.files,
    }),
  });
  const command = (
    channel = 'documents:set-color',
    input = { relativePath: 'ideas/a.md', color: 'green' },
    extra = {},
  ) => ({
    id: randomUUID(),
    channel,
    input,
    revisions: { ...current.revisions },
    propertySyncVersion: 1,
    sessionId: randomUUID(),
    sequence: 1,
    objects: { 'ideas/a.md': 'a' },
    properties: structuredClone(current.propertyVersions ?? {}),
    ...extra,
  });
  return {
    service,
    policy,
    queue,
    calls,
    notices,
    locks,
    command,
    get current() {
      return current;
    },
    replace: (next) => (current = next),
    run: (cmd) =>
      queue.run(current.id, async () =>
        service.execute(current, policy.authenticate(current, 'token'), cmd),
      ),
  };
}

test('command response and publication wait for commit; candidate never mutates the current project', async () => {
  const gate = defer(),
    entered = defer(),
    f = fixture({
      beforeCommit: async () => {
        entered.resolve();
        await gate.promise;
      },
    });
  const before = structuredClone(f.current);
  let completed = false;
  const pending = f.run(f.command()).then((result) => {
    completed = true;
    return result;
  });
  await entered.promise;
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  assert.equal(completed, false);
  gate.resolve();
  const result = await pending;
  assert.deepEqual(f.calls, ['reduce', 'record', 'persist']);
  assert.deepEqual(f.notices, [2]);
  assert.equal(result.state.revision, 2);
  assert.ok(result.historyId);
  assert.equal(
    matter(f.current.files['ideas/a.md']).data.background_color,
    'green',
  );
});

test('failed persistence keeps files/history/sequence/receipts unchanged and same-ID retry/replay writes once', async () => {
  let fail = true;
  const error = new Error('commit failure'),
    f = fixture({
      beforeCommit: async () => {
        if (fail) throw error;
      },
    });
  const before = structuredClone(f.current),
    cmd = f.command();
  await assert.rejects(f.run(cmd), (e) => e === error);
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  fail = false;
  const result = await f.run(cmd),
    calls = f.calls.length;
  const replay = await f.run(cmd);
  assert.deepEqual(replay, result);
  assert.equal(f.calls.length, calls);
  assert.equal(f.current.history.length, 1);
  assert.equal(f.current.applied.length, 1);
  assert.deepEqual(f.notices, [2]);
});

test('real SQLite transaction abort rolls back blobs/history/receipt, then retry survives store reopen', async (t) => {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gamejam-command-db-'),
    ),
    file = path.join(directory, 'sync.sqlite');
  const store = new SyncStore(file),
    db = new DatabaseSync(file);
  t.after(() => {
    db.close();
    store.close();
  });
  const f = fixture({ store });
  store.save(f.current);
  const before = structuredClone(store.load()[0]);
  const blobs = Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n);
  db.exec(
    "CREATE TRIGGER fail_command BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'r07-commit-abort'); END;",
  );
  const cmd = f.command('documents:create-idea', { x: 40, y: 60 });
  await assert.rejects(f.run(cmd), /r07-commit-abort/);
  assert.deepEqual(store.load(), [before]);
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  assert.equal(
    Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n),
    blobs,
  );
  db.exec('DROP TRIGGER fail_command');
  const result = await f.run(cmd);
  const persistedResult = JSON.parse(JSON.stringify(result));
  const reopened = new SyncStore(file);
  try {
    const loaded = reopened.load()[0];
    assert.equal(loaded.history.length, 1);
    assert.equal(loaded.applied.length, 1);
    assert.deepEqual(loaded.applied[0].result, {
      value: persistedResult.result,
      historyId: result.historyId,
    });
    const fresh = fixture({ project: loaded, store: reopened });
    assert.deepEqual(await fresh.run(cmd), persistedResult);
    assert.deepEqual(fresh.calls, []);
    assert.deepEqual(fresh.notices, []);
  } finally {
    reopened.close();
  }
});

test('same request queued twice returns original receipt while another actor cannot reuse it', async () => {
  const f = fixture(),
    cmd = f.command('documents:create-idea', { x: 1, y: 2 });
  const [a, b] = await Promise.all([f.run(cmd), f.run(cmd)]);
  assert.deepEqual(a, b);
  assert.equal(f.current.history.length, 1);
  assert.deepEqual(f.calls, ['reduce', 'record', 'persist']);
  await assert.rejects(
    f.service.execute(f.current, { id: 'other' }, cmd),
    /작업 ID가 충돌/,
  );
});

test('legacy receipts and empty-history results retain original replay format', async () => {
  const f = fixture();
  for (const result of [
    null,
    { old: 'legacy' },
    { value: 'new', historyId: null },
  ]) {
    const cmd = f.command();
    f.current.applied.push({ id: cmd.id, memberId: 'editor', result });
    const reply = await f.run(cmd);
    assert.deepEqual(
      reply.result,
      result && 'historyId' in result ? result.value : result,
    );
    assert.equal(reply.historyId, result?.historyId);
  }
  const noChange = f.command('documents:set-color', {
    relativePath: 'ideas/a.md',
    color: 'green',
  });
  await f.run(noChange);
  const noop = await f.run(
    f.command('documents:set-color', {
      relativePath: 'ideas/a.md',
      color: 'green',
    }),
  );
  assert.equal(noop.historyId, null);
  assert.equal(f.current.applied.at(-1).result.historyId, null);
});

test('invalid ID, unsupported capability and invalid sequence fail without a candidate or receipt', async () => {
  const f = fixture();
  await assert.rejects(f.run(f.command(undefined, undefined, { id: 'bad' })), {
    status: 400,
  });
  for (const value of [0, -1, 1.5, NaN])
    await assert.rejects(
      f.run(f.command(undefined, undefined, { sequence: value })),
      { status: 400 },
    );
  const before = structuredClone(f.current);
  f.current.files[CANVAS_SHEETS_PATH] = '{}';
  await assert.rejects(f.run(f.command()), /캔버스가 있는/);
  delete f.current.files[CANVAS_SHEETS_PATH];
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.calls, []);
});

test('save requires the exact current lock token before the reducer; stale content generation is still rejected', async () => {
  const f = fixture(),
    cmd = f.command('documents:save', {
      relativePath: 'ideas/a.md',
      title: '메모',
      body: '수정',
    });
  await assert.rejects(f.run(cmd), /잠금이 만료/);
  f.locks.set('ideas/a.md', { memberId: 'other', token: 'lock' });
  cmd.lockToken = 'lock';
  await assert.rejects(f.run(cmd), /잠금이 만료/);
  f.locks.set('ideas/a.md', { memberId: 'editor', token: 'lock' });
  await f.run(cmd);
  assert.equal(f.current.history.length, 1);
  const stale = {
    ...cmd,
    id: randomUUID(),
    sequence: 2,
    input: { ...cmd.input, body: '과거' },
  };
  await assert.rejects(f.run(stale), /내용이 변경/);
  assert.equal(f.current.history.length, 1);
});

test('sequence preserves newer edits even after receipt eviction; exact replay retains original history ID', async () => {
  const f = fixture(),
    sessionId = randomUUID(),
    first = f.command(undefined, undefined, { sessionId, sequence: 5 });
  const saved = await f.run(first);
  const newer = f.command(
    'documents:set-color',
    { relativePath: 'ideas/a.md', color: 'yellow' },
    { sessionId, sequence: 6 },
  );
  await f.run(newer);
  const replay = await f.run(first);
  assert.equal(replay.historyId, saved.historyId);
  assert.equal(replay.state.revision, 3);
  f.current.applied = Array.from({ length: 500 }, () => ({
    id: randomUUID(),
    memberId: 'editor',
    result: null,
  }));
  await assert.rejects(f.run(first), /오래된 수정/);
  assert.equal(
    matter(f.current.files['ideas/a.md']).data.background_color,
    'yellow',
  );
  assert.equal(f.current.history.length, 2);
  const next = f.command('documents:set-color', {
    relativePath: 'ideas/a.md',
    color: 'blue',
  });
  await f.run(next);
  assert.equal(f.current.applied.length, 500);
});

test('AI mutation rejection occurs before candidate recording and task receipts still require admin', async () => {
  const f = fixture({ guardError: new Error('AI protected') });
  await assert.rejects(f.run(f.command()), /AI protected/);
  assert.deepEqual(f.calls, ['reduce']);
  assert.equal(f.current.applied.length, 0);
  const task = f.command('tasks:create', {});
  f.current.applied.push({ id: task.id, memberId: 'editor', result: null });
  await assert.rejects(f.run(task), { status: 403 });
});

test('queued command uses current authorization/revision/lock after waiting; rejected work does not poison queue', async () => {
  const f = fixture(),
    gate = defer(),
    cmd = f.command();
  const block = f.queue.run(f.current.id, async () => {
    await gate.promise;
    const next = structuredClone(f.current);
    next.members[0].removed = true;
    f.replace(next);
  });
  const waiting = assert.rejects(f.run(cmd), { status: 403 });
  gate.resolve();
  await Promise.all([block, waiting]);
  assert.deepEqual(f.calls, []);
  f.current.members[0].removed = false;
  f.current.members[0].role = 'viewer';
  await assert.rejects(f.run(cmd), { status: 403 });
  f.current.members[0].role = 'editor';
  f.locks.set('ideas/a.md', { memberId: 'other', token: 'other' });
  await assert.rejects(
    f.run(
      f.command('documents:save', {
        relativePath: 'ideas/a.md',
        body: 'blocked',
      }),
    ),
    /잠금이 만료/,
  );
  f.locks.clear();
  await f.run(cmd);
  assert.equal(f.current.history.length, 1);
});

test('501 committed requests evict old creation receipts but session sequence prevents duplicate creation after reopen', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-receipt-bound-'),
  );
  const filename = path.join(root, 'sync.sqlite'),
    store = new SyncStore(filename),
    sessionId = randomUUID();
  let activeStore = store;
  t.after(async () => {
    activeStore.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const f = fixture({ store });
  const first = f.command(
    'documents:create-idea',
    { title: '한 번만 생성', x: 10, y: 20 },
    { sessionId, sequence: 1 },
  );
  await f.run(first);
  for (let sequence = 2; sequence <= 501; sequence++) {
    await f.run(
      f.command(
        'documents:set-color',
        {
          relativePath: 'ideas/a.md',
          color: sequence % 2 ? 'green' : 'yellow',
        },
        { sessionId, sequence },
      ),
    );
  }
  assert.equal(f.current.applied.length, 500);
  assert.equal(
    f.current.applied.some((r) => r.id === first.id),
    false,
  );
  const before = structuredClone(f.current);
  await assert.rejects(f.run(first), /오래된 수정/);
  assert.deepEqual(f.current, before);
  store.close();
  activeStore = new SyncStore(filename);
  const reopened = fixture({
    project: activeStore.load()[0],
    store: activeStore,
  });
  await assert.rejects(reopened.run(first), /오래된 수정/);
  assert.deepEqual(reopened.current.files, before.files);
});
