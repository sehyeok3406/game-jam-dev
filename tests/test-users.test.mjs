import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  TestUserLauncher,
  testProfilePath,
  testLaunchArgs,
  TEST_PROFILE_FLAG,
  TEST_BOOTSTRAP_KEY_ENV,
  encryptTestBootstrap,
  decryptTestBootstrap,
} from '../src/test-users.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';

test('test profiles cannot escape their root and launch arguments contain no credentials', () => {
  const id = randomUUID();
  assert.equal(testProfilePath('/base', []), null);
  assert.equal(
    testProfilePath('/base', [`${TEST_PROFILE_FLAG}${id}`]),
    path.join('/base', 'test-users', id),
  );
  for (const value of ['../../other', 'a'.repeat(36), '--wrong', ''])
    assert.throws(
      () => testProfilePath('/base', [`${TEST_PROFILE_FLAG}${value}`]),
      /프로필 ID/,
    );
  assert.throws(
    () =>
      testProfilePath('/base', [
        `${TEST_PROFILE_FLAG}${id}`,
        `${TEST_PROFILE_FLAG}${id}`,
      ]),
    /프로필 ID/,
  );
  assert.deepEqual(testLaunchArgs(true, '/app', id), [
    `${TEST_PROFILE_FLAG}${id}`,
  ]);
  assert.deepEqual(testLaunchArgs(false, '/app', id), [
    '/app',
    `${TEST_PROFILE_FLAG}${id}`,
  ]);
});

async function setup(t, spawnFailure = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-multi-users-'));
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: path.join(root, 'server'),
    creationKey: 'fixture',
  });
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const shared = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    'fixture',
    '관리자',
    '동시 테스트',
    {
      'project.md':
        '---\nid: project\ntitle: 동시 테스트\ntype: overview\nstatus: draft\nsources: []\n---\n\n# 테스트',
    },
  );
  const owner = new CollaborationClient(shared.credentials, () => {});
  owner.accept(shared.result);
  const children = [];
  const launches = [];
  const launcher = new TestUserLauncher({
    base: root,
    executable: 'fixture-electron',
    appPath: '/fixture',
    packaged: false,
    spawn: (executable, args, options) => {
      launches.push({ executable, args, options });
      const child = Object.assign(new EventEmitter(), {
        pid: children.length + 100,
        exitCode: null,
        killed: false,
        unref() {},
      });
      children.push(child);
      queueMicrotask(() =>
        spawnFailure
          ? child.emit('error', new Error('spawn failed'))
          : child.emit('spawn'),
      );
      return child;
    },
  });
  t.after(() => owner.stop());
  return { root, owner, launcher, children, launches };
}

async function clientFor(root, window, launches) {
  const profile = testProfilePath(root, [`${TEST_PROFILE_FLAG}${window.id}`]);
  const raw = await fs.readFile(path.join(profile, 'bootstrap.enc'));
  const key = launches.find((launch) =>
    launch.args.includes(`${TEST_PROFILE_FLAG}${window.id}`),
  ).options.env[TEST_BOOTSTRAP_KEY_ENV];
  const credentials = JSON.parse(decryptTestBootstrap(raw, key)).credentials;
  assert.equal(credentials.inviteCode, undefined);
  assert.equal(credentials.recoveryKey, undefined);
  const client = new CollaborationClient(credentials, () => {});
  await client.refresh();
  return client;
}

test('three independent editors synchronize simultaneous edits, locks and attributed history', async (t) => {
  const { root, owner, launcher, launches } = await setup(t);
  const originalSession = 'original-admin-session';
  await fs.writeFile(
    path.join(root, 'collaboration-session.enc'),
    originalSession,
  );
  await fs.writeFile(path.join(root, 'settings.json'), 'original-settings');
  const windows = await launcher.launch(owner, {
    count: 3,
    nicknamePrefix: '테스터',
    role: 'editor',
  });
  assert.equal(windows.length, 3);
  assert.equal(new Set(windows.map((w) => w.id)).size, 3);
  assert.equal(new Set(windows.map((w) => w.memberId)).size, 3);
  const clients = await Promise.all(
    windows.map((w) => clientFor(root, w, launches)),
  );
  assert.equal(new Set(clients.map((c) => c.credentials.token)).size, 3);
  const ideas = await Promise.all(
    clients.map((client, index) =>
      client.command('documents:create-idea', { x: index * 400, y: 100 }),
    ),
  );
  await Promise.all(
    clients.map(async (client, index) => {
      await client.refresh();
      await client.lock(ideas[index].relativePath);
      await client.command('documents:save', {
        relativePath: ideas[index].relativePath,
        title: `사용자 ${index + 1} 메모`,
        body: `독립 편집 ${index}`,
      });
      await client.unlock(ideas[index].relativePath);
    }),
  );
  await owner.refresh();
  for (let index = 0; index < 3; index++)
    assert.match(
      owner.files[ideas[index].relativePath],
      new RegExp(`독립 편집 ${index}`),
    );
  await clients[0].lock(ideas[0].relativePath);
  await assert.rejects(clients[1].lock(ideas[0].relativePath), /편집 중/);
  await clients[0].unlock(ideas[0].relativePath);
  const history = await owner.history();
  for (const window of windows)
    assert.ok(
      history.some(
        (entry) =>
          entry.actorId === window.memberId &&
          entry.actorName === window.nickname,
      ),
    );
  for (const launch of launches) {
    assert.equal(
      launch.options.windowsHide,
      false,
      'Interactive test apps must not inherit SW_HIDE',
    );
    assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(launch.args.length, 2);
    assert.ok(!launch.args.join(' ').includes(owner.credentials.token));
  }
  assert.equal(
    await fs.readFile(path.join(root, 'collaboration-session.enc'), 'utf8'),
    originalSession,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'settings.json'), 'utf8'),
    'original-settings',
  );
});

