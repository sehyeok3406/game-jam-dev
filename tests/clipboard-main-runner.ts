import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../src/main';
import { createCollaborationServer } from '../src/collaboration-server';
import { CollaborationClient } from '../src/collaboration-client';
import { decodeAsset } from '../src/file-assets';
import {
  app,
  root,
  handlers,
  createdWindows,
  clipboard,
  ClipboardItem,
} from './mocks/electron';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
  'base64',
);
const call = (channel: string, ...args: unknown[]) =>
  handlers.get(channel)!(
    {
      sender: createdWindows[0].webContents,
      senderFrame: createdWindows[0].webContents.mainFrame,
    },
    ...args,
  ) as Promise<any>;
let scope: string, contextId: string;
let server: Awaited<ReturnType<typeof createCollaborationServer>> | undefined;
let peer: CollaborationClient | undefined;
const request = () => ({
  scope,
  contextId,
  requestId: randomUUID(),
  canvasId: 'default',
  x: 160,
  y: 140,
  imagePurpose: 'asset',
});
const nativeImage = () => {
  clipboard.items = [new ClipboardItem({ 'image/png': new Blob([png]) })];
};
try {
  await new Promise((r) => setTimeout(r, 80));
  const project = await call('projects:create', 'clipboard-test');
  ({ saveScope: scope, clipboardContextId: contextId } =
    await call('workspace:get'));
  const original = await call('edit:state');
  assert.deepEqual(await call('clipboard:canvas-paste', request()), {
    kind: 'empty',
  });
  assert.deepEqual(await call('edit:state'), original);
  nativeImage();
  const input = request();
  const [first, duplicate] = await Promise.all([
    call('clipboard:canvas-paste', input),
    call('clipboard:canvas-paste', input),
  ]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.documents.length, 1);
  const doc = first.documents[0];
  assert.equal(doc.title, '붙여넣은 이미지');
  assert.deepEqual(
    await fs.readFile(path.join(project.root, doc.asset.path)),
    png,
  );
  assert.equal((await call('edit:state')).undo, '이미지 붙여넣기');
  await call('edit:undo');
  await assert.rejects(fs.access(path.join(project.root, doc.asset.path)));
  await call('edit:redo');
  assert.deepEqual(
    await fs.readFile(path.join(project.root, doc.asset.path)),
    png,
  );
  const copyId = randomUUID();
  await call('clipboard:canvas-copy', { scope, contextId, copyId });
  assert.deepEqual(
    await call('clipboard:canvas-paste', {
      ...request(),
      internalCopyId: copyId,
    }),
    { kind: 'internal', copyId },
  );
  const duplicateInput = {
    scope,
    clipboardContextId: contextId,
    requestId: randomUUID(),
    documents: [{ id: doc.id, path: doc.relativePath }],
    offsetX: 32,
    offsetY: 32,
  };
  const [copy, repeat] = await Promise.all([
    call('documents:duplicate', duplicateInput),
    call('documents:duplicate', duplicateInput),
  ]);
  assert.deepEqual(copy, repeat);
  assert.equal(copy.length, 1);
  clipboard.items = [
    new ClipboardItem({ 'text/plain': new Blob(['external text']) }),
  ];
  assert.deepEqual(
    await call('clipboard:canvas-paste', {
      ...request(),
      internalCopyId: copyId,
    }),
    { kind: 'empty' },
  );
  nativeImage();
  assert.equal(
    (
      await call('clipboard:canvas-paste', {
        ...request(),
        internalCopyId: copyId,
      })
    ).kind,
    'images',
  );
  assert.throws(
    () =>
      handlers.get('clipboard:canvas-paste')!(
        { sender: {}, senderFrame: {} },
        request(),
      ),
    /캔버스/,
  );
  console.log(
    'PASS: production clipboard IPC saves once, records/undoes/redoes bytes, internal/external precedence and copy deduplication',
  );

  const read = clipboard.read;
  let resolveRead: (value: ClipboardItem[]) => void;
  clipboard.read = () =>
    new Promise((r) => {
      resolveRead = r;
    });
  const slow = call('clipboard:canvas-paste', request());
  void slow.catch(() => undefined);
  await new Promise((r) => setTimeout(r, 10));
  await call('projects:home');
  resolveRead!([new ClipboardItem({ 'image/png': new Blob([png]) })]);
  await assert.rejects(slow, /프로젝트가 변경/);
  clipboard.read = read;
  const entries = await call('projects:list');
  await call(
    'projects:open',
    entries.find((e: any) => e.root === project.root).id,
  );
  const reopened = await call('workspace:get');
  assert.notEqual(reopened.clipboardContextId, contextId);
  await assert.rejects(
    async () => call('clipboard:canvas-paste', request()),
    /프로젝트가 변경/,
  );
  ({ saveScope: scope, clipboardContextId: contextId } = reopened);
  console.log(
    'PASS: slow read cancelled on project switching and same-root reopening invalidates the old context',
  );

  await call('projects:home');
  const failedProject = await call('projects:create', 'clipboard-failure');
  ({ saveScope: scope, clipboardContextId: contextId } =
    await call('workspace:get'));
  nativeImage();
  const history = path.join(failedProject.root, '.history');
  await fs.writeFile(history, 'block history creation');
  await assert.rejects(call('clipboard:canvas-paste', request()));
  assert.equal(
    (await call('documents:list')).filter((d: any) => d.type === 'image')
      .length,
    0,
  );
  assert.equal(
    (await fs.readdir(path.join(failedProject.root, 'assets/images'))).length,
    0,
  );
  assert.equal((await call('edit:state')).undo, null);
  console.log(
    'PASS: history failure rolls back image and descriptor instead of claiming success',
  );
  await call('projects:home');
  await call('projects:create', 'clipboard-shared');
  server = await createCollaborationServer({
    port: 0,
    creationKey: 'test',
    dataDirectory: path.join(root, 'clipboard-server'),
  });
  const serverUrl = `http://127.0.0.1:${server.port}`;
  const shared = await call('collaboration:create', {
    serverUrl,
    serverKey: 'test',
    nickname: 'clipboard-owner',
  });
  ({ saveScope: scope, clipboardContextId: contextId } =
    await call('workspace:get'));
  const joined = await CollaborationClient.join(
    serverUrl,
    shared.inviteCode,
    'clipboard-peer',
  );
  peer = new CollaborationClient(joined.credentials, () => {});
  peer.accept(joined.result);
  nativeImage();
  const sharedImage = (await call('clipboard:canvas-paste', request()))
    .documents[0];
  await peer.refresh();
  assert.deepEqual(
    decodeAsset(sharedImage.asset.path, peer.files[sharedImage.asset.path]),
    png,
  );
  await call('edit:undo');
  await peer.refresh();
  assert.equal(peer.files[sharedImage.asset.path], undefined);
  await call('edit:redo');
  await peer.refresh();
  assert.deepEqual(
    decodeAsset(sharedImage.asset.path, peer.files[sharedImage.asset.path]),
    png,
  );
  await call('collaboration:role', peer.state.memberId, 'admin');
  await peer.refresh();
  await call('projects:home');
  await call('collaboration:join', {
    serverUrl,
    code: shared.inviteCode,
    nickname: 'clipboard-editor',
  });
  ({ saveScope: scope, clipboardContextId: contextId } =
    await call('workspace:get'));
  assert.equal((await call('collaboration:get')).role, 'editor');
  assert.equal(
    (await call('clipboard:canvas-paste', request())).kind,
    'images',
  );
  const editor = await call('collaboration:get');
  await peer.setRole(editor.memberId, 'viewer');
  for (
    let i = 0;
    i < 80 && (await call('collaboration:get')).role !== 'viewer';
    i++
  )
    await new Promise((r) => setTimeout(r, 25));
  assert.equal((await call('collaboration:get')).role, 'viewer');
  await assert.rejects(
    call('clipboard:canvas-paste', request()),
    /편집자|뷰어/,
  );
  const closingServer = server;
  server = undefined;
  await closingServer.close();
  for (let i = 0; i < 400 && (await call('collaboration:get')).connected; i++)
    await new Promise((r) => setTimeout(r, 50));
  assert.equal((await call('collaboration:get')).connected, false);
  await assert.rejects(call('clipboard:canvas-paste', request()), /연결/);
  console.log(
    'PASS: production clipboard collaboration synchronizes both files, undo/redo, editor access, viewer downgrade and disconnected rejection',
  );
} finally {
  peer?.stop();
  for (const listener of app.listeners('before-quit')) listener();
  await server?.close();
  await new Promise((r) => setTimeout(r, 450));
  await fs.rm(root, { recursive: true, force: true });
}
