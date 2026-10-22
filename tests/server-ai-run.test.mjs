import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import matter from '../src/markdown.ts';
import { createTaskFiles } from '../src/task-plan.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';
import { taskFileLock, aiLockedSnapshot } from '../src/ai-file-lock.ts';
import { createQueuedTask } from '../src/ai-task-queue.ts';
import { createAiRunService } from '../src/server/services/ai-run-service.ts';
import { planAiResult } from '../src/server/services/ai-result.ts';
import { synchronizeAiState } from '../src/server/services/ai-state.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { SyncStore } from '../src/sync-store.ts';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const taskPath = '.ai/tasks/run.md';
const html =
  '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>검증</title></head><body><h1>결과</h1></body></html>';
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(options = {}) {
  let clock = 1000;
  const base = {
    'ideas/a.md': matter.stringify('원본', {
      id: 'a',
      type: 'idea',
      sources: [],
    }),
    'ideas/other.md': matter.stringify('별도 문서', {
      id: 'b',
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
        x: 10,
        y: 20,
        htmlResult: { mode: 'new' },
        queueVersion: 1,
      },
      'run',
      base,
    ),
  };
  const task = createQueuedTask(
    files,
    { taskPath, providerId: 'codex-cli', modelId: null, actorId: 'admin' },
    'run-1',
    [],
  );
  task.status = options.queuedOnly ? 'queued' : 'starting';
  const scope = taskFileLock(files, taskPath);
  let current = options.project ?? {
    id: randomUUID(),
    name: 'AI 수명 검증',
    revision: 1,
    files,
    revisions: {},
    history: [],
    applied: [],
    authorship: {},
    members: [
      { id: 'admin', nickname: '관리자', role: 'admin', tokenHash: 'admin' },
      {
        id: 'other',
        nickname: '다른 관리자',
        role: 'admin',
        tokenHash: 'other',
      },
      { id: 'editor', nickname: '팀원', role: 'editor', tokenHash: 'editor' },
      { id: 'viewer', nickname: '뷰어', role: 'viewer', tokenHash: 'viewer' },
    ],
    aiQueue: [task],
    requestsVersion: 2,
    approvals: {
      approval: {
        id: 'approval',
        taskPath,
        status: options.queuedOnly ? 'queued' : 'running',
        revision: 2,
        changes: [],
        approvedBy: 'admin',
        approvedName: '관리자',
      },
    },
    job: options.queuedOnly
      ? null
      : {
          id: 'lease-1',
          memberId: 'admin',
          queueTaskId: task.taskId,
          taskPath,
          outputs: expectedArtifacts(files[taskPath]),
          revision: 1,
          baselineHash: hash(JSON.stringify(aiLockedSnapshot(files, scope))),
          fileLock: scope,
          expiresAt: 31000,
          startedAt: 1000,
          providerId: 'codex-cli',
          modelId: null,
          event: { ...task, kind: 'status', timestamp: 1000 },
        },
    lastRun: null,
  };
  const queue = new ProjectQueue(),
    notices = [];
  const policy = createAccessPolicy({
    matches: (a, b) => a === b,
    now: () => clock,
    seen: () => {},
    locks: () => new Map(),
  });
  const service = createAiRunService({
    clone: structuredClone,
    admin: policy.admin,
    now: () => clock,
    digest: hash,
    persist: async (p) => {
      synchronizeAiState(p, () => clock);
      await options.beforeCommit?.(p);
      options.store?.save(p);
      current = p;
      notices.push(p.revision);
    },
    envelope: (p) => ({ files: p.files, job: p.job, lastRun: p.lastRun }),
    taskState: (state, relative, status) => {
      const parsed = matter(state[relative]);
      return {
        ...state,
        [relative]: matter.stringify(parsed.content, {
          ...parsed.data,
          status,
          ai_updated_at: new Date(clock).toISOString(),
        }),
      };
    },
    recordChanges: (p, m, next, label, kind, extra) => {
      const before = p.files;
      p.revision++;
      p.files = next;
      p.history.push({
        entry: { id: randomUUID(), actorId: m.id, label, kind, ...extra },
        before: { ...before },
        after: { ...next },
      });
    },
  });
  const run = (action, payload = {}, actor = 'admin') =>
    queue.run(current.id, async () => {
      const member = policy.authenticate(current, actor);
      current = await service.expire(current);
      return action === 'ai-queue-cancel'
        ? service.cancelQueued(current, member, payload)
        : service.update(current, member, action, {
            lease: 'lease-1',
            ...payload,
          });
    });
  const finish = (patch = {}) => ({
    status: 'completed',
    artifacts: Object.fromEntries(
      expectedArtifacts(current.files[taskPath]).map((p) => [p, html]),
    ),
    ...patch,
  });
  return {
    service,
    queue,
    run,
    finish,
    notices,
    get current() {
      return current;
    },
    time: (value) => (clock = value),
  };
}

