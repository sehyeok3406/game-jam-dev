import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import '../src/main';
import { createCollaborationServer } from '../src/collaboration-server';
import { CollaborationClient } from '../src/collaboration-client';
import {
  app,
  handlers,
  createdWindows,
  ipcMain,
  root,
  events,
} from './mocks/electron';
import { discordMock } from './mocks/discord-transport';

const pause = () => new Promise((r) => setTimeout(r, 25));
const wait = async (check: () => Promise<boolean> | boolean) => {
  for (let i = 0; i < 600; i++) {
    if (await check()) return;
    await pause();
  }
  throw Error('Discord main flow timed out');
};
const call = (channel: string, ...args: unknown[]) =>
  handlers.get(channel)!(
    {
      sender: createdWindows[0].webContents,
      senderFrame: createdWindows[0].webContents.mainFrame,
    },
    ...args,
  ) as Promise<any>;
let server: Awaited<ReturnType<typeof createCollaborationServer>>;
let editor: CollaborationClient;
const channelId = '1560275803198193725',
  userId = '448449132479381507';
try {
  await wait(() => createdWindows.length === 1);
  server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'discord-main-test',
  });
  const serverUrl = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    serverUrl,
    'discord-main-test',
    '원격 관리자',
    '원격 검증',
    {
      'project.md': matter.stringify('프로젝트', {
        id: 'p',
        title: '프로젝트',
        type: 'overview',
        status: 'draft',
        sources: [],
      }),
      'ideas/a.md': matter.stringify('아이디어', {
        id: 'a',
        title: '아이디어',
        type: 'idea',
        status: 'draft',
        sources: [],
      }),
    },
  );
  const joined = await CollaborationClient.join(
    serverUrl,
    created.result.code,
    '팀원',
  );
  editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  const admin = await call('collaboration:recover', {
    serverUrl,
    projectId: created.credentials.projectId,
    recoveryKey: created.result.recoveryKey,
  });
  assert.equal(admin.role, 'admin');
  const request = {
    organize: false,
    implement: true,
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    resultName: '',
    htmlResult: { mode: 'new' },
    instructions: {
      organize: '',
      implement: '작은 게임을 만들어주세요. INSTRUCTION-IPC-PROBE',
    },
  };
  const item = await editor.mutateApproval('create', {
    commandId: crypto.randomUUID(),
    request,
  });
  await call('discord-approval:configure', {
    channelId,
    userId,
    token: 'mock-token',
    providerId: 'codex-cli',
    modelId: 'fixture-valid',
    threads: true,
  });
  assert.equal(
    JSON.stringify(await call('discord-approval:status')).includes(
      'mock-token',
    ),
    false,
  );
  const testResult = await call('discord-approval:test');
  assert.match(testResult.message, /테스트 알림을 보냈/);
  const testCard = discordMock.messages.find((m) =>
    m.body.content?.includes('테스트 알림'),
  )!;
  const testReplies = await discordMock.click(
    'gj:test',
    userId,
    channelId,
    testCard.id,
  );
  assert.match(testReplies[0].content!, /테스트 버튼을 정상/);
  assert.equal((await call('requests:read', item.id)).item.status, 'pending');
  await wait(() =>
    discordMock.messages.some(
      (m) =>
        m.channelId === channelId &&
        (m.body.components as any[])?.[0]?.components.some((b: any) =>
          b.custom_id.includes(item.id),
        ),
    ),
  );
  const card = discordMock.messages.find(
    (m) =>
      m.channelId === channelId &&
      (m.body.components as any[])?.[0]?.components.some((b: any) =>
        b.custom_id.includes(item.id),
      ),
  )!;
  const components = card.body.components as any[];
  const denied = await discordMock.click(
    components[0].components[0].custom_id,
    '123456789012345678',
    channelId,
    card.id,
  );
  assert.match(denied[0].content!, /관리자만/);
  const reviewed = await discordMock.click(
    components[0].components[0].custom_id,
    userId,
    channelId,
    card.id,
  );
  const approve = (reviewed.at(-1)!.components as any[])[0].components.find(
    (b: any) => b.label.includes('승인'),
  ).custom_id;
  let flushes = 0;
  const window = createdWindows[0],
    originalSend = window.webContents.send;
  window.webContents.send = ((channel: string, value: any) => {
    originalSend(channel, value);
    if (channel === 'discord-approval:prepare') {
      flushes++;
      // A foreign frame's acknowledgement must be ignored.
      ipcMain.emit(
        'discord-approval:prepared',
        { sender: {}, senderFrame: {} },
        value,
        true,
      );
      queueMicrotask(() =>
        ipcMain.emit(
          'discord-approval:prepared',
          {
            sender: window.webContents,
            senderFrame: window.webContents.mainFrame,
          },
          value,
          true,
        ),
      );
    }
  }) as typeof window.webContents.send;
  const responses = await Promise.all([
    discordMock.click(approve, userId, channelId),
    discordMock.click(approve, userId, channelId),
  ]);
  assert.equal(flushes, 1);
  assert.ok(responses.flat().some((r) => r.content?.includes('구현을 시작')));
  const running = (await call('requests:read', item.id)).item;
  await wait(() =>
    events.some(
      (event) =>
        event.runId === running.runId &&
        ['completed', 'failed', 'cancelled'].includes(event.status),
    ),
  );
  const terminal = events.findLast(
    (event) =>
      event.runId === running.runId &&
      ['completed', 'failed', 'cancelled'].includes(event.status),
  );
  assert.equal(terminal?.status, 'completed', terminal?.message);
  const completed = (await call('requests:read', item.id)).item;
  assert.equal(completed.approvedBy, admin.memberId);
  assert.equal(completed.providerId, 'codex-cli');
  assert.equal(completed.modelId, 'fixture-valid');
  assert.equal(
    completed.executionRequest.instructions.implement,
    request.instructions.implement,
  );
  assert.ok(
    (await call('preview:read', completed.outputs[0])).content.includes(
      '<html',
    ),
  );
  await wait(() =>
    discordMock.messages.some(
      (m) => m.channelId === channelId && m.body.content?.includes('완료'),
    ),
  );
  const pending = await editor.mutateApproval('create', {
    commandId: crypto.randomUUID(),
    request,
  });
  await wait(() =>
    discordMock.messages.some((m) =>
      (m.body.components as any[])?.[0]?.components.some((b: any) =>
        b.custom_id.includes(pending.id),
      ),
    ),
  );
  const pendingCard = discordMock.messages.find((m) =>
    (m.body.components as any[])?.[0]?.components.some((b: any) =>
      b.custom_id.includes(pending.id),
    ),
  )!;
  const secondReview = await discordMock.click(
    (pendingCard.body.components as any[])[0].components[0].custom_id,
    userId,
    channelId,
    pendingCard.id,
  );
  const secondApprove = (
    secondReview.at(-1)!.components as any[]
  )[0].components.find((b: any) => b.label.includes('승인')).custom_id;
  let acknowledge: () => void;
  window.webContents.send = ((channel: string, value: any) => {
    originalSend(channel, value);
    if (channel === 'discord-approval:prepare')
      acknowledge = () =>
        ipcMain.emit(
          'discord-approval:prepared',
          {
            sender: window.webContents,
            senderFrame: window.webContents.mainFrame,
          },
          value,
          true,
        );
  }) as typeof window.webContents.send;
  const inflight = discordMock.click(secondApprove, userId, channelId);
  await wait(() => !!acknowledge);
  await call('discord-approval:disconnect');
  acknowledge!();
  const cancelled = await inflight;
  assert.match(cancelled.at(-1)!.content!, /해제|동기화/);
  assert.equal(
    (await call('requests:read', pending.id)).item.status,
    'pending',
  );
  await assert.rejects(fs.access(path.join(root, 'discord-approval.enc')));
  console.log(
    'PASS: Discord button → guarded main IPC → editor flush → atomic server approval → mock CLI → published HTML → completion notification; duplicate clicks and disconnect during preparation cannot start another run.',
  );
} finally {
  editor?.stop();
  for (const listener of app.listeners('before-quit')) listener();
  await server?.close();
  await new Promise((r) => setTimeout(r, 450));
  await fs.rm(root, { recursive: true, force: true });
}