test('viewer test sessions cannot edit or run AI and admins can promote them', async (t) => {
  const { root, owner, launcher, launches } = await setup(t);
  const windows = await launcher.launch(owner, {
    count: 2,
    nicknamePrefix: '뷰어',
    role: 'viewer',
  });
  const clients = await Promise.all(
    windows.map((w) => clientFor(root, w, launches)),
  );
  for (const client of clients) {
    assert.equal(client.state.role, 'viewer');
    await assert.rejects(
      client.command('documents:create-idea', { x: 0, y: 0 }),
      /권한|뷰어/,
    );
    await assert.rejects(client.beginAi('task.md'), /뷰어|관리자·편집자/);
  }
  await owner.setRole(windows[0].memberId, 'editor');
  await clients[0].refresh();
  await clients[0].command('documents:create-idea', { x: 0, y: 0 });
  await assert.rejects(clients[0].beginAi('task.md'), /작업 명세|경로/);
});

test('test launch inputs, administrator permissions, active window limits and capacity are enforced', async (t) => {
  const { root, owner, launcher, children, launches } = await setup(t);
  for (const input of [
    null,
    { count: 0 },
    { count: 11 },
    { count: 1.5 },
    { count: 1, role: 'admin', nicknamePrefix: 'X' },
    { count: 1, role: 'editor', nicknamePrefix: '' },
  ])
    await assert.rejects(launcher.launch(owner, input), /인원/);
  const windows = await launcher.launch(owner, {
    count: 10,
    nicknamePrefix: '부하 테스트',
    role: 'editor',
  });
  await assert.rejects(
    launcher.launch(owner, {
      count: 1,
      nicknamePrefix: '추가',
      role: 'editor',
    }),
    /동시에 최대 10/,
  );
  const editor = await clientFor(root, windows[0], launches);
  await assert.rejects(
    new TestUserLauncher({ base: root }).launch(editor, {
      count: 1,
      nicknamePrefix: 'X',
      role: 'editor',
    }),
    /관리자/,
  );
  for (const child of children) {
    child.exitCode = 0;
    child.emit('exit', 0);
  }
  assert.ok(
    (await launcher.list(owner.credentials.projectId)).every(
      (w) => w.status === 'closed',
    ),
  );
  await assert.rejects(
    launcher.launch(owner, {
      count: 10,
      nicknamePrefix: '추가',
      role: 'editor',
    }),
    /최대 20/,
  );
});

test('one-use bootstrap transfer is encrypted and rejects modified ciphertext or keys', () => {
  const text = JSON.stringify({ credentials: { token: 'participant-secret' } });
  const bootstrap = encryptTestBootstrap(text);
  assert.equal(decryptTestBootstrap(bootstrap.ciphertext, bootstrap.key), text);
  assert.ok(!bootstrap.ciphertext.includes(Buffer.from('participant-secret')));
  assert.throws(() => decryptTestBootstrap(bootstrap.ciphertext, 'invalid'));
  assert.throws(() =>
    decryptTestBootstrap(bootstrap.ciphertext, '0'.repeat(64)),
  );
  const modified = Buffer.from(bootstrap.ciphertext);
  modified[modified.length - 1] ^= 1;
  assert.throws(() => decryptTestBootstrap(modified, bootstrap.key));
});

test('launch status requires visible window confirmation, not just a successful server connection', async (t) => {
  const { root, owner, launcher } = await setup(t);
  const windows = await launcher.launch(owner, {
    count: 3,
    role: 'editor',
    nicknamePrefix: '창 검증',
  });
  for (const [index, window] of windows.entries()) {
    const profile = testProfilePath(root, [`${TEST_PROFILE_FLAG}${window.id}`]);
    await fs.writeFile(
      path.join(profile, 'launch-status.json'),
      JSON.stringify(
        index === 2
          ? { status: 'failed', message: '[GC-TEST-002] renderer load failed' }
          : { status: 'ready', windowVisible: index === 1 },
      ),
    );
  }
  const result = await launcher.list(owner.credentials.projectId);
  assert.equal(result[0].status, 'failed');
  assert.match(result[0].message, /GC-TEST-002/);
  assert.equal(result[1].status, 'ready');
  assert.equal(result[2].status, 'failed');
  assert.match(result[2].message, /renderer load failed/);
});

test('spawn failure revokes unused members and preserves successful launch diagnostics', async (t) => {
  const { owner, launcher } = await setup(t, true);
  const windows = await launcher.launch(owner, {
    count: 2,
    nicknamePrefix: '실패',
    role: 'editor',
  });
  assert.ok(windows.every((w) => w.status === 'failed' && w.message));
  await owner.refresh();
  assert.equal(owner.state.members.length, 1);
});

test('updater sees active windows across project switches and releases after child exit', async (t) => {
  const { owner, launcher, children } = await setup(t);
  assert.equal(launcher.hasActiveWindows(), false);
  await launcher.launch(owner, {
    count: 1,
    nicknamePrefix: '업데이트 보호',
    role: 'editor',
  });
  assert.equal((await launcher.list('different-project')).length, 0);
  assert.equal(launcher.hasActiveWindows(), true);
  children[0].exitCode = 0;
  children[0].emit('exit', 0);
  assert.equal(launcher.hasActiveWindows(), false);
});
