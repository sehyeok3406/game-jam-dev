import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import matter from '../src/markdown.ts';
import { createTaskFiles } from '../src/task-plan.ts';
import { applyExternalCommand } from '../src/application/editing/command-service.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';
import { createAiCoordinator } from '../src/server/services/ai-coordinator.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { SyncStore } from '../src/sync-store.ts';

const request = () => ({
  organize: false,
  implement: true,
  inputPaths: ['ideas/a.md'],
  x: 0,
  y: 0,
  resultName: '승인 게임',
  instructions: { organize: '정리', implement: '키보드 게임을 만들어줘' },
  htmlResult: { mode: 'new' },
});
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(options = {}) {
  const base = {
    'ideas/a.md': matter.stringify('원본 한글', {
      id: 'a',
      title: '원본',
      type: 'idea',
      sources: [],
    }),
  };
  const files = {
    ...base,
    ...createTaskFiles(
      {
        kind: 'implement',
        inputPaths: ['ideas/a.md'],
        x: 0,
        y: 0,
        htmlResult: { mode: 'new' },
        queueVersion: 1,
      },
      'one',
      base,
    ),
  };
  let current = options.project ?? {
    id: randomUUID(),
    revision: 1,
    files,
    revisions: {},
    history: [],
    applied: [],
    members: [
      { id: 'admin', nickname: '관리자', role: 'admin', tokenHash: 'admin' },
      {
        id: 'other',
        nickname: '다른 관리자',
        role: 'admin',
        tokenHash: 'other',
      },
      { id: 'editor', nickname: '팀원', role: 'editor', tokenHash: 'editor' },
    ],
    job: null,
    authorship: {},
  };
  const locks = new Map(),
    queue = new ProjectQueue(),
    notices = [],
    plans = [];
  let tokens = 0;
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const policy = createAccessPolicy({
    matches: (a, b) => a === b,
    now: () => 1000,
    seen: () => {},
    locks: () => locks,
  });
  const review = (project, r) =>
    digest(JSON.stringify(r.inputPaths.map((p) => [p, project.files[p]])));
  const service = createAiCoordinator({
    admin: policy.admin,
    clone: (p) => ({
      ...structuredClone(p),
      approvals: structuredClone(p.approvals ?? {}),
      aiQueue: structuredClone(p.aiQueue ?? []),
    }),
    persist: async (p) => {
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
    plan: (p, r, providerId, modelId, reasoningEffort) => {
      plans.push({ p, r, providerId, modelId, reasoningEffort });
      const reduced = applyExternalCommand(
        p.files,
        'tasks:create',
        gamejamTaskInput(r, { providerId, modelId, reasoningEffort }),
      );
      const taskPath = reduced.result.relativePath;
      return {
        files: reduced.files,
        taskPath,
        reviewToken: review(p, r),
        outputs: expectedArtifacts(reduced.files[taskPath]),
      };
    },
    locks: () => locks,
    taskState: (state, relative, status) => {
      const parsed = matter(state[relative]);
      return {
        ...state,
        [relative]: matter.stringify(parsed.content, {
          ...parsed.data,
          status,
          ai_updated_at: new Date(1000).toISOString(),
        }),
      };
    },
    recordChanges: (p, m, next, label, kind, extra) => {
      const before = p.files;
      p.revision++;
      p.files = next;
      p.history.push({
        entry: {
          id: randomUUID(),
          actorId: m.id,
          label,
          kind,
          files: Object.keys({ ...before, ...next })
            .filter((key) => before[key] !== next[key])
            .map((relativePath) => ({ relativePath })),
          ...extra,
        },
        before: { ...before },
        after: { ...next },
      });
    },
    now: () => 1000,
    id: randomUUID,
    secret: () => `lease-${++tokens}`,
    digest,
  });
  const input = (patch = {}) => ({
    taskPath: '.ai/tasks/one.md',
    revision: current.revision,
    providerId: 'codex-cli',
    modelId: null,
    aiReasoningVersion: 1,
    gamejamVersion: 1,
    canvasSheetsVersion: 1,
    multiplayerVersion: 1,
    documentOutputFormatVersion: 1,
    documentBundleVersion: 1,
    htmlInputVersion: 1,
    htmlAnalysisVersion: 1,
    ...patch,
  });
  const run = (action, payload, actor = 'admin') =>
    queue.run(current.id, async () =>
      service.start(
        current,
        policy.authenticate(current, actor),
        action,
        payload,
      ),
    );
  const approval = () => {
    const item = {
      id: randomUUID(),
      projectId: current.id,
      authorId: 'editor',
      authorName: '팀원',
      createdAt: 1000,
      updatedAt: 1000,
      revision: 1,
      status: 'pending',
      request: request(),
      changes: [],
    };
    (current.approvals ??= {})[item.id] = item;
    return item;
  };
  const approvalInput = (item, patch = {}) =>
    input({
      id: item.id,
      requestRevision: item.revision,
      reviewToken: review(current, item.request),
      commandId: randomUUID(),
      ...patch,
    });
  return {
    service,
    queue,
    locks,
    notices,
    plans,
    input,
    run,
    approval,
    approvalInput,
    get current() {
      return current;
    },
    replace: (p) => (current = p),
  };
}

test('direct AI start records a scoped lease and injected clock/ID without running a process', async () => {
  const f = fixture(),
    before = structuredClone(f.current),
    reply = await f.run('ai-start', f.input());
  assert.equal(reply.lease, 'lease-1');
  assert.ok(reply.runId);
  assert.equal(f.current.job.event.runId, reply.runId);
  assert.equal(f.current.job.memberId, 'admin');
  assert.equal(f.current.job.expiresAt, 31000);
  assert.equal(f.current.job.event.timestamp, 1000);
  assert.equal(f.current.job.revision, before.revision);
  assert.equal(f.current.history.length, 1);
  assert.ok(f.current.job.fileLock);
  assert.equal(f.current.files['ideas/a.md'], before.files['ideas/a.md']);
  assert.deepEqual(f.notices, [2]);
});

test('admin, provider, model and project revision gates reject before persistence', async () => {
  const f = fixture();
  await assert.rejects(f.run('ai-start', f.input(), 'editor'), { status: 403 });
  await assert.rejects(f.run('ai-start', f.input({ providerId: 'unknown' })), {
    code: 'GC-AI-009',
  });
  await assert.rejects(
    f.run('ai-start', f.input({ modelId: 'invalid model' })),
    { status: 400 },
  );
  await assert.rejects(
    f.run('ai-start', f.input({ reasoningEffort: 'invalid' })),
    { status: 400 },
  );
  await assert.rejects(
    f.run('ai-start', f.input({ revision: 0 })),
    /문서가 변경/,
  );
  assert.deepEqual(f.notices, []);
  assert.equal(f.current.job, null);
});

test('approval checks current request revision/status/review before changing files or metadata', async () => {
  const f = fixture(),
    a = f.approval(),
    input = f.approvalInput(a),
    before = structuredClone(f.current);
  await assert.rejects(
    f.run('requests-start', { ...input, requestRevision: 0 }),
    /요청 상태나 내용/,
  );
  await assert.rejects(
    f.run('requests-start', { ...input, reviewToken: 'stale' }),
    /입력 자료나 출력/,
  );
  await assert.rejects(
    f.run('requests-start', { ...input, commandId: 'invalid' }),
    { status: 400 },
  );
  assert.deepEqual(f.current, before);
  f.current.files['ideas/a.md'] += 'changed';
  await assert.rejects(f.run('requests-start', input), /입력 자료나 출력/);
  assert.deepEqual(f.notices, []);
});

test('approval immediate start freezes request and replay reuses only the approving actor lease', async () => {
  const f = fixture(),
    a = f.approval(),
    input = f.approvalInput(a),
    reply = await f.run('requests-start', input),
    approved = f.current.approvals[a.id];
  assert.equal(approved.status, 'running');
  assert.equal(approved.approvedBy, 'admin');
  assert.equal(approved.approvedRevision, 1);
  assert.equal(approved.revision, 2);
  assert.equal(f.current.requestsVersion, 1);
  assert.deepEqual(approved.executionRequest, a.request);
  assert.notEqual(approved.executionRequest, a.request);
  const count = f.notices.length,
    plans = f.plans.length,
    replay = await f.run('requests-start', { ...input });
  assert.equal(replay.lease, reply.lease);
  assert.equal(replay.taskPath, reply.taskPath);
  assert.equal(f.notices.length, count);
  assert.equal(f.plans.length, plans);
  await assert.rejects(
    f.run('requests-start', { ...input }, 'other'),
    /요청 상태나 내용/,
  );
  await assert.rejects(
    f.run('requests-start', { ...input, modelId: 'other-model' }),
    /같은 작업 ID/,
  );
});

test('reserved approval replay returns original queued task and rejects changed approval settings', async () => {
  const f = fixture(),
    a = f.approval(),
    input = f.approvalInput(a, { queueVersion: 1 }),
    reply = await f.run('requests-start', input),
    p = f.current;
  assert.equal(p.approvals[a.id].status, 'queued');
  assert.equal(p.job, null);
  assert.equal(reply.queuedTask.taskId, p.aiQueue[0].taskId);
  assert.equal(reply.queuedTask.baseline, undefined);
  assert.equal(p.requestsVersion, 1);
  const count = f.notices.length,
    replay = await f.run('requests-start', { ...input });
  assert.deepEqual(replay.queuedTask, reply.queuedTask);
  assert.equal(f.notices.length, count);
  for (const patch of [
    { requestRevision: 2 },
    { reviewToken: 'other' },
    { modelId: 'other-model' },
    { providerId: 'claude-cli' },
  ])
    await assert.rejects(
      f.run('requests-start', { ...input, ...patch }),
      /같은 작업 ID/,
    );
});

test('concurrent different approval commands permit only one durable approval', async () => {
  const f = fixture(),
    a = f.approval(),
    one = f.approvalInput(a, { queueVersion: 1 }),
    two = { ...one, commandId: randomUUID() };
  const outcomes = await Promise.allSettled([
    f.run('requests-start', one),
    f.run('requests-start', two, 'other'),
  ]);
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((x) => x.status === 'rejected').length, 1);
  assert.equal(f.current.aiQueue.length, 1);
  assert.equal(f.current.history.length, 1);
  assert.equal(f.current.approvals[a.id].revision, 2);
});

