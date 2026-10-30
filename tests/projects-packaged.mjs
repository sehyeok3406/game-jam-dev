import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-home-packaged-'));
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
const clickText = (selector, text) =>
  js(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`,
  );
async function fillDialog(value) {
  await wait('!!document.querySelector("[data-ui-id=home-organize] input")');
  await js(
    'document.querySelector("[data-ui-id=home-organize] input").select()',
  );
  await send('Input.insertText', { text: value });
  await js(
    'document.querySelector("[data-ui-id=home-organize]").requestSubmit()',
  );
  await wait('!document.querySelector("[data-ui-id=home-organize]")');
}
try {
  await boot();
  const localId = 'local:' + game.toLowerCase();
  await js('document.querySelector(".home-project-more").click()');
  await clickText('.home-context-menu button', '이름 변경');
  await fillDialog('패키지에서 바꾼 프로젝트');
  assert.equal(
    (await call('listProjects')).find((e) => e.id === localId).name,
    '패키지에서 바꾼 프로젝트',
  );
  const renamed = await fs.readFile(path.join(game, 'project.md'), 'utf8');
  assert.match(renamed, /custom: preserve/);
  assert.match(renamed, /# 원본 한글 내용/);
  await js(
    `document.querySelector('[aria-label="새 홈 폴더 만들기"]').click()`,
  );
  await fillDialog('패키지 홈 폴더');
  const folder = (await call('listProjectFolders'))[0];
  await js('document.querySelector(".home-project-more").click()');
  await clickText('.home-context-menu button', '폴더로 이동');
  await wait('!!document.querySelector("[data-ui-id=home-organize] select")');
  await js(
    `(()=>{ const e=document.querySelector('[data-ui-id=home-organize] select'); e.value=${JSON.stringify(folder.id)}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await js(
    'document.querySelector("[data-ui-id=home-organize]").requestSubmit()',
  );
  await wait('!document.querySelector("[data-ui-id=home-organize]")');
  assert.equal(
    (await call('listProjects')).find((e) => e.id === localId).folderId,
    folder.id,
  );
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(game)})`,
  );
  assert.match(
    (await call('getDocument', 'project.md')).body,
    /원본 한글 내용/,
  );
  await call('goHome');
  const plan = await call('prepareProjectTrash', localId);
  const storage = {
    ['game-canvas-draft:' + game + ':project.md']: 'preserved draft',
  };
  const trashId = await call('trashProject', plan.token, storage);
  await assert.rejects(fs.access(path.join(game, 'project.md')), {
    code: 'ENOENT',
  });
  assert.equal((await call('listProjectTrash'))[0].trashId, trashId);
  assert.ok(!(await call('listProjects')).some((e) => e.id === localId));
  assert.deepEqual(await call('restoreProjectTrash', trashId), storage);
  await call('acknowledgeProjectRestore', trashId);
  assert.equal(
    await fs.readFile(path.join(game, 'project.md'), 'utf8'),
    renamed,
  );
  assert.equal(
    (await call('listProjects')).find((e) => e.id === localId).folderId,
    folder.id,
  );
  await call('openProject', localId);
  const server = await call('startLocalCollaborationServer');
  const shared = await call('createCollaboration', {
    serverUrl: server.serverUrl,
    serverKey: '',
    nickname: '격리 패키지 관리자',
  });
  const sharedId = (await call('listProjects')).find(
    (e) => e.projectId === shared.projectId,
  ).id;
  await call('goHome');
  await call('renameProject', sharedId, '패키지 공동 이름');
  const online = (await call('listProjects', true)).find(
    (e) => e.id === sharedId,
  );
  assert.equal(online.name, '패키지 공동 이름');
  assert.equal(online.role, 'admin');
  assert.ok(
    !JSON.stringify(await call('listProjects')).includes('recoveryKey'),
  );
  console.log(
    'PASS: actual Windows home UI renames/groups/opens local projects; IPC trash restores files, drafts and grouping; internal shared server refresh/rename preserves administrator membership',
  );
  await stop(true);
  await boot();
  const entries = await call('listProjects', true);
  assert.equal(entries.find((e) => e.id === localId).folderId, folder.id);
  assert.equal(entries.find((e) => e.id === sharedId).name, '패키지 공동 이름');
  const currentServer = await call('startLocalCollaborationServer');
  await call('openProject', sharedId);
  const reconnected = await call('getCollaboration');
  assert.equal(reconnected.connected, true);
  assert.equal(reconnected.role, 'admin');
  assert.equal(reconnected.serverUrl, currentServer.serverUrl);
  assert.equal(
    (await call('getProjectLayout')).version,
    1,
    'An app restart must not migrate an existing shared project',
  );
  const sharedRoot = (await call('getWorkspace')).root;
  const layoutDialog = '[role=dialog][aria-label="프로젝트 파일 구조 정리"]';
  await wait(
    '!!document.querySelector(".canvas-main-menu") || !!document.querySelector(".home-project-card")',
  );
  if (!(await js('!!document.querySelector(".canvas-main-menu")')))
    await js(
      'Array.from(document.querySelectorAll(".home-project-card")).find(e=>e.textContent.includes("패키지 공동 이름")).querySelector(".home-project-open").click()',
    );
  await wait('!!document.querySelector(".canvas-main-menu summary")');
  await js('document.querySelector(".canvas-main-menu summary").click()');
  await clickText('.canvas-main-menu button', '설정 및 도구');
  await wait('!!document.querySelector(".canvas-settings")');
  await clickText('.canvas-settings button', '프로젝트 파일 구조 정리…');
  await wait(`!!document.querySelector(${JSON.stringify(layoutDialog)})`);
  assert.ok(
    await js(
      `document.querySelector(${JSON.stringify(layoutDialog)}).textContent.includes("다른 사용자도 업데이트")`,
    ),
  );
  const layoutScreenshot = await send('Page.captureScreenshot', {
    format: 'png',
  });
  await fs.mkdir(path.resolve('out/test-validation'), { recursive: true });
  await fs.writeFile(
    path.resolve('out/test-validation/project-layout-dialog.png'),
    Buffer.from(layoutScreenshot.data, 'base64'),
  );
  await clickText(
    '[role=dialog][aria-label="프로젝트 파일 구조 정리"] button',
    '파일 구조 정리',
  );
  await wait('window.gameCanvas.getProjectLayout().then(s=>s.version===2)');
  await wait(
    `document.querySelector(${JSON.stringify(layoutDialog)}).textContent.includes("이미 새 파일 구조")`,
  );
  await clickText(
    '[role=dialog][aria-label="프로젝트 파일 구조 정리"] button',
    '닫기',
  );
  assert.ok(
    await fs.stat(path.join(sharedRoot, '.gamejam/project/layout.json')),
  );
  await assert.rejects(fs.access(path.join(sharedRoot, 'project.md')), {
    code: 'ENOENT',
  });
  const migrated = (await call('listDocuments')).find(
    (d) => d.id === 'project',
  );
  assert.match(migrated.relativePath, /^docs\/[^/]+\.md$/);
  assert.match(migrated.body, /원본 한글 내용/);
  const idea = await call('createIdea', { x: 900, y: 500 });
  assert.match(idea.relativePath, /^docs\/[^/]+\.md$/);
  await js(
    `document.querySelector(${JSON.stringify('button[title="프로젝트 홈으로 돌아가기"]')}).click()`,
  );
  await wait('!!document.querySelector(".home-project-card")');
  await js(
    'Array.from(document.querySelectorAll(".home-project-card")).find(e=>e.textContent.includes("패키지 공동 이름")).querySelector(".home-project-more").click()',
  );
  await wait(
    '!!Array.from(document.querySelectorAll(".home-context-menu button")).find(e=>e.textContent.trim()==="탐색기에서 표시")',
  );
  await clickText('.home-context-menu button', '탐색기에서 표시');
  await wait('!document.querySelector(".home-context-menu")');
  assert.equal(
    (await call('getWorkspace')).root,
    null,
    'Reveal must not switch the active project',
  );
  const blank = await call('createProject', {
    mode: 'local',
    name: '빈 패키지 프로젝트',
    parent: root,
  });
  assert.deepEqual(await call('listDocuments'), []);
  await assert.rejects(fs.access(path.join(blank.root, 'project.md')), {
    code: 'ENOENT',
  });
  const blankEntry = (await call('listProjects')).find(
    (entry) => entry.root === blank.root,
  );
  await call('goHome');
  await call('openProject', sharedId);
  const copySource = await call('getWorkspace');
  const copied = await call('copySelectionToProject', {
    session: copySource.session,
    targetId: blankEntry.id,
    requestId: randomUUID(),
    canvasId: 'default',
    selection: {
      canvasId: 'default',
      documents: [{ id: migrated.id, path: migrated.relativePath }],
      sections: [],
      previews: [],
      drawings: [],
    },
  });
  assert.equal(copied.count, 1);
  assert.ok(
    copied.paths.every((relative) => /^docs\/[^/]+\.md$/.test(relative)),
  );
  assert.match(
    await fs.readFile(path.join(blank.root, copied.paths[0]), 'utf8'),
    /creation_origin: project-copy/,
  );
  await call('goHome');
  await stop(true);
  await boot();
  await call('openProject', sharedId);
  assert.equal((await call('getProjectLayout')).version, 2);
  assert.match(
    (await call('getDocument', migrated.relativePath)).body,
    /원본 한글 내용/,
  );
  await call('goHome');
  console.log(
    'PASS: shared layout upgrade uses the real settings dialog, preserves documents across restart, exposes the home Explorer action without switching projects, and new projects stay empty',
  );
  const info = JSON.stringify({
    format: 'gamejam-connection',
    version: 1,
    projectId: shared.projectId,
    serverUrl: 'https://fixture.invalid',
  });
  const inspected = await call('inspectConnectionInfo', info);
  assert.equal(inspected.id, sharedId);
  assert.equal(inspected.serverUrl, 'https://fixture.invalid');
  // Applying only updates the saved URL; do not attempt any external connection.
  await call('applyConnectionInfo', info);
  assert.equal(
    (await call('listProjects')).find((e) => e.id === sharedId).serverUrl,
    'https://fixture.invalid',
  );
  console.log(
    'PASS: full process restart retains home grouping and shared session; fresh internal server port is used by refresh/open; connection info inspection/application keeps credentials private',
  );
} finally {
  await stop();
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