test('AI heartbeat renews only the owning lease in memory, without publishing a commit', async () => {
  const f = fixture();
  f.time(2000);
  await assert.rejects(f.run('ai-heartbeat', { lease: 'wrong' }), {
    status: 403,
  });
  await assert.rejects(f.run('ai-heartbeat', {}, 'other'), { status: 403 });
  await assert.rejects(f.run('ai-heartbeat', {}, 'viewer'), { status: 403 });
  assert.deepEqual(await f.run('ai-heartbeat'), {});
  assert.equal(f.current.job.expiresAt, 32000);
  assert.deepEqual(f.notices, []);
  assert.equal(f.current.revision, 1);
});

test('AI progress accepts active states, synchronizes its queue and keeps request/history versions', async () => {
  const f = fixture();
  for (const status of ['starting', 'running', 'validating']) {
    f.time(2000);
    await f.run('ai-progress', { status });
    assert.equal(f.current.job.event.status, status);
    assert.equal(f.current.aiQueue[0].status, status);
    assert.ok(Object.keys(f.current.aiQueue[0].baseline).length);
  }
  const before = structuredClone(f.current);
  for (const status of ['completed', 'failed', 'cancelled', 'queued', null])
    await assert.rejects(f.run('ai-progress', { status }), /작업 상태/);
  assert.deepEqual(f.current, before);
  assert.equal(f.current.history.length, 0);
  assert.equal(f.current.requestsVersion, 2);
});

test('AI result planning is pure, validates exact outputs and uses the injected completion clock', () => {
  const f = fixture(),
    before = structuredClone(f.current),
    result = planAiResult(
      f.current,
      f.current.job,
      f.finish(),
      () => 2000,
      hash,
    );
  assert.deepEqual(f.current, before);
  assert.equal(result.status, 'completed');
  assert.equal(result.success, true);
  assert.equal(
    matter(result.files[taskPath]).data.ai_finished_at,
    new Date(2000).toISOString(),
  );
  const output = f.current.job.outputs[0];
  assert.equal(result.files[output], html);
});

test('AI completion publishes output, task/history and queue/approval terminal status together exactly once', async () => {
  const f = fixture(),
    output = f.current.job.outputs[0];
  await f.run('ai-finish', f.finish());
  assert.equal(f.current.files[output], html);
  assert.equal(f.current.job, null);
  assert.equal(f.current.lastRun.kind, 'result');
  assert.equal(f.current.lastRun.status, 'completed');
  assert.equal(f.current.history[0].entry.status, 'completed');
  assert.equal(f.current.history[0].entry.createdAt, 1000);
  assert.equal(f.current.aiQueue[0].status, 'completed');
  assert.deepEqual(f.current.aiQueue[0].baseline, {});
  const a = f.current.approvals.approval;
  assert.equal(a.status, 'completed');
  assert.equal(a.revision, 3);
  assert.equal(a.changes[0].actorId, 'admin');
  assert.equal(f.current.requestsVersion, 3);
  await assert.rejects(f.run('ai-finish', f.finish()), /끝났거나/);
  assert.equal(f.current.history.length, 1);
  assert.equal(f.notices.length, 1);
});

test('AI completion rejects changed protected material while scoped results allow unrelated edits', async () => {
  const f = fixture();
  f.current.files['ideas/a.md'] += '변경';
  const before = structuredClone(f.current);
  await assert.rejects(f.run('ai-finish', f.finish()), { code: 'GC-SYNC-001' });
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  const g = fixture();
  g.current.files['ideas/other.md'] += '별도 변경';
  await g.run('ai-finish', g.finish());
  assert.match(g.current.files['ideas/other.md'], /별도 변경$/);
});

test('legacy AI jobs without a file scope still validate the whole input snapshot', async () => {
  const f = fixture();
  delete f.current.job.fileLock;
  f.current.job.baselineHash = hash(JSON.stringify(f.current.files));
  f.current.files['ideas/other.md'] += '변경';
  await assert.rejects(f.run('ai-finish', f.finish()), { code: 'GC-SYNC-001' });
  assert.equal(f.current.job.id, 'lease-1');
  assert.deepEqual(f.notices, []);
});

