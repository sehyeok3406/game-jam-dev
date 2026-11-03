import assert from 'node:assert/strict';
import path from 'node:path';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import '../src/main.ts';
import { handlers, createdWindows, root } from './mocks/electron.ts';

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel);
  assert.ok(handler, channel);
  return handler(
    {
      sender: createdWindows[0]?.webContents,
      senderFrame: createdWindows[0]?.webContents.mainFrame,
    },
    ...args,
  );
}
let server: Awaited<ReturnType<typeof createCollaborationServer>> | undefined;
try {
  for (let i = 0; i < 100 && !createdWindows.length; i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(createdWindows.length, 'main startup');
  await call('projects:create', '위치 링크 IPC 검증');
  const doc = await call('documents:create-idea', { x: 80, y: 100 });
  const session = (await call('workspace:get')).session;
  await assert.rejects(
    call('projects:location-create', { kind: 'document', id: doc.id }, session),
    /공동 프로젝트/,
  );
  server = await createCollaborationServer({
    dataDirectory: path.join(root, 'link-server'),
    port: 0,
    creationKey: 'link-test',
  });
  const shared = await call('collaboration:create', {
    serverUrl: `http://127.0.0.1:${server.port}`,
    serverKey: 'link-test',
    nickname: '링크 관리자',
  });
  const active = (await call('workspace:get')).session;
  const href = await call(
    'projects:location-create',
    { kind: 'document', id: doc.id },
    active,
  );
  assert.ok(href.startsWith('gamejam://open?v=1&project='));
  assert.ok(!href.includes('token') && !href.includes(root));
  const result = await call('projects:location-open', href, active);
  assert.equal(result.item.documentId, doc.id);
  assert.equal(result.workspace.session.sessionId, active.sessionId);
  await assert.rejects(
    call('projects:location-create', { kind: 'document', id: doc.id }, session),
    /프로젝트가 변경/,
  );
  await call('projects:home');
  const reopened = await call('projects:location-open', href, null);
  assert.equal(reopened.item.documentId, doc.id);
  assert.notEqual(reopened.workspace.session.sessionId, active.sessionId);
  const blockId = '11111111-1111-4111-8111-111111111111';
  await call('collaboration:lock', doc.relativePath);
  await call('documents:save', {
    relativePath: doc.relativePath,
    title: doc.title,
    body: `문단<!--gamejam:block:${blockId}-->`,
  });
  await call('collaboration:unlock', doc.relativePath);
  const current = (await call('workspace:get')).session;
  const blockHref = await call(
    'projects:location-create',
    { kind: 'document', id: doc.id, blockId },
    current,
  );
  const block = await call('projects:location-open', blockHref, current);
  assert.equal(block.item.target.blockId, blockId);
  assert.equal(block.item.blockMissing, false);
  const stranger = href.replace(
    /project=[^&]+/,
    'project=22222222-2222-4222-8222-222222222222',
  );
  await assert.rejects(
    call('projects:location-open', stranger, current),
    /참여 기록/,
  );
  const sender = handlers.get('location-links:pending')!;
  assert.throws(() => sender({ sender: {}, senderFrame: {} }), /기본 화면/);
  assert.equal(await call('location-links:pending'), null);
  const joined = await CollaborationClient.join(
    `http://127.0.0.1:${server.port}`,
    shared.inviteCode,
    '링크 읽기 사용자',
  );
  await assert.rejects(
    CollaborationClient.fetch(
      `http://127.0.0.1:${server.port}`,
      `/projects/${shared.projectId}/state`,
      {},
      joined.credentials.token,
    ),
    /업데이트/,
  );
  console.log(
    'PASS: production location IPC, stored membership, home reopen, session guards, paragraph persistence, old-client and foreign-frame rejection',
  );
} finally {
  if (createdWindows.length) await call('projects:home').catch(() => {});
  await server?.close();
}