test('queue claim is FIFO, idempotent for same actor/claim, and does not grant another actor a lease', async () => {
  const f = fixture(),
    queued = await f.run('ai-start', f.input({ queueVersion: 1 })),
    claim = f.input({
      taskId: queued.queuedTask.taskId,
      claimId: randomUUID(),
    });
  const wrong = await f.run('ai-claim', { ...claim, taskId: randomUUID() });
  assert.equal(wrong.lease, null);
  assert.equal(f.current.job, null);
  const started = await f.run('ai-claim', claim);
  assert.ok(started.lease);
  assert.equal(f.current.job.queueTaskId, queued.queuedTask.taskId);
  assert.equal(f.current.job.claimId, claim.claimId);
  const writes = f.notices.length,
    replay = await f.run('ai-claim', { ...claim });
  assert.equal(replay.lease, started.lease);
  assert.equal(f.notices.length, writes);
  assert.equal((await f.run('ai-claim', { ...claim }, 'other')).lease, null);
  assert.equal(
    (await f.run('ai-claim', { ...claim, claimId: randomUUID() })).lease,
    null,
  );
});

test('stale queued baseline fails task without granting execution; protected inputs are checked at claim', async () => {
  const f = fixture(),
    queued = await f.run('ai-start', f.input({ queueVersion: 1 }));
  f.current.files['ideas/a.md'] += 'teammate change';
  const reply = await f.run(
    'ai-claim',
    f.input({ taskId: queued.queuedTask.taskId, claimId: randomUUID() }),
  );
  assert.equal(reply.lease, null);
  assert.equal(f.current.job, null);
  assert.equal(f.current.aiQueue[0].status, 'failed');
  assert.equal(f.current.lastRun.status, 'failed');
  assert.match(f.current.lastRun.message, /변경/);
});

