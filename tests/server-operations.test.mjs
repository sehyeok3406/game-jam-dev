import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { serverEnvironment } from '../src/server/config.ts';
import { createPeerIdentity } from '../src/server/http/peer.ts';
import { MaintenanceGate } from '../src/server/operations/maintenance.ts';
import { createTelemetry } from '../src/server/operations/telemetry.ts';
import { startServerLifetime } from '../src/server/lifetime.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { SqliteProjectRepository } from '../src/adapters/sqlite/project-repository.ts';
import { canonical, inside, checkAncestors } from '../src/trash-files.ts';

const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function temporary(t, beforeRemove = async () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-r10-test-'));
  t.after(async () => {
    await beforeRemove();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('gamejam-r10-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
test('server configuration validates mode and port priority without changing self-host defaults', () => {
  assert.equal(serverEnvironment({}).port, 4317);
  assert.equal(serverEnvironment({ PORT: '10000' }).port, 10000);
  assert.equal(
    serverEnvironment({ PORT: '10000', GAME_CANVAS_PORT: '4318' }).port,
    4318,
  );
  assert.equal(serverEnvironment({}).serviceMode, 'self-host');
  for (const value of ['', '0', '65536', '1.2', '-1', ' 4317', 'NaN', '1e3'])
    assert.throws(
      () => serverEnvironment({ GAME_CANVAS_PORT: value, PORT: '10000' }),
      /포트/,
    );
  for (const env of [
    { GAMEJAM_SERVICE_MODE: 'managed' },
    { GAMEJAM_SERVICE_MODE: 'made-up' },
    { GAMEJAM_SERVICE_MODE: 'managed-beta' },
    { GAME_CANVAS_PUBLIC: 'yes' },
    { GAME_CANVAS_HOST: '*' },
    { GAMEJAM_SHUTDOWN_MS: '30000' },
  ])
    assert.throws(() => serverEnvironment(env));
  assert.equal(
    serverEnvironment({
      GAMEJAM_SERVICE_MODE: 'managed-beta',
      GAME_CANVAS_SERVER_KEY: 'a'.repeat(32),
    }).serviceMode,
    'managed-beta',
  );
});
test('proxy identity ignores untrusted headers and peels only trusted right-hand hops', () => {
  const req = (peer, header) => ({
    socket: { remoteAddress: peer },
    headers: { 'x-forwarded-for': header },
  });
  assert.equal(
    createPeerIdentity()(req('10.0.0.2', '198.51.100.1')),
    '10.0.0.2',
  );
  const identity = createPeerIdentity(['10.0.0.0/24', '::1']);
  assert.equal(
    identity(req('10.0.0.2', '203.0.113.1, 198.51.100.2, 10.0.0.3')),
    '198.51.100.2',
  );
  assert.equal(
    identity(req('::ffff:10.0.0.2', '198.51.100.2')),
    '198.51.100.2',
  );
  assert.equal(identity(req('192.0.2.3', '10.0.0.2')), '192.0.2.3');
  for (const value of [
    'bad',
    '198.51.100.1, garbage',
    ['198.51.100.1'],
    '1'.repeat(2100),
  ])
    assert.equal(identity(req('10.0.0.2', value)), '10.0.0.2');
  for (const cidr of [
    'no',
    '10.0.0.1/33',
    '::1/129',
    '10.0.0.1/-1',
    '10.0.0.1/1/2',
  ])
    assert.throws(() => createPeerIdentity([cidr]));
});
test('permanent drain survives an active backup snapshot releasing its temporary pause', async () => {
  const gate = new MaintenanceGate(),
    entered = defer(),
    release = defer();
  const snapshot = gate.snapshot(
    async () => {},
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  await entered.promise;
  gate.stop();
  release.resolve();
  await snapshot;
  assert.equal(gate.blocked, true);
  await assert.rejects(
    gate.run(async () => {}),
    { status: 503 },
  );
  await assert.rejects(
    gate.snapshot(
      async () => {},
      async () => {},
    ),
    { status: 503 },
  );
});
test('telemetry redacts attacker-controlled paths, query/header values and bounds samples', async () => {
  const entries = [],
    metrics = createTelemetry((entry) => entries.push(entry));
  for (let i = 0; i < 300; i++) {
    const response = new (await import('node:events')).EventEmitter();
    response.setHeader = () => {};
    response.statusCode = i % 2 ? 403 : 200;
    metrics.observe(
      { url: '/evil-token?token=secret', headers: { authorization: 'secret' } },
      response,
    );
    response.emit('finish');
    response.emit('close');
  }
  await assert.rejects(
    metrics.save(async () => {
      throw Error('secret');
    }),
  );
  const status = metrics.snapshot();
  assert.equal(status.requests, 300);
  assert.equal(status.failures, 150);
  assert.equal(status.saveFailures, 1);
  assert.equal(status.sampleLimit, 256);
  assert.equal(new Set(entries.map((x) => x.requestId)).size, 300);
  assert.ok(!JSON.stringify(entries).includes('secret'));
  assert.ok(!JSON.stringify(entries).includes('evil-token'));
  metrics.close();
});
test('draining exposes ready=503, rejects new writes, finishes accepted durable writes and preserves receipt on restart', async (t) => {
  let running;
  const clients = [],
    entries = [],
    entered = defer(),
    release = defer();
  const root = await temporary(t, async () => {
    release.resolve();
    clients.forEach((c) => c.stop());
    await running?.close();
  });
  running = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    requestLog: (entry) => entries.push(entry),
  });
  let url = `http://127.0.0.1:${running.port}`;
  assert.deepEqual(await fetch(url + '/ready').then((r) => r.json()), {
    ready: true,
  });
  const created = await CollaborationClient.create(url, '', '관리자', '원본', {
    'project.md': '# 원본',
  });
  const owner = new CollaborationClient(created.credentials, () => {});
  clients.push(owner);
  owner.accept(created.result);
  const command = {
    id: randomUUID(),
    sessionId: randomUUID(),
    sequence: 1,
    propertySyncVersion: 1,
    canvasSheetsVersion: 1,
    documentStatusesVersion: 1,
    filePropertiesVersion: 1,
    properties: structuredClone(owner.properties),
    revisions: { ...owner.revisions },
    channel: 'documents:create-idea',
    input: { x: 10, y: 20 },
  };
  const original = SqliteProjectRepository.prototype.commit;
  let delayed = false;
  SqliteProjectRepository.prototype.commit = async function (...args) {
    if (!delayed) {
      delayed = true;
      entered.resolve();
      await release.promise;
    }
    return original.apply(this, args);
  };
  t.after(() => {
    SqliteProjectRepository.prototype.commit = original;
  });
  const submit = () =>
    CollaborationClient.fetch(
      url,
      `/projects/${created.credentials.projectId}/command`,
      command,
      created.credentials.token,
    );
  const accepted = submit();
  await entered.promise;
  const closing = running.close();
  const ready = await fetch(url + '/ready');
  assert.equal(ready.status, 503);
  assert.equal((await fetch(url + '/health')).status, 200);
  const denied = await fetch(url + '/projects', { method: 'POST', body: '{}' });
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get('Retry-After'), '2');
  release.resolve();
  const receipt = await accepted;
  await closing;
  SqliteProjectRepository.prototype.commit = original;
  const status = JSON.parse(
    await fs.readFile(path.join(root, 'operations-status.json'), 'utf8'),
  );
  assert.equal(status.ready, false);
  assert.ok(status.rssBytes > 0);
  assert.ok(status.diskFreeBytes > 0);
  running = await createCollaborationServer({ dataDirectory: root, port: 0 });
  url = `http://127.0.0.1:${running.port}`;
  const replay = await submit();
  assert.equal(replay.historyId, receipt.historyId);
  assert.deepEqual(replay.result, receipt.result);
  assert.ok(entries.some((x) => x.status === 503));
  const raw = JSON.stringify(entries);
  for (const value of [
    created.credentials.token,
    created.credentials.projectId,
    '원본',
  ])
    assert.ok(!raw.includes(value));
});
test('shutdown deadline reports stuck cleanup without closing storage under an accepted operation', async () => {
  const release = defer(),
    closed = defer();
  let began = false;
  const running = await startServerLifetime(
    http.createServer((_q, r) => r.end()),
    '127.0.0.1',
    0,
    {
      shutdownMs: 30,
      beginDrain: () => {
        began = true;
      },
      drainAccepted: () => release.promise,
      maintain: async () => {},
      exportDirty: () => {},
      closeMultiplayer: () => {},
      closeEvents: () => {},
      flushDiagnostics: async () => {},
      drain: async () => {},
      waitCheckpoints: async () => {},
      checkpointDirty: async () => {},
      closeStore: () => closed.resolve(),
    },
  );
  const closing = running.close();
  assert.equal(began, true);
  await assert.rejects(closing, /시간/);
  release.resolve();
  await closed.promise;
});
test('Linux paths retain case identity and reject symbolic ancestors on all supported platforms', async (t) => {
  const root = await temporary(t);
  const upper = path.join(root, 'Case'),
    lower = path.join(root, 'case');
  assert.equal(
    canonical(upper) === canonical(lower),
    process.platform === 'win32',
  );
  assert.equal(
    inside(upper, path.join(lower, 'child')),
    process.platform === 'win32',
  );
  await fs.mkdir(upper);
  const link = path.join(root, 'link');
  await fs.symlink(
    upper,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(checkAncestors(path.join(link, 'child')), /링크/);
  if (process.platform !== 'win32') {
    await fs.mkdir(lower);
    assert.notEqual((await fs.stat(upper)).ino, (await fs.stat(lower)).ino);
  }
});
test('managed mode fails before touching data and beta creation ignores client payment/mode spoofing', async (t) => {
  let running;
  const root = await temporary(t, async () => {
    await running?.close();
  });
  await assert.rejects(
    createCollaborationServer({
      dataDirectory: path.join(root, 'blocked'),
      serviceMode: 'managed',
      port: 0,
    }),
    /F01/,
  );
  await assert.rejects(fs.stat(path.join(root, 'blocked')), { code: 'ENOENT' });
  running = await createCollaborationServer({
    dataDirectory: path.join(root, 'beta'),
    serviceMode: 'managed-beta',
    creationKey: 'a'.repeat(32),
    port: 0,
  });
  const url = `http://127.0.0.1:${running.port}`;
  for (let i = 0; i < 11; i++) {
    const response = await fetch(url + '/projects', {
      method: 'POST',
      headers: { 'x-forwarded-for': `198.51.100.${i}` },
      body: JSON.stringify({
        selfHost: true,
        paid: true,
        serviceMode: 'self-host',
      }),
    });
    assert.equal(response.status, i < 10 ? 403 : 429);
  }
});
