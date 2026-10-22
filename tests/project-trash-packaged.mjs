import packageInfo from '../package.json' with { type: 'json' };
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-packaged-trash-'),
);
const profileId = randomUUID(),
  profile = path.join(
    process.env.APPDATA,
    'Game Canvas',
    'test-users',
    profileId,
  );
const game = path.join(root, 'game'),
  executable = path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe');
await fs.mkdir(game, { recursive: true });
await fs.mkdir(path.join(game, '.git'));
await fs.writeFile(path.join(game, '.git', 'all.bin'), 'unknown files');
await fs.writeFile(path.join(game, 'project.md'), '# 휴지통 패키지 검증');
await fs.mkdir(path.join(game, '.canvas'));
await fs.writeFile(
  path.join(game, '.canvas', 'project.json'),
  JSON.stringify({ name: '휴지통 패키지 검증' }),
);
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '휴지통 패키지 검증',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
const listener = net.createServer();
await new Promise((r) => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const child = spawn(
  executable,
  [
    `--game-canvas-test-profile=${profileId}`,
    `--remote-debugging-port=${port}`,
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let ws, server;
let diagnostic = '';
child.stderr.on(
  'data',
  (b) => (diagnostic = (diagnostic + b.toString()).slice(-4000)),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 160; i++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (r) => r.json(),
      );
      target = pages.find(
        (p) => p.type === 'page' && p.url.includes('index.html'),
      );
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(target, 'Packaged app did not load: ' + diagnostic);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let next = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
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
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await js(expression)) return;
      await sleep(80);
    }
    throw Error('Timeout: ' + expression);
  };
  const click = async (text) =>
    js(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button');if(b.disabled)throw Error('Disabled button');b.click()})()`,
    );
  const screenshot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      path.resolve('out/qa/' + name),
      Buffer.from(r.data, 'base64'),
    );
  };
  await wait('!!document.querySelector(".home-project-more")');
  assert.equal(
    await js('window.gameCanvas.getUpdateState().then(s=>s.currentVersion)'),
    packageInfo.version,
  );
  await js(
    '[...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.includes("다크 모드"))?.click()',
  );
  const menu = async () => {
    await js('document.querySelector(".home-project-more").click()');
    await wait('!!document.querySelector("[role=menu]")');
  };
  await menu();
  await click('휴지통으로 이동…');
  await wait(
    '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="휴지통으로 이동"&&!b.disabled)',
  );
  await screenshot('trash-confirm-dark.png');
  await click('취소');
  assert.ok(await fs.stat(game));
  const storageKey = 'game-canvas-gamejam-draft:local:' + game;
  await js(`localStorage.setItem(${JSON.stringify(storageKey)},'unsent task')`);
  await menu();
  await click('휴지통으로 이동…');
  await wait(
    '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="휴지통으로 이동"&&!b.disabled)',
  );
  await click('휴지통으로 이동');
  await wait(
    '!document.querySelector(".project-trash-modal") && !document.querySelector(".home-project-card")',
  );
  assert.equal(await fs.stat(game).catch(() => null), null);
  await js(
    '[...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.trim().startsWith("휴지통")).click()',
  );
  await wait('!!document.querySelector(".project-trash-list article")');
  await screenshot('trash-retained-dark.png');
  await click('복원');
  await wait('!document.querySelector(".project-trash-list article")');
  assert.equal(
    await fs.readFile(path.join(game, '.git', 'all.bin'), 'utf8'),
    'unknown files',
  );
  assert.equal(
    await js(`localStorage.getItem(${JSON.stringify(storageKey)})`),
    'unsent task',
  );
  await click('닫기');
  await menu();
  await click('휴지통으로 이동…');
  await wait(
    '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="휴지통으로 이동"&&!b.disabled)',
  );
  await click('휴지통으로 이동');
  await wait(
    '!document.querySelector(".project-trash-modal") && !document.querySelector(".home-project-card")',
  );
  await js(
    '[...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.trim().startsWith("휴지통")).click()',
  );
  await wait('!!document.querySelector(".project-trash-list article")');
  await click('지금 영구 삭제…');
  await js('document.querySelector(".project-trash-confirm input").focus()');
  await send('Input.insertText', { text: '휴지통 패키지 검증' });
  await js(
    'document.querySelector(".project-trash-confirm input[type=checkbox]").click()',
  );
  await click('영구 삭제');
  await wait('!document.querySelector(".project-trash-list article")');
  assert.equal(await fs.stat(game).catch(() => null), null);
  await click('닫기');
  console.log(
    'PASS packaged local UI: cancel, real whole-folder move, retained state, draft/hidden-file restoration, typed permanent purge',
  );
  server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    '',
    'owner',
    '팀 원본 삭제 검증',
    { 'project.md': '# server data' },
  );
  await js(
    `window.gameCanvas.recoverCollaboration(${JSON.stringify({ serverUrl: url, projectId: created.credentials.projectId, recoveryKey: created.credentials.recoveryKey })})`,
  );
  await js('window.gameCanvas.goHome()');
  await js('document.querySelector(".home-topbar button").click()');
  await wait('document.querySelectorAll(".home-project-more").length===1');
  await menu();
  await click('공동 프로젝트 삭제 — 팀 전체…');
  await wait('!!document.querySelector(".project-trash-modal input")');
  await js('document.querySelector(".project-trash-modal input").focus()');
  await send('Input.insertText', { text: '팀 원본 삭제 검증' });
  await js(
    'document.querySelector(".project-trash-modal input[type=checkbox]").click()',
  );
  await wait(
    '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="팀 프로젝트 휴지통으로 이동"&&!b.disabled)',
  );
  await screenshot('trash-team-confirm.png');
  await click('팀 프로젝트 휴지통으로 이동');
  await wait('!document.querySelector(".project-trash-modal")');
  await js(
    '[...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.trim().startsWith("휴지통")).click()',
  );
  await wait(
    '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="팀 프로젝트 복원"&&!b.disabled)',
  );
  await screenshot('trash-server-retained.png');
  await click('팀 프로젝트 복원');
  await wait(
    '![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="팀 프로젝트 복원")',
  );
  const lifecycle = await js(
    `window.gameCanvas.getSharedProjectLifecycle(${JSON.stringify('shared:' + created.credentials.projectId)})`,
  );
  assert.equal(lifecycle.status, 'active');
  await click('닫기');
  console.log(
    'PASS packaged team UI: administrator recovery, typed team confirmation, server original retention, team access blocked and administrator restoration',
  );
  await menu();
  await click('이 PC의 사본을 휴지통으로 이동…');
  await wait(
    '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="휴지통으로 이동"&&!b.disabled)',
  );
  await click('휴지통으로 이동');
  await wait(
    '!document.querySelector(".project-trash-modal") && !document.querySelector(".home-project-card")',
  );
  const onServer = await fs.stat(
    path.join(root, 'server', created.credentials.projectId),
  );
  assert.ok(onServer.isDirectory());
  await js(
    '[...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.trim().startsWith("휴지통")).click()',
  );
  await wait(
    '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="복원"&&!b.disabled)',
  );
  await click('복원');
  await wait('!document.querySelector(".project-trash-list article")');
  await click('닫기');
  console.log(
    'PASS packaged shared local copy UI: cache and credentials restore while server original remains intact',
  );

  await js(
    '[...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.includes("라이트 모드"))?.click()',
  );
  await js(
    '[...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.trim().startsWith("휴지통")).click()',
  );
  await wait('!!document.querySelector(".project-trash-modal")');
  await screenshot('trash-light.png');
} finally {
  ws?.close();
  child.kill();
  await new Promise((r) => {
    if (child.exitCode !== null) r();
    else child.once('exit', r);
  });
  await server?.close();
  // Both targets are exact paths created for this test; verify containment before cleanup.
  assert.ok(
    profile.startsWith(
      path.join(process.env.APPDATA, 'Game Canvas', 'test-users') + path.sep,
    ),
  );
  assert.ok(root.startsWith(os.tmpdir() + path.sep));
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
