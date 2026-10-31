import { CollaborationClient } from '../src/collaboration-client.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-session-packaged-'),
);
const profileId = randomUUID(),
  profile = path.join(
    process.env.APPDATA,
    'Game Canvas',
    'test-users',
    profileId,
  ),
  game = path.join(root, 'game');
await fs.mkdir(game, { recursive: true });
await fs.writeFile(
  path.join(game, 'project.md'),
  '---\nid: project\ntitle: original\nproject_name: original\ncustom: preserve\n---\n# 원본 한글 내용\n',
);
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '프로젝트 홈 패키지 검사',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const n = s.address().port;
  await new Promise((r) => s.close(r));
  return n;
}
const pause = () => new Promise((r) => setTimeout(r, 100));
let child, ws, js, send;
async function boot() {
  const debugPort = await port();
  child = spawn(
    path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${debugPort}`,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let diagnostic = '';
  child.stderr.on(
    'data',
    (d) => (diagnostic = (diagnostic + d.toString()).slice(-1000)),
  );
  let target;
  for (let n = 0; n < 160; n++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) =>
          r.json(),
        )
      ).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (target) break;
    } catch {}
    await pause();
  }
  assert.ok(target, diagnostic || 'Package did not load');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data)),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params }));
    });
  js = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  await wait('!!window.gameCanvas');
  await wait(
    '!!document.querySelector(".home-project-open") || !!document.querySelector("[data-plugin-launcher]")',
  );
}
async function wait(code) {
  for (let n = 0; n < 160; n++) {
    if (await js(code)) return;
    await pause();
  }
  throw Error('Timeout: ' + code);
}
async function stop(graceful = false) {
  if (graceful && child && child.exitCode === null) {
    let timer;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    void js('window.close()').catch(() => undefined);
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Package did not close normally')),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  ws?.close();
  ws = null;
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  await pause();
}
const call = (method, ...args) =>
  js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
const serverPort = await port(),
  serverUrl = `http://127.0.0.1:${serverPort}`,
  serverKey = 'session-fixture-' + randomUUID();
let server, peer;
async function startServer() {
  const runtime = path.resolve(
    'out/Game Jam!-win32-x64/resources/self-host-runtime',
  );
  server = spawn(
    path.join(runtime, 'node.exe'),
    [path.join(runtime, 'server.mjs')],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        GAME_CANVAS_HOST: '127.0.0.1',
        GAME_CANVAS_PORT: String(serverPort),
        GAME_CANVAS_DATA: path.join(root, 'server-data'),
        GAME_CANVAS_SERVER_KEY: serverKey,
      },
    },
  );
  for (let n = 0; n < 160; n++) {
    try {
      if ((await fetch(serverUrl + '/health')).ok) return;
    } catch {}
    await pause();
  }
  throw Error('Bundled isolated server did not start');
}
async function stopServer() {
  if (server && server.exitCode === null) {
    const done = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await done;
  }
}
try {
  await startServer();
  await boot();
  const localId = 'local:' + game.toLowerCase();
  await call('openProject', localId);
  const owner = await call('createCollaboration', {
    serverUrl,
    serverKey,
    nickname: '패키지 관리자',
  });
  assert.equal(owner.role, 'admin');
  assert.ok(owner.recoveryKey);
  const rotated = await call('rotateInvite');
  assert.notEqual(rotated.inviteCode, owner.inviteCode);
  const joinedPeer = await CollaborationClient.join(
    serverUrl,
    rotated.inviteCode,
    '외부 격리 팀원',
  );
  peer = new CollaborationClient(joinedPeer.credentials, () => {});
  peer.accept(joinedPeer.result);
  await call('setMemberRole', peer.state.memberId, 'viewer');
  await peer.refresh();
  assert.equal(peer.state.role, 'viewer');
  await call('setMemberRole', peer.state.memberId, 'editor');
  await peer.refresh();
  assert.equal(peer.state.role, 'editor');
  await call('goHome');
  await call('openProject', localId);
  const editor = await call('joinCollaboration', {
    serverUrl,
    code: rotated.inviteCode,
    nickname: '패키지 참여자',
  });
  assert.equal(editor.role, 'admin');
  assert.equal(
    editor.memberId,
    owner.memberId,
    'Repeated joining must reuse the registered member',
  );
  assert.equal(editor.members.length, 2);
  const sharedId = (await call('listProjects')).find(
      (entry) => entry.projectId === editor.projectId,
    ).id,
    sharedRoot = (await call('getWorkspace')).root;
  assert.ok(
    path.resolve(sharedRoot).startsWith(path.resolve(profile) + path.sep),
  );
  await send('Page.reload');
  await wait('!!document.querySelector("[data-plugin-launcher]")');
  await stopServer();
  await wait('window.gameCanvas.getCollaboration().then(s=>!s.connected)');
  await call('acquireDocumentLock', 'project.md');
  const doc = await call('getDocument', 'project.md');
  await call('saveDocument', {
    relativePath: 'project.md',
    title: doc.title,
    body: '내 PC 오프라인 작업',
    documentId: doc.id,
  });
  await assert.rejects(call('leaveCollaboration'), /미동기화/);
  await call('goHome');
  assert.ok(
    (await call('listProjects')).find((entry) => entry.id === sharedId)
      .pendingChanges,
  );
  const cacheBefore = await fs.readFile(
    path.join(sharedRoot, 'server-cache.json'),
    'utf8',
  );
  await startServer();
  await peer.refresh();
  await peer.lock('project.md');
  await peer.command('documents:save', {
    relativePath: 'project.md',
    title: doc.title,
    body: '서버 팀원 작업',
    documentId: doc.id,
  });
  await peer.unlock('project.md');
  await call('openProject', sharedId);
  await wait(
    'window.gameCanvas.getCollaboration().then(s=>!!s.conflicts?.length)',
  );
  await send('Page.reload');
  await wait('!!document.querySelector(".offline-conflict-dialog")');
  assert.match(
    await js('document.querySelector(".offline-conflict-dialog").textContent'),
    /내 PC 오프라인 작업/,
  );
  await js(
    `Array.from(document.querySelectorAll('.offline-conflict-dialog button')).find(e=>e.textContent.trim()==='서버 작업 선택').click()`,
  );
  await js(
    `Array.from(document.querySelectorAll('.offline-conflict-dialog button')).find(e=>e.textContent.trim()==='선택한 버전 반영').click()`,
  );
  await wait(
    'window.gameCanvas.getCollaboration().then(s=>!s.conflicts?.length && !s.pendingChanges)',
  );
  assert.match(
    (await call('getDocument', 'project.md')).body,
    /서버 팀원 작업/,
  );
  const historyRoot = path.join(sharedRoot, '.history');
  const backups = (await fs.readdir(historyRoot)).filter((name) =>
    name.startsWith('offline-resolution-'),
  );
  assert.ok(backups.length > 0);
  const backup = await fs.readFile(
    path.join(historyRoot, backups.at(-1), 'draft.json'),
    'utf8',
  );
  assert.match(backup, /내 PC 오프라인 작업/);
  assert.match(cacheBefore, /offline/);
  await call('leaveCollaboration');
  assert.equal((await call('getWorkspace')).root, game);
  // The legacy leave removes its saved shared card. Recover from the current local return root.
  const recovered = await call('recoverCollaboration', {
    serverUrl,
    projectId: owner.projectId,
    recoveryKey: owner.recoveryKey,
  });
  assert.equal(recovered.role, 'admin');
  assert.equal(recovered.projectId, owner.projectId);

  // Final packaged client + bundled server: history IPC and actual restore UI.
  const historyDoc = await call('createIdea', { x: 60, y: 90 });
  await call('acquireDocumentLock', historyDoc.relativePath);
  await call('saveDocument', {
    relativePath: historyDoc.relativePath,
    documentId: historyDoc.id,
    title: '패키지 기록 검증',
    body: '패키지 기록 수정',
  });
  await call('releaseDocumentLock', historyDoc.relativePath);
  const savedEntry = (await call('listHistory')).find((entry) =>
    entry.files.some((file) => file.relativePath === historyDoc.relativePath),
  );
  assert.ok(savedEntry);
  assert.match(
    await call(
      'readHistoryFile',
      savedEntry.id,
      historyDoc.relativePath,
      'after',
    ),
    /패키지 기록 수정/,
  );
  await call('undo');
  assert.doesNotMatch(
    (await call('getDocument', historyDoc.relativePath)).body,
    /패키지 기록 수정/,
  );
  await call('redo');
  assert.match(
    (await call('getDocument', historyDoc.relativePath)).body,
    /패키지 기록 수정/,
  );
  const connectionNotice = await js(
    'document.querySelector(\'[aria-labelledby="locked-dialog-title"]\')?.textContent ?? null',
  );
  if (connectionNotice) {
    assert.match(connectionNotice, /협업 서버에 다시 연결/);
    await js(
      'document.querySelector(\'[aria-labelledby="locked-dialog-title"] button\').click()',
    );
    await wait(
      '!document.querySelector(\'[aria-labelledby="locked-dialog-title"]\')',
    );
  }
  await wait('!!document.querySelector(".canvas-main-menu")');
  await wait(
    `document.querySelector('[data-id="${historyDoc.id}"]')?.textContent.includes('패키지 기록 검증')`,
  );
  await js(`{
    document.querySelector('.canvas-main-menu > summary').click();
    [...document.querySelectorAll('.canvas-main-menu button')].find(b=>b.textContent.includes('프로젝트 히스토리')).click();
  }`);
  await wait('!!document.querySelector(".history-entry")');
  await js(
    'Array.from(document.querySelectorAll(".history-entry button")).find(b=>b.textContent.includes(' +
      JSON.stringify(historyDoc.relativePath) +
      ')).click()',
  );
  await wait('!!document.querySelector(".history-preview__actions")');
  await js(
    'Array.from(document.querySelectorAll(".history-preview__actions button")).find(b=>b.textContent.trim()==="변경 전").click()',
  );
  await wait(
    'document.querySelector(".history-preview small")?.textContent.includes("변경 전 내용")',
  );
  await js(
    'Array.from(document.querySelectorAll(".history-preview__actions button")).find(b=>b.textContent.trim()==="이 파일 버전 복원").click()',
  );
  await wait('!!document.querySelector(\'[data-ui-id="history-confirm"]\')');
  await js(
    'document.querySelector(\'[data-ui-id="history-confirm"] .button-primary\').click()',
  );
  await wait('!document.querySelector(\'[data-ui-id="history-confirm"]\')');
  assert.doesNotMatch(
    (await call('getDocument', historyDoc.relativePath)).body,
    /패키지 기록 수정/,
  );
  assert.ok(
    (await call('listHistory')).some((entry) => entry.kind === 'restore'),
  );
  await js('document.querySelector(\'[title="히스토리 닫기"]\').click()');
  await js(`{
    document.querySelector('.canvas-main-menu > summary').click();
    [...document.querySelectorAll('.canvas-main-menu button')].find(b=>b.textContent.includes('프로젝트 히스토리')).click();
  }`);
  await wait(
    '!!document.querySelector(\'.history-entry[data-history-kind="restore"]\')',
  );
  await fs.mkdir('out/r07-history-lifecycle', { recursive: true });
  assert.equal(
    await js(
      '!!document.querySelector(\'[aria-labelledby="locked-dialog-title"]\')',
    ),
    false,
  );
  const historyCapture = await send('Page.captureScreenshot', {
    format: 'png',
  });
  await fs.writeFile(
    'out/r07-history-lifecycle/history-restored.png',
    Buffer.from(historyCapture.data, 'base64'),
  );
  await js('document.querySelector(\'[title="히스토리 닫기"]\').click()');

  const retentionFixture = await CollaborationClient.create(
    serverUrl,
    serverKey,
    'retention admin',
    'bundled retention',
    { 'project.md': '# 보존할 팀 원본' },
  );
  const retentionClient = new CollaborationClient(
    retentionFixture.credentials,
    () => {},
  );
  retentionClient.accept(retentionFixture.result);
  try {
    assert.equal(
      (
        await retentionClient.request('trash', {
          typedName: 'bundled retention',
          expectedVersion: 0,
          confirmTeam: true,
        })
      ).status,
      'trashed',
    );
    await assert.rejects(
      retentionClient.request('state'),
      (e) => e.code === 'PROJECT_TRASHED',
    );
    await stopServer();
    await startServer();
    await assert.rejects(
      retentionClient.request('state'),
      (e) => e.code === 'PROJECT_TRASHED',
    );
    assert.equal((await retentionClient.request('trash-restore')).version, 2);
    const restoredState = await retentionClient.request('state');
    retentionClient.accept(restoredState);
    assert.equal(retentionClient.files['project.md'], '# 보존할 팀 원본');
    await retentionClient.request('trash', {
      typedName: 'bundled retention',
      expectedVersion: 2,
      confirmTeam: true,
    });
    await retentionClient.request('trash-purge', {
      typedName: 'bundled retention',
    });
    await assert.rejects(
      retentionClient.request('state'),
      (e) => e.code === 'PROJECT_PURGED',
    );
    await stopServer();
    await startServer();
    await assert.rejects(
      retentionClient.request('state'),
      (e) => e.code === 'PROJECT_PURGED',
    );
    console.log(
      'PASS: final bundled Node/server retains team trash across restart, restores file bytes/version, purges durably and rejects checkpoint resurrection after restart.',
    );
  } finally {
    retentionClient.stop();
  }
  await peer.refresh();
  assert.doesNotMatch(peer.files[historyDoc.relativePath], /패키지 기록 수정/);
  await wait('window.gameCanvas.getCollaboration().then(s=>s.connected)');
  console.log(
    'PASS: final Windows package/bundled server history read, undo/redo, real history restore confirmation UI and restart persistence.',
  );
  await call('leaveCollaboration');
  assert.equal((await call('getWorkspace')).root, game);
  assert.match(
    await fs.readFile(path.join(game, 'project.md'), 'utf8'),
    /원본 한글 내용/,
  );
  assert.ok(
    !(await call('listProjects')).some((entry) => entry.id === sharedId),
  );
  console.log(
    'PASS: actual Windows package creates/joins/recovers/leaves an isolated bundled server, rotates invites/roles, preserves offline edits at home, resolves a real conflict through UI with a draft backup, and restores the original local workspace',
  );
} finally {
  peer?.stop();
  await stop();
  await stopServer();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(
    path
      .resolve(profile)
      .startsWith(
        path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users') +
          path.sep,
      ),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
