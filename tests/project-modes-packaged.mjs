import { CollaborationClient } from '../src/collaboration-client.ts';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-project-mode-packaged-'),
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
  path.join(profile, 'test-user.json'),
  JSON.stringify({ nickname: '프로젝트 전환 검증' }),
);
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
    { windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
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

const click = (selector, text) =>
  js(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(text)} || e.textContent.includes(${JSON.stringify(text)})).click()`,
  );
async function nameInput(value) {
  await js(
    'document.querySelector(".project-create-dialog input:not([readonly])").select()',
  );
  await send('Input.insertText', { text: value });
}
let peer;
try {
  await boot();
  await click('.home-heading button', '프로젝트 추가');
  await wait('!!document.querySelector(".home-entry-actions")');
  await click('.home-entry-actions button', '새 프로젝트 만들기');
  await wait('!!document.querySelector(".project-create-dialog")');
  assert.equal(
    await js('document.querySelector("#project-create-title").textContent'),
    '새 프로젝트',
  );
  assert.equal(
    await js(
      'document.querySelector(".project-create-dialog button[type=submit]").disabled',
    ),
    true,
  );
  await nameInput('CON');
  await wait(
    'document.querySelector("#project-name-feedback").textContent.includes("예약")',
  );
  await nameInput('생성 전환 패키지 검사');
  assert.equal(
    await js(
      'document.querySelector(".project-create-dialog button[type=submit]").disabled',
    ),
    true,
  );
  const initialCount = (await call('listProjects')).length;
  await click('.project-create-dialog button', '폴더 선택');
  console.log(
    'FOLDER_PICKER_READY ' + JSON.stringify({ parent: root, profileId }),
  );
  let selected = '';
  for (let n = 0; n < 1800; n++) {
    selected = await js(
      'document.querySelector(".project-create-dialog input[readonly]")?.value ?? ""',
    );
    if (selected) break;
    await pause();
  }
  assert.ok(selected, 'Native folder selector did not finish');
  assert.equal(
    path.resolve(selected).toLowerCase(),
    path.resolve(root).toLowerCase(),
    'Only the owned temporary parent may be used',
  );
  const projectName = '생성 전환 패키지 검사';
  const createdRoot = path.join(selected, projectName);
  assert.equal((await call('listProjects')).length, initialCount);
  await assert.rejects(fs.stat(createdRoot), { code: 'ENOENT' });
  assert.equal(
    await js(
      'document.querySelector(".project-create-dialog input[readonly]").readOnly',
    ),
    true,
  );
  assert.equal(
    await js(
      'document.querySelector(".project-create-dialog button[type=submit]").textContent.trim()',
    ),
    '완료',
  );
  await fs.mkdir('out/release-v0.37.0', { recursive: true });
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    'out/release-v0.37.0/project-create.png',
    Buffer.from(shot.data, 'base64'),
  );
  await click('.project-create-dialog button[type=submit]', '완료');
  await wait('!document.querySelector(".project-create-dialog")');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(createdRoot)})`,
  );
  const sourceEntry = (await call('listProjects')).find(
    (e) => e.root === createdRoot,
  );
  assert.ok(sourceEntry);
  await call('createProjectFolder', '전환 분류');
  const folder = (await call('listProjectFolders')).find(
    (f) => f.name === '전환 분류',
  );
  await call('moveProject', sourceEntry.id, folder.id);
  const server = await call('startLocalCollaborationServer');
  const owner = await call('createCollaboration', {
    serverUrl: server.serverUrl,
    serverKey: '',
    nickname: '전환 관리자',
  });
  let entries = await call('listProjects');
  assert.equal(entries.length, initialCount + 1);
  assert.equal(
    entries.find((e) => e.projectId === owner.projectId).id,
    sourceEntry.id,
  );
  await assert.rejects(call('convertProjectToLocal', {}), /후임|소유권/);
  const joined = await CollaborationClient.join(
    server.serverUrl,
    owner.inviteCode,
    '후임 관리자',
  );
  peer = new CollaborationClient(joined.credentials, () => {});
  peer.accept(joined.result);
  await wait(
    'window.gameCanvas.getCollaboration().then(s=>s.members.length===2)',
  );
  await click('button', '협업');
  await wait('!!document.querySelector(".canvas-collaboration")');
  await click('.canvas-collaboration button', '참여자 · 초대 관리');
  await wait('!!document.querySelector(".collaboration-dialog")');
  await click('.collaboration-dialog button', '로컬로 전환');
  await wait(`!!document.querySelector('select[aria-label="후임 관리자"]')`);
  await js(
    `(()=>{ const select=document.querySelector('select[aria-label="후임 관리자"]'); select.value=${JSON.stringify(peer.state.memberId)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  );
  await click('.collaboration-dialog button', '소유권 인계 요청');
  await peer.refresh();
  const recoveryKey = randomBytes(32).toString('hex');
  await peer.handover('accept', { id: peer.state.handover.id, recoveryKey });
  await wait(
    'window.gameCanvas.getCollaboration().then(s=>!!s.handover?.accepted)',
  );
  await peer.command('documents:create-idea', { x: 710, y: 210 });
  const latestPaths = Object.keys(peer.files);
  await click('.collaboration-confirm button', '완료');
  await wait('window.gameCanvas.getCollaboration().then(s=>!s.active)');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(createdRoot)})`,
  );
  assert.equal((await call('getWorkspace')).root, createdRoot);
  for (const relative of latestPaths)
    await fs.access(path.join(createdRoot, relative));
  await peer.refresh();
  assert.equal(peer.state.role, 'admin');
  assert.equal(peer.state.members.length, 1);
  await peer.command('documents:create-idea', { x: 0, y: 0 });
  entries = await call('listProjects');
  assert.equal(entries.length, initialCount + 1);
  assert.equal(entries.find((e) => e.id === sourceEntry.id).kind, 'local');
  assert.equal(
    entries.find((e) => e.id === sourceEntry.id).folderId,
    folder.id,
  );
  console.log(
    'PASS: native folder selection only fills a read-only path; explicit completion creates once; IPC share/detach preserves card and folder, copies latest data and transfers ownership while another member continues editing',
  );
  await peer.leave();
  peer = null;
  await js(`document.querySelector('[title="협업 창 닫기"]')?.click()`);
  await call('goHome');
  await stop(true);
  await boot();
  entries = await call('listProjects');
  assert.equal(entries.find((e) => e.id === sourceEntry.id).kind, 'local');
  assert.equal(
    entries.find((e) => e.id === sourceEntry.id).folderId,
    folder.id,
  );
  assert.equal(entries.length, initialCount + 1);
  console.log(
    'PASS: full packaged process restart preserves the local mode, files, stable card ID and home classification',
  );
  await call('goHome');
  await wait('!!document.querySelector(".home-heading")');
  await click('.home-heading button', '프로젝트 추가');
  await click('.home-entry-actions button', '새 프로젝트 만들기');
  await wait('!!document.querySelector(".project-create-dialog")');
  await click('.project-mode-options button', '공동');
  assert.equal(
    await js(
      'document.querySelector(".project-create-dialog .project-location-row") !== null',
    ),
    false,
  );
  await nameInput('처음부터 공동 검사');
  const nextServer = await call('startLocalCollaborationServer');
  for (const [label, value] of [
    ['서버 주소', nextServer.serverUrl],
    ['닉네임', '새 공동 생성자'],
  ]) {
    await js(
      `Array.from(document.querySelectorAll('.project-create-dialog label')).find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input').select()`,
    );
    await send('Input.insertText', { text: value });
  }
  await click('.project-create-dialog button[type=submit]', '완료');
  await wait('!document.querySelector(".project-create-dialog")');
  const direct = await call('getCollaboration');
  assert.equal(direct.projectName, '처음부터 공동 검사');
  entries = await call('listProjects');
  assert.equal(entries.length, initialCount + 2);
  assert.equal(
    entries.filter((e) => e.kind === 'local').length,
    initialCount + 1,
  );
  assert.equal(
    entries.find((e) => e.projectId === direct.projectId).kind,
    'shared',
  );
  console.log(
    'PASS: shared mode UI completes native direct creation without an intermediate local card',
  );
} catch (error) {
  if (ws?.readyState === WebSocket.OPEN) {
    const failureShot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      'out/release-v0.37.0/project-mode-failure.png',
      Buffer.from(failureShot.data, 'base64'),
    );
  }
  throw error;
} finally {
  peer?.stop();
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
