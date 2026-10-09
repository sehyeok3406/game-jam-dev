import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ProjectLibrary } from '../src/project-library.ts';
import { connectionInfo, parseConnectionInfo } from '../src/connection-info.ts';
import {
  SelfHostService,
  isHostedSession,
} from '../src/features/self-host/service.ts';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text),
  decryptString: (bytes) => bytes.toString(),
};
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-self-host-'));
  let db;
  t.after(async () => {
    db?.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('gamejam-self-host-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, 'host');
  const runtimeSource = path.join(root, 'runtime');
  await fs.mkdir(runtimeSource);
  for (const name of [
    'server.mjs',
    'bridge.ps1',
    'connect.ps1',
    'diagnostics.ps1',
    'host.ps1',
    'runtime-version.json',
    'node.exe',
    'NODE-LICENSE.txt',
  ])
    await fs.writeFile(path.join(runtimeSource, name), 'test-runtime');
  await fs.mkdir(path.join(directory, 'projects'), { recursive: true });
  db = new DatabaseSync(path.join(directory, 'projects/sync.sqlite'));
  db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const library = new ProjectLibrary(path.join(root, 'registry'), encryption);
  await library.load();
  const service = new SelfHostService({
    directory,
    runtimeSource,
    library,
    activeProject: () => undefined,
    changed: () => {},
    appVersion: 'fixture',
    appPath: root,
  });
  const put = (id, token, removed = false) =>
    db.prepare('INSERT OR REPLACE INTO projects VALUES (?, ?)').run(
      id,
      JSON.stringify({
        members: [
          {
            tokenHash: createHash('sha256').update(token).digest('hex'),
            removed,
          },
        ],
      }),
    );
  const ready = {
    schemaVersion: 1,
    status: 'already-running',
    checkedAt: new Date().toISOString(),
    code: '',
    publicUrl: 'https://new-host.trycloudflare.com',
    port: 4318,
    checks: {
      runtimeValid: true,
      serverOwnership: 'owned',
      tunnelOwnership: 'owned',
      localHealthy: true,
      publicHealthy: true,
      portChecked: true,
      serverFile: true,
      nodeReady: null,
      nodeVersion: '',
      cloudflaredReady: null,
    },
  };
  service.bridge = async () => JSON.stringify(ready);
  return { root, directory, runtimeSource, db, library, service, put, ready };
}
test('connection info targets a single existing project and rejects unsafe addresses and malformed input', () => {
  const projectId = randomUUID();
  const parsed = parseConnectionInfo(
    connectionInfo(projectId, 'https://new.example'),
  );
  assert.equal(parsed.projectId, projectId);
  assert.equal(parsed.serverUrl, 'https://new.example');
  for (const url of [
    'http://remote.example',
    'https://user:secret@new.example',
    'https://new.example/path',
    'https://new.example/?token=secret',
    'file:///private',
  ])
    assert.throws(() => parseConnectionInfo(connectionInfo(projectId, url)));
  for (const text of [
    'null',
    '{}',
    '{broken',
    'x'.repeat(5000),
    connectionInfo('../private', 'https://new.example'),
  ])
    assert.throws(() => parseConnectionInfo(text));
});
test('automatic address updates verify committed membership, preserving credentials and unrelated servers', async (t) => {
  const { directory, library, service, put } = await fixture(t);
  const owned = {
    projectId: randomUUID(),
    serverUrl: 'https://old.example',
    token: 'owned-token',
    recoveryKey: 'private-recovery',
    inviteCode: 'private-invite',
  };
  const foreign = {
    projectId: randomUUID(),
    serverUrl: owned.serverUrl,
    token: 'foreign-token',
  };
  const revoked = {
    projectId: randomUUID(),
    serverUrl: owned.serverUrl,
    token: 'revoked-token',
  };
  await library.rememberShared(owned, 'Owned', 'admin', '/local-original');
  await library.rememberShared(foreign, 'Foreign', 'editor', null);
  await library.rememberShared(revoked, 'Revoked', 'editor', null);
  put(owned.projectId, owned.token);
  put(foreign.projectId, 'a-different-session');
  put(revoked.projectId, revoked.token, true);
  assert.equal(await isHostedSession(directory, foreign), false);
  await service.run('check');
  const updated = library.get(`shared:${owned.projectId}`);
  assert.deepEqual(updated.credentials, {
    ...owned,
    serverUrl: 'https://new-host.trycloudflare.com',
  });
  assert.equal(updated.localRoot, '/local-original');
  assert.equal(updated.role, 'admin');
  assert.equal(
    library.get(`shared:${foreign.projectId}`).serverUrl,
    owned.serverUrl,
  );
  assert.equal(
    library.get(`shared:${revoked.projectId}`).serverUrl,
    owned.serverUrl,
  );
  assert.equal(service.state.projects.length, 1);
  const info = await service.info(updated.id, 'connection');
  assert.equal(parseConnectionInfo(info).projectId, owned.projectId);
  assert.ok(!info.includes(owned.token) && !info.includes(owned.recoveryKey));
  const prompt = service.prompt();
  for (const secret of [owned.token, owned.recoveryKey, owned.inviteCode])
    assert.ok(!prompt.includes(secret));
});
test('a failed external check never changes saved addresses or copies a stale connection', async (t) => {
  const { library, service, put, ready } = await fixture(t);
  const credentials = {
    projectId: randomUUID(),
    serverUrl: 'https://old.example',
    token: 'token',
  };
  await library.rememberShared(credentials, 'Saved', 'admin', null);
  put(credentials.projectId, credentials.token);
  ready.checks.publicHealthy = false;
  ready.code = 'GC-HOST-010';
  await service.run('check');
  assert.equal(service.state.stage, 'problem');
  assert.equal(
    library.get(`shared:${credentials.projectId}`).serverUrl,
    credentials.serverUrl,
  );
  await assert.rejects(
    service.info(`shared:${credentials.projectId}`, 'connection'),
  );
});
test('an AI stop refusal prevents restart and keeps the original error visible', async (t) => {
  const { service } = await fixture(t);
  const actions = [];
  service.bridge = async (action) => {
    actions.push(action);
    return JSON.stringify({ code: 'GC-HOST-AI' });
  };
  await service.run('restart');
  assert.deepEqual(actions, ['Stop']);
  assert.equal(service.state.code, 'GC-HOST-AI');
});
test('simultaneous starts share one operation and a conflicting stop is refused', async (t) => {
  const { service, ready } = await fixture(t);
  const actions = [];
  service.bridge = async (action) => {
    actions.push(action);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return JSON.stringify(ready);
  };
  const start = service.run('start');
  const duplicate = service.run('start');
  await assert.rejects(service.run('stop'), /진행 중/);
  await Promise.all([start, duplicate]);
  assert.deepEqual(actions, ['Start']);
});
test('close choices survive app restart and malformed preferences are reported', async (t) => {
  const { service, directory } = await fixture(t);
  await service.setCloseBehavior('background');
  service.state.closeBehavior = 'ask';
  await service.init();
  assert.equal(service.state.closeBehavior, 'background');
  await assert.rejects(service.setCloseBehavior('terminate-every-process'));
  await fs.writeFile(path.join(directory, 'app-settings.json'), '{broken');
  await service.init();
  assert.equal(service.state.code, 'GC-HOST-015');
});
test('checksum failures never install the downloaded executable or expose metadata errors', async (t) => {
  const { service, directory } = await fixture(t);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) =>
    url ===
    'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'
      ? Response.json({
          assets: [
            {
              name: 'cloudflared-windows-amd64.exe',
              digest: 'sha256:' + 'a'.repeat(64),
              size: 4,
              browser_download_url:
                'https://github.com/cloudflare/cloudflared/releases/download/fixture/cloudflared-windows-amd64.exe',
            },
          ],
        })
      : new Response('fake');
  await assert.rejects(service.downloadCloudflared(), /GC-HOST-DOWNLOAD/);
  await assert.rejects(fs.stat(path.join(directory, 'tools/cloudflared.exe')));
  assert.deepEqual(await fs.readdir(path.join(directory, 'tools')), []);
});