test('invalid artifact shape, extra/missing output and invalid HTML never end the AI lease', async () => {
  const f = fixture(),
    output = f.current.job.outputs[0],
    before = structuredClone(f.current);
  // Existing HTML parsing supports fragments; preserve that compatibility explicitly.
  assert.equal(
    planAiResult(
      f.current,
      f.current.job,
      f.finish({ artifacts: { [output]: '<h1>HTML 조각</h1>' } }),
      () => 2000,
      hash,
    ).files[output],
    '<h1>HTML 조각</h1>',
  );
  for (const artifacts of [
    null,
    [],
    {},
    { [output]: 123 },
    { [output]: html, 'ideas/unexpected.md': '덮어쓰기' },
    { [output]: '```html\n<h1>코드 블록</h1>\n```' },
  ]) {
    await assert.rejects(f.run('ai-finish', f.finish({ artifacts })));
    assert.deepEqual(f.current, before);
  }
  assert.deepEqual(f.notices, []);
});

test('failed and cancelled completion ignore submitted outputs and preserve prior documents', async () => {
  for (const status of ['failed', 'cancelled']) {
    const f = fixture(),
      original = f.current.files['ideas/a.md'];
    await f.run(
      'ai-finish',
      f.finish({
        status,
        failure: { code: 'unknown', message: '오류 '.repeat(2000) },
      }),
    );
    assert.equal(f.current.files['ideas/a.md'], original);
    assert.equal(
      f.current.files[expectedArtifacts(f.current.files[taskPath])[0]],
      undefined,
    );
    assert.equal(f.current.lastRun.status, status);
    assert.equal(f.current.lastRun.kind, 'status');
    assert.equal(f.current.job, null);
    assert.equal(
      f.current.approvals.approval.status,
      status === 'cancelled' ? 'stopped' : 'failed',
    );
    const data = matter(f.current.files[taskPath]).data;
    if (status === 'failed') {
      assert.equal(data.ai_error_code, 'GC-AI-002');
      assert.ok(f.current.lastRun.failure.message.length <= 4000);
    } else assert.equal(data.ai_error, null);
  }
});

test('queued AI cancel requires matching run ID and owning actor/admin without requiring the worker lease', async () => {
  const f = fixture(),
    before = structuredClone(f.current);
  await assert.rejects(f.run('ai-cancel'), /작업 ID/);
  await assert.rejects(f.run('ai-cancel', { runId: 'run-1' }, 'editor'), {
    status: 403,
  });
  assert.deepEqual(f.current, before);
  await f.run('ai-cancel', { runId: 'run-1', lease: 'not-needed' }, 'other');
  assert.equal(f.current.job, null);
  assert.equal(f.current.lastRun.status, 'cancelled');
  assert.match(f.current.lastRun.message, /다른 관리자/);
  assert.equal(f.current.approvals.approval.status, 'stopped');
  assert.equal(f.current.history[0].entry.actorId, 'other');
});

test('legacy unqueued AI cancel preserves owner permission and optional run ID', async () => {
  const f = fixture();
  delete f.current.job.queueTaskId;
  f.current.job.memberId = 'editor';
  f.current.aiQueue = [];
  await f.run('ai-cancel', { lease: 'unused' }, 'editor');
  assert.equal(f.current.lastRun.status, 'cancelled');
  assert.equal(f.current.history.length, 1);
});

test('queued cancellation is admin-only, stops its approval and cancelled replay has no new history', async () => {
  const f = fixture({ queuedOnly: true });
  await assert.rejects(
    f.run('ai-queue-cancel', { taskId: 'run-1' }, 'editor'),
    { status: 403 },
  );
  await assert.rejects(f.run('ai-queue-cancel', { taskId: 'missing' }), {
    status: 404,
  });
  await f.run('ai-queue-cancel', { taskId: 'run-1' });
  assert.equal(f.current.aiQueue[0].status, 'cancelled');
  assert.deepEqual(f.current.aiQueue[0].baseline, {});
  assert.equal(f.current.approvals.approval.status, 'stopped');
  await f.run('ai-queue-cancel', { taskId: 'run-1' });
  assert.equal(f.current.history.length, 1);
  assert.equal(f.notices.length, 1);
  const g = fixture();
  await assert.rejects(
    g.run('ai-queue-cancel', { taskId: 'run-1' }),
    /실행 중/,
  );
  assert.deepEqual(g.notices, []);
});

test('AI expiry at the exact deadline fails task/approval once and rejects late worker events', async () => {
  const f = fixture();
  f.time(30999);
  assert.strictEqual(await f.service.expire(f.current), f.current);
  assert.deepEqual(f.notices, []);
  f.time(31000);
  await assert.rejects(f.run('ai-heartbeat'), /끝났거나/);
  assert.equal(f.current.job, null);
  assert.equal(f.current.lastRun.kind, 'error');
  assert.equal(f.current.history[0].entry.status, 'failed');
  assert.equal(f.current.approvals.approval.status, 'failed');
  assert.deepEqual(f.current.aiQueue[0].baseline, {});
  await f.service.expire(f.current);
  await assert.rejects(f.run('ai-progress', { status: 'running' }), /끝났거나/);
  assert.equal(f.current.history.length, 1);
});

