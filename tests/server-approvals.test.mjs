import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApprovalService } from '../src/server/services/approval-service.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { SyncStore } from '../src/sync-store.ts';

const request = (patch = {}) => ({
  organize: false,
  implement: true,
  inputPaths: ['ideas/a.md'],
  x: 300,
  y: 100,
  resultName: '요청 게임',
  instructions: { organize: '정리해줘', implement: '키보드 게임을 만들어줘' },
  htmlResult: { mode: 'new' },
  ...patch,
});
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(options = {}) {
  let current = options.project ?? {
    id: randomUUID(),
    revision: 1,
    files: { 'ideas/a.md': '---\nid: a\ntitle: 원본\n---\n한글 원본\n' },
    revisions: { 'ideas/a.md': 1 },
    history: [],
    members: [
      { id: 'author', nickname: '작성자', role: 'editor', tokenHash: 'author' },
      { id: 'admin', nickname: '관리자', role: 'admin', tokenHash: 'admin' },
      {
        id: 'other',
        nickname: '다른 작성자',
        role: 'editor',
        tokenHash: 'other',
      },
      { id: 'viewer', nickname: '뷰어', role: 'viewer', tokenHash: 'viewer' },
    ],
    job: null,
  };
  let now = 1000;
  const notices = [],
    plans = [],
    queue = new ProjectQueue();
  const policy = createAccessPolicy({
    matches: (a, b) => a === b,
    now: () => now,
    seen: () => {},
    locks: () => new Map(),
  });
  const service = createApprovalService({
    admin: policy.admin,
    clone: (p) => ({
      ...structuredClone(p),
      approvals: structuredClone(p.approvals ?? {}),
      approvalReceipts: { ...p.approvalReceipts },
    }),
    persist: async (p) => {
      await options.beforeCommit?.(p);
      options.store?.save(p);
      current = p;
      notices.push(p.requestsVersion);
    },
    now: () => now,
    digest: (value) => createHash('sha256').update(value).digest('hex'),
    plan: (p, r) => {
      plans.push({ project: p, request: r });
      if (options.planError) throw options.planError;
      return {
        reviewToken: `review-${p.revision}`,
        outputs: ['output/index.html'],
      };
    },
  });
  const run = (action, input = {}, actor = 'author') =>
    queue.run(current.id, async () =>
      service.execute(
        current,
        policy.authenticate(current, actor),
        `requests-${action}`,
        input,
      ),
    );
  const create = (patch = {}, actor = 'author') =>
    run(
      'create',
      { commandId: randomUUID(), request: request(), ...patch },
      actor,
    );
  return {
    service,
    queue,
    run,
    create,
    notices,
    plans,
    get current() {
      return current;
    },
    setNow: (v) => (now = v),
    replace: (p) => (current = p),
  };
}

test('create sanitizes request metadata and records authenticated author, clock/history/receipt without changing files', async () => {
  const f = fixture(),
    before = structuredClone(f.current),
    input = {
      commandId: randomUUID(),
      authorId: 'admin',
      role: 'admin',
      request: request({ token: 'private', providerId: 'secret' }),
    };
  const item = await f.run('create', input);
  assert.equal(item.id, input.commandId);
  assert.equal(item.projectId, before.id);
  assert.equal(item.authorId, 'author');
  assert.equal(item.authorName, '작성자');
  assert.equal(item.createdAt, 1000);
  assert.equal(item.revision, 1);
  assert.equal(item.status, 'pending');
  assert.equal(item.request.token, undefined);
  assert.equal(item.request.providerId, undefined);
  assert.equal(item.changes[0].actorId, 'author');
  assert.equal(f.current.requestsVersion, 1);
  assert.equal(f.current.approvalReceipts[input.commandId].requestId, item.id);
  assert.deepEqual(f.current.files, before.files);
  assert.deepEqual(f.current.history, before.history);
  assert.equal(f.current.revision, before.revision);
  assert.equal(before.approvals, undefined);
});

test('viewer can list/read sorted requests and review errors never modify persisted metadata', async () => {
  const f = fixture(),
    a = await f.create();
  f.setNow(2000);
  const b = await f.create(),
    before = structuredClone(f.current),
    writes = f.notices.length;
  const list = await f.run('list', {}, 'viewer');
  assert.deepEqual(
    list.items.map((x) => x.id),
    [b.id, a.id],
  );
  assert.equal(list.version, 2);
  const detail = await f.run('read', { id: a.id }, 'viewer');
  assert.equal(detail.reviewToken, 'review-1');
  assert.deepEqual(detail.outputs, ['output/index.html']);
  assert.deepEqual(f.current, before);
  assert.equal(f.notices.length, writes);
  const broken = fixture({
      project: before,
      planError: Error('missing input'),
    }),
    error = await broken.run('read', { id: a.id });
  assert.equal(error.reviewToken, null);
  assert.equal(error.reviewError, 'missing input');
  assert.deepEqual(broken.current, before);
  broken.current.approvals[a.id].status = 'completed';
  broken.current.approvals[a.id].outputs = ['kept.html'];
  const done = await broken.run('read', { id: a.id });
  assert.deepEqual(done.outputs, ['kept.html']);
  assert.equal(done.reviewToken, null);
  await assert.rejects(f.run('read', { id: 'missing' }), { status: 404 });
});

