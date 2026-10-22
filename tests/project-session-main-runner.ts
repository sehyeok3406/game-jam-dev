import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, handlers, createdWindows, root } from './mocks/electron';
import '../src/main';

async function call(channel: string, ...args: unknown[]) {
  const window = createdWindows[0];
  return handlers.get(channel)!(
    { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    ...args,
  ) as Promise<any>;
}
const originalRead = fs.readFile;
let releaseRead: () => void = () => {};
let enteredRead: () => void = () => {};
try {
  for (let n = 0; !createdWindows.length && n < 250; n++)
    await new Promise((r) => setTimeout(r, 20));
  assert.ok(createdWindows.length);
  const project = await call('projects:create', '세션 재개 검증');
  const doc = await call('documents:create-idea', { x: 100, y: 100 });
  const before = await call('workspace:get');
  assert.ok(before.session?.sessionId);
  const filename = path.join(project.root, doc.relativePath);
  const waiting = new Promise<void>((r) => {
    releaseRead = r;
  });
  const entered = new Promise<void>((r) => {
    enteredRead = r;
  });
  let delayOnce = true;
  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    if (delayOnce && path.resolve(String(args[0])) === path.resolve(filename)) {
      delayOnce = false;
      enteredRead();
      await waiting;
    }
    return originalRead(...args);
  }) as typeof fs.readFile;
  const stale = call('documents:get', doc.relativePath);
  const rejected = assert.rejects(stale, /세션.*변경/);
  await entered;
  await call('projects:home');
  const entry = (await call('projects:list')).find(
    (item: { root?: string }) => item.root === project.root,
  );
  await call('projects:open', entry.id);
  const reopened = await call('workspace:get');
  assert.equal(reopened.saveScope, before.saveScope);
  assert.notEqual(reopened.session.sessionId, before.session.sessionId);
  releaseRead();
  await rejected;
  await assert.rejects(
    call('documents:save', {
      relativePath: doc.relativePath,
      title: '이전 세션의 저장',
      body: 'stale',
      queueScope: before.saveScope,
      queueSessionId: before.session.sessionId,
    }),
    /세션.*변경/,
  );
  const current = await call('documents:get', doc.relativePath);
  assert.equal(current.title, doc.title);
  assert.equal(current.body, doc.body);
  console.log(
    'PASS: production IPC rejects a late read and queued save after reopening the same project; durable scope and original document survive',
  );
} finally {
  releaseRead();
  fs.readFile = originalRead;
  for (const listener of app.listeners('before-quit')) listener();
  await new Promise((r) => setTimeout(r, 150));
  await fs.rm(root, { recursive: true, force: true });
}
