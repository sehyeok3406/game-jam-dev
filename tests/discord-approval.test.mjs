import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import matter from 'gray-matter';
import { DiscordApprovalService } from '../src/discord-approval.ts';
import { DiscordApprovalStore } from '../src/discord-approval-store.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const channelId = '1560275803198193725',
  userId = '448449132479381507';
const settings = {
  channelId,
  userId,
  token: 'test-bot-secret',
  providerId: 'codex-cli',
  modelId: '',
  threads: true,
};
const request = (patch = {}) => ({
  organize: false,
  implement: true,
  inputPaths: ['ideas/a.md'],
  x: 0,
  y: 0,
  resultName: '원격 승인 게임',
  instructions: { organize: '', implement: '키보드 게임을 만들어주세요' },
  htmlResult: { mode: 'new' },
  ...patch,
});
const delay = () => new Promise((r) => setTimeout(r, 15));
async function until(check, service) {
  for (let i = 0; i < 150; i++) {
    await service?.poll();
    if (check()) return;
    await delay();
  }
  throw Error('Timed out waiting for remote approval');
}
function action(customId, patch = {}) {
  const calls = [];
  return {
    id: randomUUID(),
    customId,
    userId,
    channelId,
    kind: 'button',
    calls,
    async defer() {
      calls.push(['defer']);
    },
    async reply(value) {
      calls.push(['reply', value]);
    },
    async edit(value) {
      calls.push(['edit', value]);
    },
    async modal(value) {
      calls.push(['modal', value]);
    },
    ...patch,
  };
}
const buttons = (a) =>
  a.calls
    .findLast(([name]) => name === 'edit')?.[1]
    .components?.flatMap((r) => r.components) ?? [];
const messageText = (a) =>
  a.calls
    .filter(([name]) => name === 'edit' || name === 'reply')
    .map(([, b]) => b.content)
    .join('\n');

