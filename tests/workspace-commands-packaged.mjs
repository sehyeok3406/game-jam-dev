import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-workspace-commands-packaged-'),
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
const button = (text) =>
  `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)}))`;
async function clickText(text) {
  await js(`{const button=${button(text)}; button.focus();button.click();}`);
}
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
}
const original = await fs.readFile(path.join(game, 'project.md'), 'utf8');
try {
  await fs.mkdir(path.join(game, 'output'), { recursive: true });
  const html =
    '<!doctype html><html><head><title>R05 native result</title></head><body>original HTML</body></html>';
  await fs.writeFile(path.join(game, 'output', 'index.html'), html);
  await boot();
  await js('document.querySelector(".home-project-open").click()');
  await wait('!!document.querySelector(".canvas-main-menu")');
  const doc = await js(
    '(async()=>{const d=await window.gameCanvas.createIdea({x:80,y:100});return await window.gameCanvas.saveDocument({relativePath:d.relativePath,objectId:d.id,title:"R05 원본",body:"원래 한글 내용",expectedTitle:d.title,expectedBody:d.body,revision:d.revision});})()',
  );
  const relative = JSON.stringify(doc.relativePath),
    id = JSON.stringify(doc.id);
  await wait(
    '!!document.querySelector(' +
      JSON.stringify('[data-id="' + doc.id + '"]') +
      ')',
  );
  await js(
    '(async()=>{const s=await window.gameCanvas.getCanvasSheets();await window.gameCanvas.changeCanvasSheets({action:"add",id:"r05-target",name:"R05 이동 대상",expected:s.raw??null});})()',
  );
  await wait(
    'Array.from(document.querySelectorAll("[role=tab]")).some(e=>e.textContent.includes("R05 이동 대상"))',
  );
  await js(
    'document.querySelector(' +
      JSON.stringify('[data-id="' + doc.id + '"]') +
      ').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:280,clientY:180,button:2}))',
  );
  await wait('!!document.querySelector("[data-ui-id=document-menu]")');
  await clickText('다른 캔버스로 이동');
  await wait('!!document.querySelector("[data-ui-id=canvas-move]")');
  const beforeMove = (await js('window.gameCanvas.listHistory()')).length;
  await js(
    '{const b=document.querySelector("[data-ui-id=canvas-move] .button-primary");b.click();b.click();}',
  );
  await wait('!document.querySelector("[data-ui-id=canvas-move]")');
  await wait(
    '(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.id===' +
      id +
      ');return d?.canvasId==="r05-target";})()',
  );
  assert.equal(
    (await js('window.gameCanvas.listHistory()')).length,
    beforeMove + 1,
  );
  await js(
    'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("R05 이동 대상")).click()',
  );
  await wait(
    '!!document.querySelector(' +
      JSON.stringify('[data-id="' + doc.id + '"]') +
      ')',
  );
  await key('z', 'KeyZ', 90, 2);
  await wait(
    '(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.id===' +
      id +
      ');return (d?.canvasId??"default")==="default";})()',
  );
  await key('z', 'KeyZ', 90, 10);
  await wait(
    '(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.id===' +
      id +
      ');return d?.canvasId==="r05-target";})()',
  );
  console.log(
    'PASS: package canvas move confirmation handles a duplicate click once, preserves file path/content and supports Undo/Redo',
  );
  await js(`{
    document.querySelector('.canvas-main-menu > summary').click();
    [...document.querySelectorAll('.canvas-main-menu button')].find(b=>b.textContent.includes('프로젝트 히스토리')).click();
  }`);
  await wait(
    'Array.from(document.querySelectorAll(".history-entry button")).some(b=>b.textContent.includes(' +
      relative +
      '))',
  );
  await js(
    'Array.from(document.querySelectorAll(".history-entry button")).find(b=>b.textContent.includes(' +
      relative +
      ')).click()',
  );
  await wait('!!document.querySelector(".history-preview pre")');
  await js(
    'Array.from(document.querySelectorAll(".history-preview button")).find(b=>b.textContent.includes("변경 전")).click()',
  );
  await wait(
    'document.querySelector(".history-preview small").textContent.includes("변경 전")',
  );
  await js(
    'Array.from(document.querySelectorAll(".history-preview button")).find(b=>b.textContent.includes("이 파일 버전 복원")).click()',
  );
  await wait('!!document.querySelector("[data-ui-id=history-confirm]")');
  const beforeRestore = (await js('window.gameCanvas.listHistory()')).length;
  await js(
    '{const b=document.querySelector("[data-ui-id=history-confirm] .button-primary");b.click();b.click();}',
  );
  await wait('!document.querySelector("[data-ui-id=history-confirm]")');
  assert.equal(
    (await js('window.gameCanvas.listHistory()')).length,
    beforeRestore + 1,
  );
  assert.equal(
    (await js('window.gameCanvas.listDocuments()')).find((d) => d.id === doc.id)
      .body,
    '원래 한글 내용',
  );
  await js('document.querySelector("[title=\\"히스토리 닫기\\"]").click()');
  console.log(
    'PASS: package history list/file before/after and restore confirmation preserve content and one restore record for duplicate clicks',
  );
  await js(
    'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("기본 캔버스")).click()',
  );
  await wait('!!document.querySelector(".react-flow__node-preview")');
  await js(
    'document.querySelector(".react-flow__node-preview").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:300,clientY:180,button:2}))',
  );
  await wait('!!document.querySelector("[data-ui-id=preview-menu]")');
  await clickText('폴더 분류·이동');
  await wait('!!document.querySelector("[aria-label=\\"결과물 폴더 정리\\"]")');
  await js(
    '{const e=document.querySelector("[aria-label=\\"결과물 기능 이름\\"]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"r05-moved");e.dispatchEvent(new Event("input",{bubbles:true}));}',
  );
  await wait(
    '!!Array.from(document.querySelectorAll(".import-dialog-actions button")).find(b=>b.textContent.includes("이 폴더로 이동")&&!b.disabled)',
  );
  await clickText('이 폴더로 이동');
  await wait('!document.querySelector("[aria-label=\\"결과물 폴더 정리\\"]")');
  const moved = await js('window.gameCanvas.listPreviews()');
  const result = moved.find((p) => p.relativePath.includes('/r05-moved/'));
  assert.ok(result);
  assert.equal(
    await fs.readFile(path.join(game, result.relativePath), 'utf8'),
    html,
  );
  assert.equal(
    await fs.readFile(path.join(game, 'project.md'), 'utf8'),
    original,
  );
  console.log(
    'PASS: package result-folder dialog moves original HTML with fresh revision and keeps project Markdown bytes',
  );
  await stop(true);
  await boot();
  assert.equal(
    (await js('window.gameCanvas.listDocuments()')).find((d) => d.id === doc.id)
      .body,
    '원래 한글 내용',
  );
  assert.ok(
    (await js('window.gameCanvas.listPreviews()')).some(
      (p) => p.relativePath === result.relativePath,
    ),
  );
  assert.equal(
    await fs.readFile(path.join(game, 'project.md'), 'utf8'),
    original,
  );
  console.log(
    'PASS: complete Windows process restart preserves moved files, restored document and history',
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
