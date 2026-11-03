import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { buildFixture } from './helpers/game-build.mjs';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { LocalBackupTarget } from '../src/adapters/backup/local-target.ts';
import { restoreBackup } from '../src/server/operations/restore.ts';
import { projectCopyBundle } from '../src/project-copy.ts';
import { readGameBuildIndex } from '../src/core/projects/game-build.ts';
import { createRequestAdmission, body } from '../src/server/http/request.ts';
import { createHttpHandler } from '../src/server/http/router.ts';
import { reply } from '../src/server/http/response.ts';
import { serverEnvironment } from '../src/server/config.ts';

async function temporary(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-build-server-'),
  );
  const servers = new Set(),
    clients = new Set();
  t.after(async () => {
    for (const client of clients) client.stop();
    for (const server of servers) await server.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, servers, clients };
}
test('real shared source data survives commands, copy, history, SQLite restart and verified backup restoration', async (t) => {
  const { root, servers, clients } = await temporary(t),
    spool = path.join(root, 'spool');
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'data'),
    port: 0,
    backup: {
      target: new LocalBackupTarget(path.join(root, 'backups')),
      spoolDirectory: spool,
    },
  });
  servers.add(server);
  const url = `http://127.0.0.1:${server.port}`,
    f = buildFixture();
  const health = await fetch(url + '/health').then((r) => r.json());
  assert.equal(health.gameBuildStorageVersion, 1);
  assert.equal(health.gameBuildVersion, 1);
  assert.equal(health.gameBuildEditingVersion, 1);
  const created = await CollaborationClient.create(
    url,
    '',
    '관리자',
    '원본 저장 검사',
    f.files,
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  clients.add(owner);
  assert.equal(owner.state.fileGameBuildStorageVersion, 1);
  const old = await fetch(
    `${url}/projects/${created.credentials.projectId}/state`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.credentials.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectLayoutVersion: 2 }),
    },
  );
  assert.equal(old.status, 409);
  assert.equal((await old.json()).code, 'GAME_BUILD_STORAGE_UNSUPPORTED');
  const oldJoin = await fetch(url + '/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: created.credentials.inviteCode,
      nickname: '구버전',
    }),
  });
  assert.equal(oldJoin.status, 409);
  const joined = await CollaborationClient.join(
    url,
    created.credentials.inviteCode,
    '편집자',
  );
  assert.deepEqual(joined.result.files, owner.files);
  const to = 'output/inbox/relocated/v001/index.html';
  await owner.command('results:move', {
    relativePath: f.artifact.path,
    category: 'inbox',
    feature: 'relocated',
  });
  assert.equal(readGameBuildIndex(owner.files).artifacts[0].path, to);
  const bundle = projectCopyBundle(owner.files, {
    canvasId: 'default',
    documents: [],
    sections: [],
    previews: [to],
    drawings: [],
  });
  const target = await CollaborationClient.create(
    url,
    '',
    '다른 관리자',
    '복사 대상',
    { 'project.md': '# 대상' },
  );
  const client = new CollaborationClient(target.credentials, () => {});
  client.accept(target.result);
  clients.add(client);
  await client.command('projects:import-copy', {
    requestId: randomUUID(),
    canvasId: 'default',
    bundle,
  });
  assert.notEqual(
    readGameBuildIndex(client.files).artifacts[0].artifactId,
    f.artifact.artifactId,
  );
  const copyHistory = client.lastCommandHistoryId;
  await client.changeHistory(copyHistory, 'undo');
  const beforeOldRedo = structuredClone(client.files);
  await assert.rejects(
    client.request('history-change', {
      id: copyHistory,
      direction: 'redo',
      operationId: randomUUID(),
      gameBuildStorageVersion: 0,
    }),
    (error) => error.code === 'GAME_BUILD_STORAGE_UNSUPPORTED',
  );
  await client.refresh();
  assert.deepEqual(client.files, beforeOldRedo);
  await client.changeHistory(copyHistory, 'redo');
  await owner.command('documents:delete', { relativePath: to });
  assert.equal(readGameBuildIndex(owner.files).artifacts.length, 0);
  const history = await owner.request('history', {});
  const deletion = history.find((h) =>
    h.files.some((file) => file.relativePath === `${f.prefix}/manifest.json`),
  );
  assert.ok(deletion);
  await assert.rejects(
    owner.restore(deletion.id, `${f.prefix}/source/main.js`, 'before'),
    /전체 기록/,
  );
  await owner.restore(deletion.id, undefined, 'before');
  await owner.refresh();
  assert.equal(owner.files[`${f.prefix}/source/main.js`], f.source);
  assert.equal(readGameBuildIndex(owner.files).artifacts[0].path, to);
  const backup = await server.backup.run();
  const restoredDirectory = path.join(root, 'restored');
  await restoreBackup(path.join(spool, backup.key), restoredDirectory);
  await server.close();
  servers.delete(server);
  for (const dataDirectory of [path.join(root, 'data'), restoredDirectory]) {
    const reopened = await createCollaborationServer({
      dataDirectory,
      port: 0,
    });
    try {
      const again = new CollaborationClient(
        {
          ...created.credentials,
          serverUrl: `http://127.0.0.1:${reopened.port}`,
        },
        () => {},
      );
      await again.refresh();
      assert.equal(again.state.connected, true);
      assert.deepEqual(again.files, owner.files);
      again.stop();
    } finally {
      await reopened.close();
    }
  }
});

