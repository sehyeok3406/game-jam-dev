import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { createTaskFiles } from '../src/task-plan.ts';
import {
  createQueuedTask,
  nextQueuedTasks,
  queueFileLock,
  materialUsage,
  validateQueuedInputs,
} from '../src/ai-task-queue.ts';
import {
  aiScopesOverlap,
  assertAiFilesUnlocked,
  isAiFileLocked,
} from '../src/ai-file-lock.ts';
import { AiQueueStore } from '../src/ai-queue-store.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';

const initial = () => ({
  'ideas/a.md': matter.stringify('shared input', {
    id: 'a',
    title: 'Shared',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
  'ideas/b.md': matter.stringify('other input', {
    id: 'b',
    title: 'Other',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
});
const input = {
  kind: 'implement',
  inputPaths: ['ideas/a.md'],
  x: 0,
  y: 0,
  htmlResult: { mode: 'new' },
  queueVersion: 1,
};
const settings = (taskPath) => ({
  taskPath,
  providerId: 'codex-cli',
  modelId: null,
});
const planned = () => {
  const files = initial();
  Object.assign(files, createTaskFiles(input, 'one', files));
  Object.assign(files, createTaskFiles(input, 'two', files));
  return files;
};

test('shared read reservations retain protection until the last owner ends; FIFO and future capacity two work', () => {
  const files = planned();
  const a = createQueuedTask(files, settings('.ai/tasks/one.md'), 'one', []);
  const b = createQueuedTask(files, settings('.ai/tasks/two.md'), 'two', [a]);
  const tasks = [a, b];
  assert.match(materialUsage(tasks, 'ideas/a.md'), /예약 2/);
  assert.deepEqual(
    nextQueuedTasks(tasks).map((t) => t.runId),
    ['one'],
  );
  assert.deepEqual(
    nextQueuedTasks(tasks, 2).map((t) => t.runId),
    ['one', 'two'],
  );
  a.status = 'running';
  assert.deepEqual(nextQueuedTasks(tasks), []);
  assert.match(materialUsage(tasks, 'ideas/a.md'), /작업 중 1 · 예약 1/);
  b.status = 'cancelled';
  assert.equal(isAiFileLocked(queueFileLock(tasks), 'ideas/a.md'), true);
  a.status = 'completed';
  assert.equal(isAiFileLocked(queueFileLock(tasks), 'ideas/a.md'), false);
  assert.equal(materialUsage(tasks, 'ideas/a.md'), '');
});

test('write/read and write/write conflicts include folders, dynamic prefixes and case-normalized paths', () => {
  const files = planned();
  const a = createQueuedTask(files, settings('.ai/tasks/one.md'), 'one', []);
  const parsed = matter(files['.ai/tasks/two.md']);
  files['.ai/tasks/two.md'] = matter.stringify(parsed.content, {
    ...parsed.data,
    expected_outputs: ['ideas/a.md'],
  });
  assert.throws(
    () => createQueuedTask(files, settings('.ai/tasks/two.md'), 'two', [a]),
    /겹칩니다/,
  );
  const folder = { paths: [], folders: ['output/game/v001'] };
  assert.equal(
    aiScopesOverlap(folder, {
      paths: ['OUTPUT\\GAME\\v001\\assets/a.js'],
      folders: [],
    }),
    true,
  );
  assert.equal(
    aiScopesOverlap(folder, {
      paths: [],
      folders: [],
      prefixes: ['output/game/v001/assets/'],
    }),
    true,
  );
  assert.equal(
    aiScopesOverlap(folder, { paths: [], folders: ['output/game/v001-other'] }),
    false,
  );
  const conflicting = {
    ...a,
    taskId: 'conflict',
    runId: 'conflict',
    status: 'queued',
  };
  a.status = 'running';
  assert.deepEqual(nextQueuedTasks([a, conflicting], 2), []);
});

test('frozen input verification ignores unrelated edits and detects reserved output additions', () => {
  const files = planned();
  const a = createQueuedTask(files, settings('.ai/tasks/one.md'), 'one', []);
  assert.doesNotThrow(() =>
    validateQueuedInputs(a, { ...files, 'ideas/b.md': 'unrelated' }),
  );
  assert.throws(
    () =>
      validateQueuedInputs(a, { ...files, 'ideas/a.md': 'external change' }),
    /예약 후/,
  );
  assert.throws(
    () =>
      validateQueuedInputs(a, {
        ...files,
        [a.writeScope.folders[0] + '/assets/injected.js']: 'external',
      }),
    /예약 후/,
  );
  assert.throws(
    () => assertAiFilesUnlocked(queueFileLock([a]), ['ideas/a.md']),
    /AI 작업/,
  );
});

test('durable queue recovery fails an interrupted attempt and preserves queued inputs and ordering', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-queue-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'queue.json');
  const store = await new AiQueueStore(filename).load();
  const files = planned();
  const a = createQueuedTask(files, settings('.ai/tasks/one.md'), 'one', []);
  const b = createQueuedTask(files, settings('.ai/tasks/two.md'), 'two', [a]);
  a.status = 'running';
  store.tasks.push(a, b);
  await store.save();
  const restored = await new AiQueueStore(filename).load();
  assert.deepEqual(
    restored.tasks.map((task) => task.status),
    ['failed', 'queued'],
  );
  assert.equal(restored.tasks[1].baseline['ideas/a.md'], files['ideas/a.md']);
  assert.equal('baseline' in restored.views()[1], false);
  assert.deepEqual(
    nextQueuedTasks(restored.tasks).map((task) => task.runId),
    ['two'],
  );
});

async function shared(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-queue-server-'));
  let server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'queue',
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    'queue',
    'owner',
    'queue',
    initial(),
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    created.credentials.serverUrl,
    created.result.code,
    'second',
  );
  const second = new CollaborationClient(joined.credentials, () => {});
  second.accept(joined.result);
  await owner.setRole(second.state.memberId, 'admin');
  await second.refresh();
  t.after(async () => {
    owner.stop();
    second.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    owner,
    second,
    restart: async () => {
      await server.close();
      server = await createCollaborationServer({
        dataDirectory: root,
        port: 0,
        creationKey: 'queue',
      });
      owner.credentials.serverUrl =
        second.credentials.serverUrl = `http://127.0.0.1:${server.port}`;
      owner.lease = null;
      second.lease = null;
      await owner.refresh();
      await second.refresh();
    },
  };
}

test('server queue shares inputs, claims once across administrators, advances FIFO and fences individual cancellation', async (t) => {
  const { owner, second } = await shared(t);
  const first = await owner.command('tasks:create', input);
  const a = await owner.enqueueAi(settings(first.relativePath));
  const duplicate = await owner.enqueueAi(settings(first.relativePath));
  assert.equal(duplicate.taskId, a.taskId);
  const next = await owner.command('tasks:create', input);
  const b = await owner.enqueueAi(settings(next.relativePath));
  await second.refresh();
  await assert.rejects(second.lock('ideas/a.md'), /AI 작업/);
  await assert.rejects(
    second.request('ai-start', {
      ...settings(next.relativePath),
      revision: second.state.revision,
    }),
    /예약/,
  );
  const claims = await Promise.all([
    owner.claimAi(a.taskId),
    second.claimAi(a.taskId),
  ]);
  assert.equal(claims.filter((claim) => claim.lease).length, 1);
  const executor = claims[0].lease ? owner : second;
  const observer = executor === owner ? second : owner;
  await observer.refresh();
  assert.equal(
    observer.state.aiQueue.find((task) => task.taskId === a.taskId).status,
    'starting',
  );
  assert.equal((await observer.claimAi(b.taskId)).lease, null);
  await assert.rejects(observer.cancelAi(), /작업 ID/);
  await executor.finishAi('failed');
  await observer.refresh();
  await assert.rejects(observer.lock('ideas/a.md'), /AI 작업/);
  assert.ok((await observer.claimAi(b.taskId)).lease);
  await observer.finishAi('failed');
  await owner.refresh();
  assert.deepEqual(
    owner.state.aiQueue.map((task) => task.status),
    ['failed', 'failed'],
  );
  await owner.lock('ideas/a.md');
  await owner.unlock('ideas/a.md');
});

test('queued cancellation releases only its ownership and server restart preserves remaining reservations', async (t) => {
  const { owner, restart } = await shared(t);
  const a = await owner.enqueueAi(
    settings((await owner.command('tasks:create', input)).relativePath),
  );
  const b = await owner.enqueueAi(
    settings((await owner.command('tasks:create', input)).relativePath),
  );
  await owner.cancelQueuedTask(a.taskId);
  await assert.rejects(owner.lock('ideas/a.md'), /AI 작업/);
  await restart();
  assert.equal(
    owner.state.aiQueue.find((task) => task.taskId === b.taskId).status,
    'queued',
  );
  assert.ok((await owner.claimAi(b.taskId)).lease);
  await owner.cancelAi(b.runId);
  await owner.lock('ideas/a.md');
  await owner.unlock('ideas/a.md');
});

test('reasoning survives server reservations and restart, fences changed retries and incompatible executors', async (t) => {
  const { owner, restart } = await shared(t);
  const task = await owner.command('tasks:create', input);
  const choice = {
    taskPath: task.relativePath,
    providerId: 'claude-cli',
    modelId: 'claude-opus-5-5',
    reasoningEffort: 'xhigh',
  };
  assert.equal(owner.state.aiReasoningVersion, 1);
  const queued = await owner.enqueueAi(choice);
  assert.equal(queued.reasoningEffort, 'xhigh');
  assert.equal((await owner.enqueueAi(choice)).taskId, queued.taskId);
  await assert.rejects(
    owner.enqueueAi({ ...choice, reasoningEffort: 'low' }),
    /실행 설정/,
  );
  await assert.rejects(
    owner.request('ai-claim', {
      taskId: queued.taskId,
      claimId: crypto.randomUUID(),
    }),
    /추론 수준/,
  );
  await restart();
  assert.equal(owner.state.aiQueue[0].reasoningEffort, 'xhigh');
  const claim = await owner.claimAi(queued.taskId);
  assert.ok(claim.lease);
  assert.equal(owner.state.aiRun.reasoningEffort, 'xhigh');
  await owner.finishAi('failed');
  const history = await owner.history();
  assert.ok(history.some((entry) => entry.reasoningEffort === 'xhigh'));
  owner.state.aiReasoningVersion = undefined;
  await assert.rejects(owner.enqueueAi(choice), /추론 수준/);
});

test('lost registration and claim acknowledgements retry the same operation without duplicating work', async (t) => {
  const { owner } = await shared(t);
  const task = await owner.command('tasks:create', input);
  const original = owner.request.bind(owner);
  const lost = new Set(['ai-start', 'ai-claim']);
  owner.request = async (action, command) => {
    const result = await original(action, command);
    if (lost.delete(action))
      throw new TypeError('fixture lost acknowledgement');
    return result;
  };
  const queued = await owner.enqueueAi(settings(task.relativePath));
  assert.equal(owner.state.aiQueue.length, 1);
  const claim = await owner.claimAi(queued.taskId);
  assert.ok(claim.lease);
  assert.equal(claim.runId, queued.runId);
  assert.equal(owner.state.aiQueue.length, 1);
  await owner.finishAi('failed');
});

test('approvals can be queued during another run and become immutable before execution', async (t) => {
  const { owner } = await shared(t);
  const a = await owner.enqueueAi(
    settings((await owner.command('tasks:create', input)).relativePath),
  );
  await owner.claimAi(a.taskId);
  const request = {
    organize: false,
    implement: true,
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    resultName: 'approved',
    htmlResult: { mode: 'new' },
    instructions: { organize: '문서 정리', implement: '간단한 게임 구현' },
  };
  const pending = await owner.mutateApproval('create', {
    commandId: crypto.randomUUID(),
    request,
  });
  const detail = await owner.readApproval(pending.id);
  const approval = {
    id: pending.id,
    revision: detail.item.revision,
    reviewToken: detail.reviewToken,
    commandId: crypto.randomUUID(),
  };
  const b = await owner.enqueueAi({ ...settings(''), approval });
  const repeat = await owner.enqueueAi({ ...settings(''), approval });
  assert.equal(repeat.taskId, b.taskId);
  assert.equal((await owner.readApproval(pending.id)).item.status, 'queued');
  await assert.rejects(
    owner.mutateApproval('update', {
      id: pending.id,
      revision: (await owner.readApproval(pending.id)).item.revision,
      commandId: crypto.randomUUID(),
      request,
    }),
    /시작|종료/,
  );
  await owner.cancelQueuedTask(b.taskId);
  assert.equal((await owner.readApproval(pending.id)).item.status, 'stopped');
  await owner.finishAi('failed');
});

test('server restart fails the orphan attempt but retains and can claim the next frozen reservation', async (t) => {
  const { owner, restart } = await shared(t);
  const a = await owner.enqueueAi(
    settings((await owner.command('tasks:create', input)).relativePath),
  );
  const b = await owner.enqueueAi(
    settings((await owner.command('tasks:create', input)).relativePath),
  );
  await owner.claimAi(a.taskId);
  await restart();
  assert.deepEqual(
    owner.state.aiQueue.map((task) => task.status),
    ['failed', 'queued'],
  );
  assert.ok((await owner.claimAi(b.taskId)).lease);
  await owner.finishAi('failed');
});
