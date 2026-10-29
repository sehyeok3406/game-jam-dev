import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-text-packaged-'));
const profile = path.join(root, 'profile'),
  game = path.join(root, 'game');
await fs.mkdir(game, { recursive: true });
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(path.join(game, 'project.md'), '# 텍스트 패키지 검사\n');
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '텍스트 패키지 검사',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
let child, socket, send, js;
const pause = () => new Promise((r) => setTimeout(r, 100));
const wait = async (expression) => {
  for (let i = 0; i < 200; i++) {
    if (await js(expression)) return;
    await pause();
  }
  throw Error('Timed out: ' + expression);
};
async function boot() {
  const reserve = net.createServer();
  await new Promise((r) => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  child = spawn(
    path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
    [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`],
    {
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, LOCALAPPDATA: path.join(root, 'local-app-data') },
    },
  );
  let target;
  for (let i = 0; i < 200; i++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      ).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (target) break;
    } catch {}
    await pause();
  }
  assert.ok(target, 'Package did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    socket.addEventListener('open', r, { once: true });
    socket.addEventListener('error', j, { once: true });
  });
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data)),
      item = pending.get(m.id);
    if (item) {
      pending.delete(m.id);
      if (m.error) item.reject(Error(JSON.stringify(m.error)));
      else item.resolve(m.result);
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  js = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  await wait(
    '!!window.gameCanvas?.selfHost && !!document.querySelector(".home-project-open")',
  );
}
async function stop(graceful = false) {
  if (graceful && child?.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    void js('window.close()').catch(() => {});
    let timeout;
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(Error('Package failed to close')),
            12000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
  socket?.close();
  socket = null;
  if (child?.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  await pause();
}
const key = async (key, code, windowsVirtualKeyCode) => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode,
    });
  await pause();
};
const screenshot = async (name) => {
  const shot = await send('Page.captureScreenshot');
  await fs.mkdir('out/text-packaged', { recursive: true });
  await fs.writeFile(
    `out/text-packaged/${name}.png`,
    Buffer.from(shot.data, 'base64'),
  );
};
const enterProject = async () => {
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(game)})`,
  );
  await wait('!!document.querySelector(".bottom-toolbar")');
};
try {
  await boot();
  const initial = await js('window.gameCanvas.selfHost.getSelfHost()');
  assert.equal(initial.autoStart, false);
  assert.ok(
    initial.dataDirectory.startsWith(
      path.join(root, 'local-app-data') + path.sep,
    ),
  );
  await enterProject();
  await key('t', 'KeyT', 84);
  const point = await js(
    `(()=>{for(let y=250;y<700;y+=100)for(let x=500;x<1100;x+=100)if(document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'))return {x,y};throw Error('No empty canvas point')})()`,
  );
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    });
  await wait(
    'document.activeElement?.getAttribute("aria-label")==="캔버스 텍스트 내용"',
  );
  await send('Input.insertText', { text: '패키지 한글 텍스트' });
  await key('Enter', 'Enter', 13);
  await js(
    `document.querySelector('.canvas-text-toolbar [aria-label="글머리 기호 목록"]').click()`,
  );
  await send('Input.insertText', { text: '글머리 첫 항목' });
  await key('Enter', 'Enter', 13);
  await key('Enter', 'Enter', 13);
  await js(
    `document.querySelector('.canvas-text-toolbar [aria-label="번호 목록"]').click()`,
  );
  await send('Input.insertText', { text: '번호 첫 항목' });
  await key('Enter', 'Enter', 13);
  await send('Input.insertText', { text: '번호 둘째 항목' });
  const selectLine = async (selector) => {
    await js(
      `(()=>{const p=document.querySelector(${JSON.stringify(selector)}),range=document.createRange();p.closest('.tiptap').focus();range.selectNodeContents(p);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`,
    );
    await pause();
  };
  const alignLine = async (selector, label) => {
    await selectLine(selector);
    const point = await js(
      `(()=>{const r=document.querySelector('.canvas-text-toolbar [aria-label=${JSON.stringify(label)}]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1,
      });
    await pause();
  };
  await alignLine('.canvas-text-node ul > li > p', '가운데 정렬');
  await alignLine('.canvas-text-node ol > li:last-child > p', '오른쪽 정렬');
  await key('Escape', 'Escape', 27);
  await wait(
    'window.gameCanvas.listDrawings().then(o=>o[0]?.geometry.document.includes("번호 둘째 항목"))',
  );
  await wait(
    'window.gameCanvas.listDrawings().then(o=>JSON.parse(o[0].geometry.document).content[2].content[1].content[0].attrs?.textAlign==="right")',
  );
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector(".canvas-text-node ul > li")).textAlign',
    ),
    'center',
  );
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector(".canvas-text-node ol > li:last-child")).textAlign',
    ),
    'right',
  );
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector(".canvas-text-node ol > li:first-child")).textAlign',
    ),
    'left',
  );
  const expected = await js(
    'window.gameCanvas.listDrawings().then(o=>o[0].geometry)',
  );
  const disk = JSON.parse(
    await fs.readFile(path.join(game, '.canvas/drawings/default.json'), 'utf8'),
  );
  assert.equal(disk.version, 3);
  assert.deepEqual(disk.objects[0].geometry, expected);
  await screenshot('lists');
  await js('window.gameCanvas.selfHost.setSelfHostAutoStart(true)');
  await stop(true);
  await boot();
  await wait('!!document.querySelector(".self-host-dialog[open]")');
  await wait(
    'document.querySelector(".self-host-auto-start-setting input")?.checked===true',
  );
  await wait('!!document.querySelector(".self-host-status")?.dataset.stage');
  await wait('!document.querySelector(".self-host-spinner")');
  assert.equal(
    await js(
      'document.querySelector(".self-host-auto-start-setting input").checked',
    ),
    true,
  );
  await screenshot('auto-start-management');
  await js('window.gameCanvas.selfHost.setSelfHostAutoStart(false)');
  await js(`document.querySelector('[aria-label="서버 관리 닫기"]').click()`);
  await enterProject();
  await wait('!!document.querySelector(".canvas-text-node")');
  assert.deepEqual(
    await js('window.gameCanvas.listDrawings().then(o=>o[0].geometry)'),
    expected,
  );
  assert.equal(
    await js('document.querySelectorAll(".canvas-text-node ol > li").length'),
    2,
  );
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector(".canvas-text-node ul > li")).textAlign',
    ),
    'center',
  );
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector(".canvas-text-node ol > li:last-child")).textAlign',
    ),
    'right',
  );
  await screenshot('alignment-reopened');
  await stop(true);
  await boot();
  assert.equal(
    await js('!!document.querySelector(".self-host-dialog[open]")'),
    false,
  );
  assert.equal(
    (await js('window.gameCanvas.selfHost.getSelfHost()')).autoStart,
    false,
  );
  await stop(true);
  await fs.writeFile(
    'out/text-packaged/report.json',
    JSON.stringify(
      {
        passed: true,
        nativeKoreanInput: true,
        bulletsAndNumbering: true,
        independentParagraphAlignment: true,
        markerAlignment: true,
        diskPersistence: true,
        fullRestart: true,
        autoStartOnOpensManagement: true,
        autoStartOffStaysClosed: true,
        isolatedHostData: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Windows package verifies text/lists on disk and across process restarts; auto-start On opens management and Off stays closed with isolated host data.',
  );
} catch (error) {
  if (socket) await screenshot('failure').catch(() => {});
  throw error;
} finally {
  await stop();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('gamejam-text-packaged-'));
  await fs.rm(root, { recursive: true, force: true });
}