test('AI progress does not publish/mutate current state while its commit waits or fails', async () => {
  const gate = defer(),
    entered = defer();
  let fail = true;
  const f = fixture({
      beforeCommit: async () => {
        entered.resolve();
        await gate.promise;
        if (fail) throw Error('commit-failed');
      },
    }),
    before = structuredClone(f.current);
  const rejected = assert.rejects(
    f.run('ai-progress', { status: 'validating' }),
    /commit-failed/,
  );
  await entered.promise;
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.notices, []);
  gate.resolve();
  await rejected;
  assert.deepEqual(f.current, before);
  fail = false;
  await f.run('ai-progress', { status: 'validating' });
  assert.equal(f.current.job.event.status, 'validating');
  assert.equal(f.notices.length, 1);
});

test('AI terminal synchronization is idempotent and does not finalize an active or unrelated request', () => {
  const f = fixture();
  f.current.approvals.unrelated = {
    id: 'unrelated',
    taskPath: '.ai/tasks/else.md',
    status: 'running',
    revision: 1,
    changes: [],
  };
  f.current.lastRun = {
    ...f.current.job.event,
    status: 'failed',
    message: '실패',
    timestamp: 2000,
  };
  synchronizeAiState(f.current, () => 2000);
  assert.equal(f.current.approvals.approval.status, 'running');
  f.current.job = null;
  synchronizeAiState(f.current, () => 2000);
  assert.equal(f.current.approvals.approval.status, 'failed');
  assert.equal(f.current.approvals.unrelated.status, 'running');
  const before = structuredClone(f.current);
  synchronizeAiState(f.current, () => 3000);
  assert.deepEqual(f.current, before);
});

for (const action of ['ai-progress', 'ai-finish'])
  test(`actual SQLite abort of ${action} retains current/stored lease, output, history and approval; retry survives reopen`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-ai-run-db-')),
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
      blobs = Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n);
    db.exec(
      "CREATE TRIGGER fail_ai_run BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'ai-run-abort'); END;",
    );
    const input =
      action === 'ai-finish' ? f.finish() : { status: 'validating' };
    await assert.rejects(f.run(action, input), /ai-run-abort/);
    assert.deepEqual(f.current, before);
    assert.deepEqual(store.load(), stored);
    assert.deepEqual(f.notices, []);
    assert.equal(
      Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n),
      blobs,
    );
    db.exec('DROP TRIGGER fail_ai_run');
    await f.run(action, input);
    assert.equal(f.notices.length, 1);
    const reopened = new SyncStore(file);
    try {
      const restored = reopened.load().find((p) => p.id === f.current.id);
      assert.deepEqual(
        restored.job ? restored.job.event.status : restored.lastRun.status,
        action === 'ai-finish' ? 'completed' : 'validating',
      );
      assert.equal(restored.history.length, action === 'ai-finish' ? 1 : 0);
    } finally {
      reopened.close();
    }
  });
for (const action of ['ai-cancel', 'ai-queue-cancel', 'expiry'])
  test(`failed ${action} commit retains the lease/task/approval and can retry`, async () => {
    let fail = true;
    const f = fixture({
      queuedOnly: action === 'ai-queue-cancel',
      beforeCommit: async () => {
        if (fail) throw Error('terminal-commit-failed');
      },
    });
    if (action === 'expiry') f.time(31000);
    const before = structuredClone(f.current),
      invoke = () =>
        f.run(action === 'expiry' ? 'ai-heartbeat' : action, {
          taskId: 'run-1',
          runId: 'run-1',
        });
    await assert.rejects(invoke(), /terminal-commit-failed/);
    assert.deepEqual(f.current, before);
    assert.deepEqual(f.notices, []);
    fail = false;
    if (action === 'expiry') await assert.rejects(invoke(), /끝났거나/);
    else await invoke();
    assert.equal(f.current.job, null);
    assert.equal(f.current.history.length, 1);
    assert.equal(f.notices.length, 1);
    assert.equal(
      f.current.lastRun.status,
      action === 'expiry' ? 'failed' : 'cancelled',
    );
  });

test('queued worker updates recheck the current lease after an earlier operation replaces it', async () => {
  const f = fixture(),
    gate = defer();
  const prior = f.queue.run(f.current.id, async () => {
    await gate.promise;
    f.current.job.id = 'lease-replaced';
  });
  const stale = assert.rejects(f.run('ai-finish', f.finish()), { status: 403 });
  gate.resolve();
  await Promise.all([prior, stale]);
  assert.equal(f.current.job.id, 'lease-replaced');
  assert.equal(f.current.history.length, 0);
  assert.deepEqual(f.notices, []);
});