test('viewer mutation and non-admin feedback are denied before receipt replay', async () => {
  const f = fixture(),
    input = { commandId: randomUUID(), request: request() },
    item = await f.run('create', input);
  await assert.rejects(f.run('create', input, 'viewer'), { status: 403 });
  await assert.rejects(
    f.run(
      'feedback',
      { commandId: randomUUID(), id: item.id, revision: 1, message: '보완' },
      'other',
    ),
    { status: 403 },
  );
  f.current.members.find((x) => x.id === 'author').role = 'viewer';
  await assert.rejects(f.run('create', input), { status: 403 });
  assert.equal(f.current.requestsVersion, 1);
});

test('only author updates/cancels; admin feedback preserves request history and requires current revision', async () => {
  const f = fixture(),
    a = await f.create();
  for (const actor of ['other', 'admin'])
    await assert.rejects(
      f.run(
        'cancel',
        { commandId: randomUUID(), id: a.id, revision: 1 },
        actor,
      ),
      { status: 403 },
    );
  const feedback = await f.run(
    'feedback',
    {
      commandId: randomUUID(),
      id: a.id,
      revision: 1,
      message: '  보완해주세요  ',
    },
    'admin',
  );
  assert.equal(feedback.status, 'feedback');
  assert.equal(feedback.feedback, '보완해주세요');
  assert.equal(feedback.revision, 2);
  assert.equal(feedback.changes.at(-1).message, '보완해주세요');
  const update = await f.run('update', {
    commandId: randomUUID(),
    id: a.id,
    revision: 2,
    request: request({ resultName: '새 이름' }),
  });
  assert.equal(update.status, 'pending');
  assert.equal(update.revision, 3);
  assert.equal(update.changes[0].request.resultName, '요청 게임');
  const cancelled = await f.run('cancel', {
    commandId: randomUUID(),
    id: a.id,
    revision: 3,
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.revision, 4);
  assert.equal(f.current.requestsVersion, 4);
});

test('stale, terminal, invalid feedback and unknown operations do not store candidates', async () => {
  const f = fixture(),
    a = await f.create(),
    before = structuredClone(f.current);
  await assert.rejects(
    f.run('update', {
      commandId: randomUUID(),
      id: a.id,
      revision: 0,
      request: request(),
    }),
    /요청 내용이 변경/,
  );
  for (const message of ['', ' ', 'x'.repeat(4001), null])
    await assert.rejects(
      f.run(
        'feedback',
        { commandId: randomUUID(), id: a.id, revision: 1, message },
        'admin',
      ),
      { status: 400 },
    );
  await assert.rejects(
    f.run('unknown', { commandId: randomUUID(), id: a.id, revision: 1 }),
    { status: 404 },
  );
  await assert.rejects(
    f.run('cancel', { commandId: randomUUID(), id: 'missing', revision: 1 }),
    { status: 404 },
  );
  assert.deepEqual(f.current, before);
  for (const status of [
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
    'stopped',
  ]) {
    f.current.approvals[a.id].status = status;
    await assert.rejects(
      f.run('cancel', { commandId: randomUUID(), id: a.id, revision: 1 }),
      /이미 구현/,
    );
  }
});

test('same command receipt reuses latest item, while actor or fingerprint changes are rejected', async () => {
  const f = fixture(),
    input = { commandId: randomUUID(), request: request() },
    a = await f.run('create', input),
    plans = f.plans.length;
  assert.deepEqual(await f.run('create', input), a);
  assert.equal(f.plans.length, plans);
  assert.equal(f.notices.length, 1);
  await assert.rejects(f.run('create', input, 'other'), /이미 사용한 작업 ID/);
  await assert.rejects(
    f.run('create', { ...input, request: request({ resultName: 'changed' }) }),
    /이미 사용한 작업 ID/,
  );
  await f.run(
    'feedback',
    { commandId: randomUUID(), id: a.id, revision: 1, message: '보완' },
    'admin',
  );
  const replay = await f.run('create', input);
  assert.equal(replay.revision, 2);
  assert.equal(replay.status, 'feedback');
  assert.equal(f.notices.length, 2);
});

test('copiedFrom only links existing items and stored request snapshots remain independent', async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.create({ copiedFrom: a.id }),
    c = await f.create({ copiedFrom: 'missing' });
  assert.equal(b.copiedFrom, a.id);
  assert.equal(c.copiedFrom, undefined);
  assert.notEqual(b.request, a.request);
  await f.run('update', {
    commandId: randomUUID(),
    id: b.id,
    revision: 1,
    request: request({ resultName: 'updated' }),
  });
  assert.equal(f.current.approvals[a.id].request.resultName, '요청 게임');
  assert.equal(
    f.current.approvals[b.id].changes[0].request.resultName,
    '요청 게임',
  );
});

