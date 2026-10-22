import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from '../src/markdown.ts';
import { createTaskFiles } from '../src/task-plan.ts';
import {
  AiQueueService,
  claimSharedAiRun,
} from '../src/application/ai/queue-service.ts';

function fixture() {
  const files = {
    'ideas/a.md': matter.stringify('source', {
      id: 'idea',
      title: 'Idea',
      type: 'idea',
      sources: [],
    }),
  };
  const task = {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new' },
    queueVersion: 1,
  };
  Object.assign(files, createTaskFiles(task, 'one', files));
  Object.assign(files, createTaskFiles(task, 'two', files));
  const store = {
    tasks: [],
    save: async () => {
      if (fail) throw Error('disk full');
    },
  };
  let fail = false,
    id = 0;
  const service = new AiQueueService(
    store,
    async () => files,
    () => `run-${++id}`,
    () => 1000,
  );
  const input = (name) => ({
    taskPath: `.ai/tasks/${name}.md`,
    providerId: 'codex-cli',
    modelId: null,
  });
  return {
    files,
    store,
    service,
    input,
    fail: (value) => {
      fail = value;
    },
  };
}

test('durable queue preserves FIFO, duplicate settings and starting/terminal transitions on persistence failure', async () => {
  const f = fixture();
  f.fail(true);
  await assert.rejects(f.service.reserve(f.input('one')), /disk full/);
  assert.equal(f.store.tasks.length, 0);
  f.fail(false);
  const one = await f.service.reserve(f.input('one'));
  const two = await f.service.reserve(f.input('two'));
  assert.equal(await f.service.reserve(f.input('one')), one);
  await assert.rejects(
    f.service.reserve({ ...f.input('one'), modelId: 'changed' }),
    /설정을 변경/,
  );
  assert.equal(f.service.next(), one);
  f.fail(true);
  await assert.rejects(f.service.start(one.taskId), /disk full/);
  assert.equal(one.status, 'queued');
  f.fail(false);
  await f.service.start(one.taskId);
  assert.equal(one.status, 'starting');
  assert.equal(f.service.next(), undefined);
  f.fail(true);
  await assert.rejects(f.service.finish(one, 'failed', 'failed'), /disk full/);
  assert.equal(one.status, 'starting');
  f.fail(false);
  await f.service.finish(one, 'failed', 'failed');
  assert.equal(f.service.next(), two);
});

test('changed queued inputs and lost claims never execute; successful claims preserve one server lease identity', async () => {
  const f = fixture();
  const task = await f.service.reserve(f.input('one'));
  f.files['ideas/a.md'] += '\nexternal';
  await assert.rejects(f.service.start(task.taskId), /예약 후/);
  assert.equal(task.status, 'queued');
  let begins = 0;
  const port = {
    state: { aiRun: { runId: 'server-run', taskPath: task.taskPath } },
    claimAi: async () => ({ files: f.files, lease: null }),
    beginAi: async () => {
      begins++;
      return f.files;
    },
  };
  assert.equal(await claimSharedAiRun(port, f.input('one'), task), null);
  assert.equal(begins, 0);
  port.claimAi = async () => ({
    files: f.files,
    lease: 'server-lease',
    runId: 'server-run',
  });
  const claimed = await claimSharedAiRun(port, f.input('one'), task);
  assert.equal(claimed.runId, 'server-run');
  assert.equal(claimed.files, f.files);
  assert.equal(begins, 0);
});