test('self-host byte quota is independent of source transport and rejects growth without losing existing data', async (t) => {
  const { root, servers, clients } = await temporary(t),
    dataDirectory = path.join(root, 'data'),
    f = buildFixture();
  const server = await createCollaborationServer({ dataDirectory, port: 0 });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    '',
    '관리자',
    'quota 검사',
    f.files,
  );
  await server.close();
  const running = await createCollaborationServer({
    dataDirectory,
    port: 0,
    storagePolicy: { maxProjectBytes: 1 },
  });
  servers.add(running);
  const owner = new CollaborationClient(
    { ...created.credentials, serverUrl: `http://127.0.0.1:${running.port}` },
    () => {},
  );
  clients.add(owner);
  await owner.refresh();
  assert.equal(owner.state.connected, true);
  const before = structuredClone(owner.files);
  await assert.rejects(
    owner.command('documents:create-idea', { title: '추가', x: 120, y: 120 }),
    (e) => e.code === 'PROJECT_STORAGE_LIMIT',
  );
  await owner.refresh();
  assert.deepEqual(owner.files, before);
  await owner.command('documents:delete', { relativePath: f.artifact.path });
  assert.equal(readGameBuildIndex(owner.files).artifacts.length, 0);
  assert.deepEqual(
    serverEnvironment({ GAMEJAM_MAX_PROJECT_BYTES: '1234' }).storagePolicy,
    { maxProjectBytes: 1234 },
  );
  assert.throws(() => serverEnvironment({ GAMEJAM_MAX_PROJECT_BYTES: '-1' }));
});

test('HTTP body admission bounds concurrent retained bytes, chunked bodies and releases reservations on failure', async () => {
  const admission = createRequestAdmission({ bytes: 20, concurrent: 2 });
  const q = (bytes) => ({
    method: 'POST',
    headers: { 'content-length': String(bytes) },
  });
  const release1 = admission(q(12));
  assert.throws(() => admission(q(10)), { code: 'REQUEST_CAPACITY' });
  const release2 = admission(q(8));
  assert.throws(() => admission(q(0)), { code: 'REQUEST_CAPACITY' });
  release1();
  release2();
  const stream = Readable.from(['{"value":"', 'a'.repeat(20), '"}']);
  stream.headers = {};
  stream.method = 'POST';
  const release = admission(stream);
  await assert.rejects(body(stream), { code: 'REQUEST_CAPACITY' });
  release();
  const onceMore = admission(q(20));
  onceMore();
  assert.throws(() => admission(q(72_000_001)), { status: 413 });
  assert.throws(
    () =>
      admission({ method: 'POST', headers: { 'content-length': '22000001' } }),
    { status: 413 },
  );
});

test('real HTTP admission holds capacity through queued work and health remains available', async () => {
  let entered, unblock;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    unblock = resolve;
  });
  const server = http.createServer(
    createHttpHandler(
      [
        async (request, response, url) => {
          if (url.pathname === '/health') {
            reply(response, 200, { ready: true });
            return true;
          }
          await body(request);
          entered();
          await blocked;
          reply(response, 200, { ok: true });
          return true;
        },
      ],
      async () => {},
      { requestBudget: { bytes: 12, concurrent: 1 } },
    ),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const pending = fetch(url, { method: 'POST', body: '{}' });
    await started;
    const denied = await fetch(url, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 503);
    assert.equal((await denied.json()).code, 'REQUEST_CAPACITY');
    assert.equal((await fetch(url + '/health')).status, 200);
    unblock();
    assert.equal((await pending).status, 200);
    assert.equal(
      (await fetch(url, { method: 'POST', body: '{}' })).status,
      200,
    );
  } finally {
    unblock();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('disconnecting a caller does not release memory admission while its queued work still owns parsed input', async () => {
  let enter, unblock, disconnected;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const blocked = new Promise((resolve) => {
    unblock = resolve;
  });
  const closed = new Promise((resolve) => {
    disconnected = resolve;
  });
  let first = true;
  const server = http.createServer(
    createHttpHandler(
      [
        async (request, response) => {
          await body(request);
          if (first) {
            first = false;
            response.once('close', disconnected);
            enter();
            await blocked;
          }
          reply(response, 200, { ok: true });
          return true;
        },
      ],
      async () => {},
      { requestBudget: { bytes: 12, concurrent: 1 } },
    ),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const caller = http.request(url, {
    method: 'POST',
    headers: { 'content-length': '2' },
  });
  caller.on('error', () => {});
  caller.end('{}');
  try {
    await entered;
    caller.destroy();
    await closed;
    assert.equal(
      (await fetch(url, { method: 'POST', body: '{}' })).status,
      503,
    );
    unblock();
    // Await completion of the original handler, then a second request can use the slot.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      (await fetch(url, { method: 'POST', body: '{}' })).status,
      200,
    );
  } finally {
    unblock();
    caller.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