test('request and receipt bounds preserve collision/stale protection after eviction', async () => {
  const f = fixture(),
    input = { commandId: randomUUID(), request: request() },
    a = await f.run('create', input);
  f.current.approvalReceipts = {};
  await assert.rejects(f.run('create', input), /이미 등록된 요청/);
  for (let i = 0; i < 999; i++)
    f.current.approvals[`existing-${i}`] = { ...a, id: `existing-${i}` };
  await assert.rejects(f.create(), /보관 한도/);
  f.current.approvals = { [a.id]: a };
  f.current.approvalReceipts = Object.fromEntries(
    Array.from({ length: 2000 }, () => [
      randomUUID(),
      { memberId: 'author', fingerprint: 'old', requestId: a.id },
    ]),
  );
  const oldest = Object.keys(f.current.approvalReceipts)[0];
  await f.run('update', {
    commandId: randomUUID(),
    id: a.id,
    revision: 1,
    request: request({ resultName: 'new' }),
  });
  assert.equal(Object.keys(f.current.approvalReceipts).length, 2000);
  assert.equal(f.current.approvalReceipts[oldest], undefined);
  await assert.rejects(
    f.run('cancel', { commandId: randomUUID(), id: a.id, revision: 1 }),
    /요청 내용이 변경/,
  );
});

test('planning failure, invalid payload and bad command ID fail without receipts or writes', async () => {
  const f = fixture({ planError: Error('invalid inputs') }),
    before = structuredClone(f.current);
  await assert.rejects(f.create(), /invalid inputs/);
  await assert.rejects(f.create({ commandId: 'invalid' }), { status: 400 });
  await assert.rejects(f.create({ request: {} }));
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
});

test('commit wait/failure keeps original approval state; same-ID retry and replay publish once', async () => {
  const gate = defer(),
    entered = defer();
  let fail = true;
  const f = fixture({
      beforeCommit: async () => {
        entered.resolve();
        await gate.promise;
        if (fail) throw Error('save failed');
      },
    }),
    input = { commandId: randomUUID(), request: request() },
    before = structuredClone(f.current);
  const rejected = assert.rejects(f.run('create', input), /save failed/);
  await entered.promise;
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  gate.resolve();
  await rejected;
  assert.deepEqual(f.current, before);
  fail = false;
  const result = await f.run('create', input);
  assert.deepEqual(await f.run('create', input), result);
  assert.deepEqual(f.notices, [1]);
});

test('queued duplicate/stale mutations and revoked author use current project state', async () => {
  const f = fixture(),
    input = { commandId: randomUUID(), request: request() };
  const [a, b] = await Promise.all([
    f.run('create', input),
    f.run('create', input),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(f.notices.length, 1);
  const outcomes = await Promise.allSettled([
    f.run('cancel', { commandId: randomUUID(), id: a.id, revision: 1 }),
    f.run('update', {
      commandId: randomUUID(),
      id: a.id,
      revision: 1,
      request: request(),
    }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((x) => x.status === 'rejected').length, 1);
  const gate = defer(),
    changed = f.queue.run(f.current.id, async () => {
      await gate.promise;
      const next = structuredClone(f.current);
      next.members[0].removed = true;
      f.replace(next);
    }),
    blocked = assert.rejects(f.create(), { status: 403 });
  gate.resolve();
  await Promise.all([changed, blocked]);
});

test('actual SQLite abort rolls back approval/version/receipt, then replay survives reopen', async (t) => {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gamejam-approvals-db-'),
    ),
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
    input = { commandId: randomUUID(), request: request() };
  db.exec(
    "CREATE TRIGGER fail_approval BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'approval-abort'); END;",
  );
  await assert.rejects(f.run('create', input), /approval-abort/);
  assert.deepEqual(store.load(), [before]);
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  db.exec('DROP TRIGGER fail_approval');
  const created = await f.run('create', input),
    reopened = new SyncStore(file);
  try {
    const p = reopened.load()[0],
      fresh = fixture({ project: p, store: reopened }),
      replay = await fresh.run('create', input);
    assert.deepEqual(replay, JSON.parse(JSON.stringify(created)));
    assert.deepEqual(fresh.notices, []);
    assert.equal(p.requestsVersion, 1);
    assert.equal(Object.keys(p.approvalReceipts).length, 1);
  } finally {
    reopened.close();
  }
});