test('task capability, active edit lock and repeated completed output are checked before writing', async () => {
  const f = fixture(),
    task = '.ai/tasks/one.md';
  f.locks.set('ideas/a.md', { memberId: 'editor' });
  await assert.rejects(f.run('ai-start', f.input()), /문서를 편집 중/);
  f.locks.clear();
  let parsed = matter(f.current.files[task]);
  f.current.files[task] = matter.stringify(parsed.content, {
    ...parsed.data,
    canvas_id: 'second',
  });
  await assert.rejects(
    f.run('ai-start', f.input({ canvasSheetsVersion: undefined })),
    /여러 캔버스/,
  );
  f.current.files[task] = matter.stringify(parsed.content, parsed.data);
  for (const output of expectedArtifacts(f.current.files[task]))
    f.current.files[output] = 'already generated';
  await assert.rejects(f.run('ai-start', f.input()), /이미 생성/);
  assert.deepEqual(f.notices, []);
});

test('existing queue task retries preserve original provider/model and prevent legacy direct execution', async () => {
  const f = fixture(),
    payload = f.input({ queueVersion: 1 }),
    queued = await f.run('ai-start', payload),
    writes = f.notices.length;
  assert.deepEqual(
    (await f.run('ai-start', f.input({ queueVersion: 1 }))).queuedTask,
    queued.queuedTask,
  );
  assert.equal(f.notices.length, writes);
  await assert.rejects(
    f.run('ai-start', f.input({ queueVersion: 1, modelId: 'other-model' })),
    /실행 설정/,
  );
  await assert.rejects(f.run('ai-start', f.input()), /예약된 AI 작업/);
});

