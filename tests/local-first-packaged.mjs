import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { acquireWriter } from '../src/server/operations/writer-lock.ts';
import { locationLinkHref } from '../src/core/projects/location-links.ts';
import {
  boot,
  js,
  wait,
  send,
  stop,
  root,
  profile,
} from './helpers/packaged-canvas.mjs';

const require = createRequire(import.meta.url);
const internalData = path.join(profile, 'collaboration-server');
const externalData = path.join(root, 'external');
const serverRequests = [];
let legacyStatus = false;
const nativeFetch = globalThis.fetch;
const external = await createCollaborationServer({
  dataDirectory: externalData,
  port: 0,
  requestLog: (request) => serverRequests.push(request),
});
const internal = await createCollaborationServer({
  dataDirectory: internalData,
  port: 0,
});
const relayRequests = [];
const relay = http.createServer(async (request, response) => {
  try {
    let body = '';
    for await (const chunk of request) body += chunk;
    relayRequests.push(new URL(request.url, 'http://localhost').pathname);
    const result = await nativeFetch(
      `http://127.0.0.1:${external.port}${request.url}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: request.headers.authorization,
        },
        body,
      },
    );
    const value = await result.json();
    if (legacyStatus) delete value.conditionalTrashVersion;
    response.writeHead(result.status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  } catch {
    response.writeHead(503);
    response.end('{}');
  }
});
await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
const call = (name, ...args) =>
  js(`window.gameCanvas[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
const button = (label) =>
  `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
const click = (label) => js(`${button(label)}?.click()`);
const allowed = (label) =>
  wait(`Boolean(${button(label)} && !${button(label)}.disabled)`);
const file = 'unsynced.md';
const directory = (server, project) => path.join(server, project.projectId);
const absent = (file) => assert.rejects(fs.stat(file), { code: 'ENOENT' });
async function project(server, name, internalServer = false) {
  const url = `http://127.0.0.1:${server.port}`;
  const { credentials } = await CollaborationClient.create(
    url,
    '',
    'cleanup owner',
    name,
    { 'project.md': '# original' },
  );
  const { projectId } = credentials;
  return {
    id: `shared:${projectId}`,
    projectId,
    name,
    kind: 'shared',
    serverUrl: url,
    role: 'admin',
    lastOpenedAt: Date.now(),
    credentials: { ...credentials, internalServer },
  };
}
async function seedEncrypted(values) {
  const bootstrap = path.join(root, 'seed.cjs');
  const raw = path.join(root, 'seed.json');
  await fs.writeFile(raw, JSON.stringify(values));
  await fs.writeFile(
    bootstrap,
    `
    const { app, safeStorage } = require('electron');
    const fs = require('node:fs');
    const path = require('node:path');
    const target = process.argv[2];
    app.setPath('userData', target);
    app.setPath('sessionData', target);
    app.whenReady().then(() => {
      for (const [name, value] of Object.entries(JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))))
        fs.writeFileSync(path.join(target, name), safeStorage.encryptString(JSON.stringify(value)));
      app.quit();
    }).catch((error) => { console.error(error.message); app.exit(1); });
  `,
  );
  const child = spawn(require('electron'), [bootstrap, profile, raw], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostic = '';
  child.stderr.on('data', (chunk) => {
    diagnostic += chunk;
  });
  const [code] = await once(child, 'exit');
  await fs.unlink(raw);
  assert.equal(code, 0, 'Electron safeStorage fixture: ' + diagnostic);
}
const lifecycle = (entry) => call('getSharedProjectLifecycle', entry.id);
const move = (entry, version, confirm = true) =>
  call('trashSharedProject', entry.id, entry.name, confirm, version);
const restore = (entry, version) =>
  call('restoreSharedProject', entry.id, version);
const purge = (entry, version, confirm = true) =>
  call('purgeSharedProject', entry.id, entry.name, confirm, version);
let internalStopped = false;
try {
  const local = await project(internal, '내장 원본', true);
  const untouched = await project(internal, '내장 보존', true);
  const remote = await project(external, '외부 원본');
  remote.serverUrl =
    remote.credentials.serverUrl = `http://127.0.0.1:${relay.address().port}`;
  const offline = await project(external, '오프라인 보존');
  const denied = {
    ...remote,
    id: 'revoked-fixture',
    credentials: {
      ...remote.credentials,
      token: randomBytes(32).toString('hex'),
    },
  };
  const mirror = directory(path.join(profile, 'shared-workspaces'), local);
  await fs.mkdir(mirror, { recursive: true });
  await fs.writeFile(path.join(mirror, file), 'local unsent draft');
  const cache = {
    state: {
      projectId: local.projectId,
      projectName: local.name,
      role: 'admin',
    },
    files: {},
    offline: { base: {}, local: { [file]: 'local unsent draft' } },
  };
  await fs.writeFile(
    path.join(mirror, 'server-cache.json'),
    JSON.stringify(cache),
  );
  await fs.writeFile(
    path.join(profile, 'settings.json'),
    JSON.stringify({ workspaceRoot: mirror }),
  );
  await seedEncrypted({
    'projects.enc': [local, untouched, remote, denied, offline],
    'collaboration-session.enc': {
      credentials: remote.credentials,
      localRoot: null,
    },
    'discord-approval.enc': {
      version: 1,
      token: 'isolated-test-token',
      settings: {},
      binding: {},
      notifications: {},
    },
    'web-viewer.enc': {
      publishToken: 'a'.repeat(43),
      accessCode: 'b'.repeat(43),
      projects: [remote.id],
      liveLocal: true,
    },
  });
  const discordPath = path.join(profile, 'discord-approval.enc');
  const discord = await fs.readFile(discordPath);
  await internal.close();
  internalStopped = true;
  serverRequests.length = 0;

  const href = locationLinkHref({
    version: 1,
    projectId: local.projectId,
    target: { kind: 'file', id: 'project.md' },
  });
  await boot(false, process.env, { extraArgs: [href] });
  await wait('document.body.innerText.includes("공유 종료 · 정리 가능")');
  const cards = await call('listProjects', true);
  assert.equal(cards.find((p) => p.id === local.id).pendingChanges, 1);
  assert.equal(cards.find((p) => p.id === local.id).sharedCopyAvailable, true);
  assert.equal((await call('getWorkspace')).root, null);
  assert.equal((await call('getCollaboration')).active, false);
  assert.equal(
    await js('document.querySelectorAll(".home-project-open:disabled").length'),
    5,
  );
  await assert.rejects(call('openProject', local.id), /종료/);
  await assert.rejects(
    call('createProject', { mode: 'shared', name: '차단' }),
    /공동 프로젝트/,
  );
  await assert.rejects(call('joinCollaboration', {}), /종료/);
  await assert.rejects(call('convertProjectToLocal', {}), /종료/);
  await assert.rejects(
    call('startLocalCollaborationServer'),
    /종료|No handler/,
  );
  assert.equal(await js('window.gameCanvas.multiplayer'), undefined);
  assert.equal(await js('window.gameCanvas.discordApproval'), undefined);
  assert.equal(await js('window.gameCanvas.locationLinks'), undefined);
  await click('휴지통');
  await wait('Boolean(document.querySelector(".project-trash-modal"))');
  await click('닫기');
  assert.equal(
    serverRequests.length,
    0,
    'startup and home refresh never use legacy server',
  );
  assert.deepEqual((await call('getWebViewer')).projects, []);
  await assert.rejects(
    call('publishWebViewer', { projects: [remote.id], liveLocal: true }),
    /로컬 프로젝트/,
  );
  const created = await call('createProject', {
    mode: 'local',
    parent: root,
    name: remote.name,
  });
  assert.ok(created.root.startsWith(root + path.sep));
  const document = await call('createIdea', { x: 40, y: 50 });
  await call('saveDocument', {
    relativePath: document.relativePath,
    title: '로컬 저장 검증',
    body: '서버 없이 저장한 본문',
  });
  assert.match(
    (await call('getDocument', document.relativePath)).body,
    /서버 없이 저장한 본문/,
  );
  await stop(true);
  await boot(false);
  const reopened = await call('getWorkspace');
  assert.equal(reopened.root, created.root);
  assert.match(
    (await call('getDocument', document.relativePath)).body,
    /서버 없이 저장한 본문/,
  );
  await js(
    `[...document.querySelectorAll('button')].find(b => b.title.includes('프로젝트 홈') || b.getAttribute('aria-label') === '프로젝트 홈')?.click()`,
  );
  await wait('Boolean(document.querySelector(".home-project-grid"))');
  const lease = await acquireWriter(internalData);
  lease.release();
  assert.deepEqual(await fs.readFile(discordPath), discord);
  assert.equal(
    await fs.readFile(path.join(mirror, file), 'utf8'),
    'local unsent draft',
  );

  const plan = await call('prepareProjectTrash', local.id);
  const trashId = await call('trashProject', plan.token, {});
  await absent(mirror);
  assert.equal((await lifecycle(local)).status, 'active');
  await call('restoreProjectTrash', trashId);
  await call('acknowledgeProjectRestore', trashId);
  assert.equal(
    await fs.readFile(path.join(mirror, file), 'utf8'),
    'local unsent draft',
  );
  const nextPlan = await call('prepareProjectTrash', local.id);
  const second = await call('trashProject', nextPlan.token, {});
  await call('purgeProjectTrash', second, local.name, true);
  await absent(mirror);
  assert.equal(
    (await call('listProjects')).find((p) => p.id === local.id)
      .sharedCopyRemoved,
    true,
  );

  const card = `[...document.querySelectorAll('.home-project-card')].find(e=>e.querySelector('h3')?.textContent===${JSON.stringify(local.name)})`;
  await js(`${card}.querySelector('.home-project-more').click()`);
  await click('서버 원본 관리…');
  await allowed('서버 원본을 휴지통으로 이동…');
  await click('서버 원본을 휴지통으로 이동…');
  await js('document.querySelector(".project-trash-confirm input").focus()');
  await send('Input.insertText', { text: local.name });
  await js(
    'document.querySelector(".project-trash-confirm input[type=checkbox]").click()',
  );
  await allowed('휴지통으로 이동');
  await click('휴지통으로 이동');
  await allowed('팀 프로젝트 복원');
  await click('팀 프로젝트 복원');
  await allowed('서버 원본을 휴지통으로 이동…');
  await click('닫기');

  await assert.rejects(lifecycle(denied), /권한/);
  for (const [entry, data] of [
    [local, internalData],
    [remote, externalData],
  ]) {
    const active = await lifecycle(entry);
    assert.equal(active.status, 'active');
    await assert.rejects(move(entry, active.version + 1), /상태/);
    await assert.rejects(move(entry, active.version, false), /확인/);
    assert.ok((await fs.stat(directory(data, entry))).isDirectory());
    const trashed = await move(entry, active.version);
    await absent(directory(data, entry));
    await assert.rejects(purge(entry, trashed.version, false), /확인/);
    if (entry === remote) {
      legacyStatus = true;
      relayRequests.length = 0;
      await assert.rejects(restore(entry, trashed.version), /업데이트/);
      await assert.rejects(purge(entry, trashed.version), /업데이트/);
      assert.ok(
        relayRequests.every((route) => route.endsWith('/trash-status')),
      );
      assert.equal((await lifecycle(entry)).status, 'trashed');
      legacyStatus = false;
    }
    const restored = await restore(entry, trashed.version);
    assert.ok((await fs.stat(directory(data, entry))).isDirectory());
    const again = await move(entry, restored.version);
    await assert.rejects(purge(entry, trashed.version), /상태/);
    assert.equal((await purge(entry, again.version)).status, 'purged');
    assert.equal((await lifecycle(entry)).status, 'purged');
    await absent(directory(data, entry));
  }
  assert.ok((await fs.stat(directory(internalData, untouched))).isDirectory());
  const finalLease = await acquireWriter(internalData);
  finalLease.release();

  const beforeOffline = await lifecycle(offline);
  await external.close();
  await assert.rejects(move(offline, beforeOffline.version), /연결/);
  assert.ok((await fs.stat(directory(externalData, offline))).isDirectory());
  assert.equal(
    (await call('listProjects')).find((p) => p.id === remote.id).lifecycle
      .status,
    'purged',
  );
  console.log(
    'PASS: Windows cold startup, retired cards and routes, PC copy restore/purge, selected embedded and external cleanup, stale/offline data retention',
  );
} finally {
  await stop();
  await new Promise((resolve) => relay.close(resolve));
  if (!internalStopped) await internal.close();
  await external.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  for (const directory of [profile, root])
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
}
