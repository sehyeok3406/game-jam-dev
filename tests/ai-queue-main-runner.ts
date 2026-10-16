import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../src/main';
import { createCollaborationServer } from '../src/collaboration-server';
import { handlers, events, createdWindows, root, app } from './mocks/electron';
import { executionStarts } from './mocks/process';

const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const call = async (channel: string, ...args: unknown[]): Promise<any> => {
  const win = createdWindows[0];
  const handler = handlers.get(channel);
  assert.ok(handler, channel);
  return handler(
    { sender: win?.webContents, senderFrame: win?.webContents.mainFrame },
    ...args,
  );
};
async function wait(check: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return;
    await pause();
  }
  throw new Error(
    'Queue main timeout: ' +
      JSON.stringify({
        queue: await call('ai-queue:list'),
        shared: await call('collaboration:get'),
        starts: executionStarts,
        events: events.slice(-2),
      }),
  );
}
let server: Awaited<ReturnType<typeof createCollaborationServer>> | undefined;
try {
  await wait(async () => createdWindows.length > 0);
  await call('projects:create', 'Queue runtime');
  const idea = await call('documents:create-idea', { x: 0, y: 0 });
  const task = () =>
    call('tasks:create', {
      queueVersion: 1,
      kind: 'implement',
      inputPaths: [idea.relativePath],
      htmlResult: { mode: 'new' },
      x: 500,
      y: 0,
    });
  const enqueue = async (model = 'fixture-concurrent') =>
    call('codex:start', {
      queueVersion: 1,
      taskPath: (await task()).relativePath,
      providerId: 'codex-cli',
      modelId: model,
    });
  const a = await enqueue();
  await wait(
    async () =>
      executionStarts.length === 1 &&
      (await call('ai-queue:list')).some(
        (t: any) =>
          t.runId === a.runId && ['starting', 'running'].includes(t.status),
      ),
  );
  const b = await enqueue();
  const c = await enqueue('fixture-implicit-body');
  assert.equal(
    (await call('ai-queue:list')).find((t: any) => t.runId === c.runId).status,
    'queued',
  );
  assert.equal(executionStarts.length, 1);
  await call('ai-queue:cancel', b.runId);
  await assert.rejects(
    call('documents:save', {
      relativePath: idea.relativePath,
      title: 'blocked',
      body: 'blocked',
    }),
    /AI 작업/,
  );
  await wait(
    async () =>
      (await call('ai-queue:list')).find((t: any) => t.runId === c.runId)
        ?.status === 'completed',
  );
  assert.equal(
    events.find((e) => e.runId === a.runId && e.status === 'completed')?.status,
    'completed',
  );
  assert.equal(executionStarts.length, 2);
  assert.equal((await call('preview:list')).length, 2);
  await call('documents:save', {
    relativePath: idea.relativePath,
    title: 'unlocked',
    body: 'after all tasks',
  });
  console.log(
    'PASS: production local queue executes FIFO, preserves shared locks, cancels one reservation and publishes distinct outputs',
  );

  const html = (await call('preview:list'))[0];
  const compose = async () => {
    const task = await call('tasks:create', {
      queueVersion: 1,
      kind: 'implement',
      sourceMode: 'html-compose',
      inputPaths: [idea.relativePath, html.relativePath],
      htmlResult: { mode: 'new' },
      x: 500,
      y: 0,
    });
    return call('codex:start', {
      queueVersion: 1,
      taskPath: task.relativePath,
      providerId: 'codex-cli',
      modelId: 'fixture-queue-html-compose',
    });
  };
  const htmlA = await compose();
  const htmlB = await compose();
  await wait(
    async () =>
      (await call('ai-queue:list')).find((t: any) => t.runId === htmlB.runId)
        ?.status === 'completed',
  );
  assert.equal(
    (await call('ai-queue:list')).find((t: any) => t.runId === htmlA.runId)
      ?.status,
    'completed',
  );
  assert.equal(
    (await call('preview:read', html.relativePath)).content,
    html.content,
  );
  console.log(
    'PASS: production queue can reuse the same original HTML and Markdown in successive frozen compositions',
  );

  server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'queue',
  });
  await call('collaboration:create', {
    serverUrl: `http://127.0.0.1:${server.port}`,
    serverKey: 'queue',
    nickname: 'owner',
  });
  const before = executionStarts.length;
  const d = await enqueue();
  await wait(
    async () =>
      executionStarts.length === before + 1 &&
      (await call('ai-queue:list')).some(
        (t: any) =>
          t.runId === d.runId && ['starting', 'running'].includes(t.status),
      ),
  );
  const e = await enqueue('fixture-implicit-body');
  assert.equal(executionStarts.length, before + 1);
  await wait(
    async () =>
      (await call('ai-queue:list')).find((t: any) => t.runId === e.runId)
        ?.status === 'completed',
  );
  assert.equal(executionStarts.length, before + 2);
  assert.equal(
    (await call('ai-queue:list')).find((t: any) => t.runId === d.runId)?.status,
    'completed',
  );
  console.log(
    'PASS: desktop executor claims server reservations one at a time and continues automatically',
  );
} finally {
  for (const listener of app.listeners('before-quit'))
    (listener as () => void)();
  await server?.close();
  await pause(500);
  await fs.rm(root, { recursive: true, force: true });
}