test('commit wait/failure preserves original approval/files/queue/job and same command can retry', async () => {
  const gate = defer(),
    entered = defer();
  let fail = true;
  const f = fixture({
      beforeCommit: async () => {
        entered.resolve();
        await gate.promise;
        if (fail) throw Error('commit failure');
      },
    }),
    a = f.approval(),
    input = f.approvalInput(a, { queueVersion: 1 }),
    before = structuredClone(f.current);
  const rejected = assert.rejects(
    f.run('requests-start', input),
    /commit failure/,
  );
  await entered.promise;
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  gate.resolve();
  await rejected;
  assert.deepEqual(f.current, before);
  fail = false;
  const result = await f.run('requests-start', { ...input });
  assert.ok(result.queuedTask);
  assert.equal(f.current.approvals[a.id].revision, 2);
  assert.equal(f.current.history.length, 1);
});

test('queued approval uses latest actor and request after another queued operation', async () => {
  const f = fixture(),
    a = f.approval(),
    input = f.approvalInput(a),
    gate = defer();
  const prior = f.queue.run(f.current.id, async () => {
    await gate.promise;
    const next = structuredClone(f.current);
    next.approvals[a.id].revision = 2;
    f.replace(next);
  });
  const stale = assert.rejects(
    f.run('requests-start', input),
    /요청 상태나 내용/,
  );
  gate.resolve();
  await Promise.all([prior, stale]);
  assert.deepEqual(f.notices, []);
  f.current.members[0].removed = true;
  await assert.rejects(
    f.run('requests-start', f.approvalInput(f.current.approvals[a.id])),
    { status: 403 },
  );
});

test('actual SQLite abort rolls back frozen approval/task/history/queue and replay survives reopen', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-ai-start-db-')),
    file = path.join(root, 'sync.sqlite'),
    store = new SyncStore(file),
    db = new DatabaseSync(file);
  t.after(() => {
    db.close();
    store.close();
  });
  const f = fixture({ store }),
    a = f.approval(),
    input = f.approvalInput(a, { queueVersion: 1 });
  store.save(f.current);
  const before = structuredClone(f.current),
    blobs = Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n);
  db.exec(
    "CREATE TRIGGER fail_ai_start BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'ai-start-abort'); END;",
  );
  await assert.rejects(f.run('requests-start', input), /ai-start-abort/);
  assert.deepEqual(f.current, before);
  assert.deepEqual(store.load(), [JSON.parse(JSON.stringify(before))]);
  assert.equal(
    Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n),
    blobs,
  );
  assert.deepEqual(f.notices, []);
  db.exec('DROP TRIGGER fail_ai_start');
  const result = await f.run('requests-start', { ...input });
  const reopened = new SyncStore(file);
  try {
    const p = reopened.load()[0],
      fresh = fixture({ project: p, store: reopened });
    assert.deepEqual(
      (await fresh.run('requests-start', { ...input })).queuedTask,
      JSON.parse(JSON.stringify(result.queuedTask)),
    );
    assert.deepEqual(fresh.notices, []);
    assert.equal(p.approvals[a.id].status, 'queued');
    assert.equal(p.history.length, 1);
  } finally {
    reopened.close();
  }
});