async function setup(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-discord-'),
  );
  const server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
    creationKey: 'discord-test',
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    'discord-test',
    '관리자',
    '테스트 프로젝트',
    {
      'project.md': matter.stringify('프로젝트', {
        id: 'project',
        title: '프로젝트',
        type: 'overview',
      }),
      'ideas/a.md': matter.stringify('아이디어', {
        id: 'idea-a',
        title: '아이디어',
        type: 'idea',
      }),
    },
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    created.credentials.serverUrl,
    created.result.code,
    '팀원',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  let saved = null,
    online = true,
    starts = 0;
  const store = {
    async load() {
      return structuredClone(saved);
    },
    async save(value) {
      saved = structuredClone(value);
    },
    async clear() {
      saved = null;
    },
  };
  const sent = [],
    updated = [],
    threads = [];
  const transport = {
    active: false,
    failThread: false,
    async connect() {
      this.active = true;
    },
    close() {
      this.active = false;
    },
    ready() {
      return this.active;
    },
    async send(channel, body) {
      const id = `message-${sent.length}`;
      sent.push({ channel, body, id });
      return id;
    },
    async update(channel, id, body) {
      updated.push({ channel, id, body });
    },
    async thread(channel, messageId, name) {
      if (this.failThread) throw Error('Missing permissions');
      const id = `thread-${threads.length}`;
      threads.push({ channel, messageId, name, id });
      return id;
    },
  };
  const context = () =>
    online
      ? {
          serverUrl: owner.credentials.serverUrl,
          projectId: owner.credentials.projectId,
          memberId: owner.state.memberId,
          projectName: '테스트 프로젝트',
          list: () => owner.listApprovals(),
          read: (id) => owner.readApproval(id),
          async start(approval, input, authorized) {
            authorized();
            await owner.beginAi(
              '',
              input.modelId || null,
              input.providerId,
              approval,
            );
            starts++;
          },
          feedback: (id, revision, message, commandId) =>
            owner.mutateApproval('feedback', {
              id,
              revision,
              message,
              commandId,
            }),
        }
      : null;
  const service = new DiscordApprovalService(store, context, () => transport);
  t.after(async () => {
    service.stop();
    owner.stop();
    editor.stop();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await service.configure(settings);
  const submit = async (patch) =>
    editor.mutateApproval('create', {
      commandId: randomUUID(),
      request: request(patch),
    });
  const card = (id) =>
    sent.find(
      (m) =>
        m.channel === channelId &&
        m.body.components?.[0]?.components.some((b) =>
          b.custom_id.includes(id),
        ),
    );
  const review = async (item) => {
    await until(() => !!card(item.id), service);
    const m = card(item.id);
    const a = action(m.body.components[0].components[0].custom_id, {
      messageId: m.id,
    });
    await service.handle(a);
    return a;
  };
  return {
    service,
    owner,
    editor,
    store,
    context,
    transport,
    sent,
    updated,
    threads,
    submit,
    card,
    review,
    saved: () => saved,
    starts: () => starts,
    offline: () => {
      online = false;
    },
  };
}

test('Discord deletion replaces approval buttons, records a safe reason and rejects an already-open review', async (t) => {
  const f = await setup(t),
    item = await f.submit();
  const review = await f.review(item);
  const approve = buttons(review).find((b) =>
    b.custom_id.startsWith('gj:approve:'),
  );
  const reason = '@everyone ' + '삭제 이유 '.repeat(150);
  await f.owner.mutateApproval('delete', {
    commandId: randomUUID(),
    id: item.id,
    revision: 1,
    message: reason,
  });
  await until(
    () => f.updated.some((m) => m.body.content.includes('삭제 이유')),
    f.service,
  );
  const update = f.updated.at(-1).body;
  assert.match(update.content, /삭제됨/);
  assert.ok(update.content.length <= 2000);
  assert.deepEqual(update.allowed_mentions, { parse: [] });
  assert.deepEqual(update.components, []);
  const stale = action(approve.custom_id);
  await f.service.handle(stale);
  assert.equal(f.starts(), 0);
  assert.match(messageText(stale), /변경/);
  const late = await f.submit();
  await f.owner.mutateApproval('delete', {
    commandId: randomUUID(),
    id: late.id,
    revision: 1,
    message: '첫 알림 전에 삭제',
  });
  await until(
    () => f.sent.some((m) => m.body.content.includes('첫 알림 전에 삭제')),
    f.service,
  );
});

test('Discord review uses real server approval, rejects unauthorized clicks, and starts only once', async (t) => {
  const f = await setup(t),
    item = await f.submit();
  await until(() => !!f.card(item.id), f.service);
  const card = f.card(item.id),
    customId = card.body.components[0].components[0].custom_id;
  for (const patch of [
    { userId: '123456789012345678' },
    { channelId: '123456789012345678' },
  ]) {
    const denied = action(customId, { messageId: card.id, ...patch });
    await f.service.handle(denied);
    assert.match(messageText(denied), /관리자만/);
  }
  const reviewed = await f.review(item);
  assert.match(messageText(reviewed), /키보드 게임/);
  const approveId = buttons(reviewed).find((b) =>
    b.label.includes('승인'),
  ).custom_id;
  const first = action(approveId),
    duplicate = action(approveId);
  await Promise.all([f.service.handle(first), f.service.handle(duplicate)]);
  assert.equal(f.starts(), 1);
  assert.match(messageText(duplicate), /이미 처리/);
  const detail = await f.owner.readApproval(item.id);
  assert.equal(detail.item.status, 'running');
  assert.equal(detail.item.approvedBy, f.owner.state.memberId);
  assert.equal(
    detail.item.executionRequest.instructions.implement,
    item.request.instructions.implement,
  );
  assert.equal(
    JSON.stringify(f.service.status()).includes(settings.token),
    false,
  );
  assert.equal(
    f.sent.every((m) => m.body.allowed_mentions.parse.length === 0),
    true,
  );
});

test('Discord rejects a reviewed request when source documents change before approval', async (t) => {
  const f = await setup(t),
    item = await f.submit();
  const reviewed = await f.review(item);
  await f.editor.lock('ideas/a.md');
  await f.editor.command('documents:save', {
    relativePath: 'ideas/a.md',
    title: '아이디어',
    body: '승인 직전에 바뀐 자료',
  });
  const click = action(
    buttons(reviewed).find((b) => b.label.includes('승인')).custom_id,
  );
  await f.service.handle(click);
  assert.equal(f.starts(), 0);
  assert.equal((await f.owner.readApproval(item.id)).item.status, 'pending');
  assert.match(messageText(click), /변경|다시|최신/);
});

test('Discord stale request cards and stale feedback cannot mutate a newer revision', async (t) => {
  const f = await setup(t),
    item = await f.submit();
  await until(() => !!f.card(item.id), f.service);
  const card = f.card(item.id);
  const feedback = action(card.body.components[0].components[1].custom_id, {
    messageId: card.id,
  });
  await f.service.handle(feedback);
  const modalId = feedback.calls.find(([name]) => name === 'modal')[1];
  await f.editor.mutateApproval('update', {
    commandId: randomUUID(),
    id: item.id,
    revision: item.revision,
    request: request({ resultName: '수정된 요청' }),
  });
  const stale = await f.review(item);
  assert.match(messageText(stale), /수정|최신/);
  const modal = action(modalId, { kind: 'modal', feedback: '지난 버전 보완' });
  await f.service.handle(modal);
  assert.equal((await f.owner.readApproval(item.id)).item.status, 'pending');
});

test('Discord feedback modal records comments in the existing request inbox', async (t) => {
  const f = await setup(t),
    item = await f.submit();
  await until(() => !!f.card(item.id), f.service);
  const card = f.card(item.id),
    a = action(card.body.components[0].components[1].custom_id, {
      messageId: card.id,
    });
  await f.service.handle(a);
  const modal = action(a.calls.find(([name]) => name === 'modal')[1], {
    kind: 'modal',
    feedback: '조작 방법을 추가해주세요',
  });
  await f.service.handle(modal);
  const result = await f.owner.readApproval(item.id);
  assert.equal(result.item.status, 'feedback');
  assert.equal(result.item.feedback, '조작 방법을 추가해주세요');
  assert.equal(f.starts(), 0);
});

test('Discord requires all long request pages and rejects approval while offline', async (t) => {
  const f = await setup(t),
    item = await f.submit({
      instructions: {
        organize: '',
        implement: '긴 지침 '.repeat(1000) + '마지막 요구사항',
      },
    });
  let a = await f.review(item);
  assert.equal(
    buttons(a).some((b) => b.label.includes('승인')),
    false,
  );
  const contents = [messageText(a)];
  while (buttons(a).some((b) => b.label === '다음')) {
    a = action(buttons(a).find((b) => b.label === '다음').custom_id);
    await f.service.handle(a);
    contents.push(messageText(a));
  }
  assert.match(contents.join(''), /마지막 요구사항/);
  const click = action(
    buttons(a).find((b) => b.label.includes('승인')).custom_id,
  );
  f.offline();
  await f.service.handle(click);
  assert.equal(f.starts(), 0);
  assert.match(messageText(click), /프로젝트|동기화/);
});

test('Discord persists notification receipts, restores without duplicate cards, and sends terminal status', async (t) => {
  const f = await setup(t),
    item = await f.submit();
  const reviewed = await f.review(item);
  await until(() => f.saved()?.notifications[item.id]?.threadId, f.service);
  const cardCount = f.sent.filter((m) => m.channel === channelId).length;
  f.service.stop();
  const restored = new DiscordApprovalService(
    f.store,
    f.context,
    () => f.transport,
  );
  t.after(() => restored.stop());
  await restored.resume();
  await until(() => f.transport.ready(), restored);
  assert.equal(f.sent.filter((m) => m.channel === channelId).length, cardCount);
  const old = action(
    buttons(reviewed).find((b) => b.label.includes('승인')).custom_id,
  );
  await restored.handle(old);
  assert.match(messageText(old), /검토 시간|다시 확인/);
  await f.owner
    .mutateApproval('cancel', {
      id: item.id,
      revision: item.revision,
      commandId: randomUUID(),
    })
    .catch(() => undefined);
  // Only the author can cancel; use the member to exercise the real terminal transition.
  await f.editor.mutateApproval('cancel', {
    id: item.id,
    revision: item.revision,
    commandId: randomUUID(),
  });
  await until(
    () => f.updated.some((m) => m.body.content.includes('취소')),
    restored,
  );
  assert.equal(
    f.updated.findLast((m) => m.body.content.includes('취소')).body.components
      .length,
    0,
  );
});

test('thread permission failures do not block other request notifications', async (t) => {
  const f = await setup(t);
  f.transport.failThread = true;
  const first = await f.submit(),
    second = await f.submit({ resultName: '두 번째 요청' });
  await until(() => f.card(first.id) && f.card(second.id), f.service);
  assert.equal(f.threads.length, 0);
});

test('disconnect and changing the allowed Discord account revoke old approval buttons', async (t) => {
  const f = await setup(t),
    item = await f.submit();
  const reviewed = await f.review(item);
  const customId = buttons(reviewed).find((b) =>
    b.label.includes('승인'),
  ).custom_id;
  await f.service.configure({ ...settings, userId: '123456789012345678' });
  const revoked = action(customId);
  await f.service.handle(revoked);
  assert.equal(f.starts(), 0);
  assert.match(messageText(revoked), /관리자만/);
  await f.service.disconnect();
  assert.equal(f.saved(), null);
  assert.equal(f.service.status().connected, false);
  assert.equal(f.service.status().configured, false);
});

test('a token that cannot be persisted never enables remote approvals', async (t) => {
  const f = await setup(t);
  f.service.stop();
  const service = new DiscordApprovalService(
    {
      ...f.store,
      async save() {
        throw Error('disk full');
      },
    },
    f.context,
    () => f.transport,
  );
  t.after(() => service.stop());
  await assert.rejects(service.configure(settings), /연결하지 못했습니다/);
  assert.equal(service.status().configured, false);
  assert.equal(service.status().connected, false);
  assert.equal(f.starts(), 0);
});

test('test notifications and their button verify delivery without creating requests, runs or receipts', async (t) => {
  const f = await setup(t);
  const reply = await f.service.sendTest();
  assert.match(reply.message, /테스트 알림을 보냈/);
  const message = f.sent.find(
    (m) => m.channel === channelId && m.body.content.includes('테스트 알림'),
  );
  assert.ok(message);
  assert.equal(message.body.allowed_mentions.parse.length, 0);
  assert.equal(message.body.components[0].components[0].custom_id, 'gj:test');
  assert.equal(f.threads.length, 1);
  const click = action('gj:test', { messageId: message.id });
  await f.service.handle(click);
  assert.match(messageText(click), /테스트 버튼을 정상/);
  assert.equal((await f.owner.listApprovals()).items.length, 0);
  assert.equal(f.starts(), 0);
  assert.deepEqual(f.saved().notifications, {});
  await assert.rejects(f.service.sendTest(), /잠시 후/);
  const denied = action('gj:test', { userId: '123456789012345678' });
  await f.service.handle(denied);
  assert.match(messageText(denied), /관리자만/);
});

test('test notifications distinguish failed channel delivery, failed threads, and inactive binding', async (t) => {
  const f = await setup(t);
  f.transport.failThread = true;
  const partial = await f.service.sendTest();
  assert.match(partial.message, /채널에 테스트 알림.*스레드 전송은 실패/);
  f.offline();
  await assert.rejects(f.service.sendTest(), /프로젝트|권한/);
  await f.service.disconnect();
  await assert.rejects(f.service.sendTest(), /먼저/);
  assert.equal(f.starts(), 0);
  const g = await setup(t);
  g.transport.send = async () => {
    throw Error(settings.token);
  };
  await assert.rejects(
    g.service.sendTest(),
    (error) =>
      /테스트 알림을 보내지 못/.test(error.message) &&
      !error.message.includes(settings.token),
  );
});

test('encrypted Discord store never falls back to plaintext and survives ordered writes', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-discord-store-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(raw) {
      const iv = randomBytes(16),
        cipher = createCipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([iv, cipher.update(raw), cipher.final()]);
    },
    decryptString(bytes) {
      const cipher = createDecipheriv(
        'aes-256-cbc',
        key,
        bytes.subarray(0, 16),
      );
      return Buffer.concat([
        cipher.update(bytes.subarray(16)),
        cipher.final(),
      ]).toString();
    },
  };
  const store = new DiscordApprovalStore(directory, encryption);
  assert.equal(await store.load(), null);
  const data = {
    version: 1,
    token: settings.token,
    settings,
    binding: {
      serverUrl: 'http://localhost',
      projectId: 'p',
      memberId: 'm',
      projectName: '프로젝트',
    },
    notifications: {},
  };
  await Promise.all([
    store.save(data),
    store.save({ ...data, token: 'rotated-secret' }),
  ]);
  const bytes = await fs.readFile(path.join(directory, 'discord-approval.enc'));
  assert.equal(bytes.includes(Buffer.from('rotated-secret')), false);
  assert.equal((await store.load()).token, 'rotated-secret');
  encryption.isEncryptionAvailable = () => false;
  await assert.rejects(store.save(data), /암호화/);
  await store.clear();
  assert.deepEqual(await fs.readdir(directory), []);
});
