import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-eraser-packaged-'),
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
await fs.writeFile(path.join(game, 'project.md'), '# 지우개 패키지 검사\n');
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '지우개 패키지 검사',
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
  await js('document.querySelector(".home-project-open")?.click()');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(game)})`,
  );
  await wait('!!document.querySelector("[data-plugin-launcher]")');
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
const mouse = async (type, x, y) => {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  await pause();
};
const key = async (key, code, virtual, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode: virtual,
      modifiers,
    });
  await pause();
};
const screen = (x, y) =>
  js(
    `(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform),p=new DOMPoint(${x},${y}).matrixTransform(m),r=document.querySelector('.react-flow').getBoundingClientRect();return {x:p.x+r.x,y:p.y+r.y}})()`,
  );
const clickInk = async (x, y, hold = false) => {
  const p = await screen(x, y);
  await mouse('mouseMoved', p.x, p.y);
  await mouse('mousePressed', p.x, p.y);
  if (!hold) await mouse('mouseReleased', p.x, p.y);
  return p;
};
const clickEraser = () =>
  js('document.querySelector("[data-ui-id=drawing-eraser] > button").click()');
const screenshot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await fs.mkdir('out/drawing-packaged', { recursive: true });
  await fs.writeFile(
    `out/drawing-packaged/${name}.png`,
    Buffer.from(r.data, 'base64'),
  );
};
try {
  await boot();
  await js(
    'Array.from(document.querySelectorAll("button")).find(b=>b.title.startsWith("펜 (")).click()',
  );
  await mouse('mousePressed', 300, 400);
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', 300 + i * 50, 400);
  await mouse('mouseReleased', 700, 400);
  await wait('window.gameCanvas.listDrawings().then(o=>o.length===1)');
  let original = await js('window.gameCanvas.listDrawings().then(o=>o[0])');
  await js(
    `(async()=>{const scope=(await window.gameCanvas.getWorkspace()).saveScope;await window.gameCanvas.applyDrawingCommand({scope,canvasId:'default',action:'patch',patches:[{id:${JSON.stringify(original.id)},generation:${JSON.stringify(original.generation)},style:{strokeWidth:80},transform:{x:300,y:400,width:400,height:1,rotation:0},expectedGeometry:${JSON.stringify(original.geometry)},geometry:{brush:'pen',sourceWidth:400,sourceHeight:1,points:[[0,0,0.5],[400,0,0.5]],pressureEnabled:false,rendererVersion:1}}]}); await window.gameCanvas.createIdea({x:250,y:350,width:500,height:200});})()`,
  );
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===2',
  );
  await wait(
    'document.querySelector(".drawing-node path")?.getBBox().height > 40',
  );
  original = await js('window.gameCanvas.listDrawings().then(o=>o[0])');
  await clickEraser();
  await wait('!!document.querySelector(".drawing-eraser-menu__popup")');
  await js(
    'document.querySelector("input[value=partial]").click();document.querySelector(".drawing-eraser-menu__size input").focus()',
  );
  await key('ArrowRight', 'ArrowRight', 39);
  await key('ArrowRight', 'ArrowRight', 39);
  assert.equal(
    await js(
      'document.querySelector(".drawing-eraser-menu__size input").value',
    ),
    '26',
  );
  await screenshot('popup');
  // First outside click only dismisses the popup.
  await clickInk(500, 400);
  assert.equal(
    await js(
      'window.gameCanvas.listDrawings().then(o=>!!o[0].geometry.erasures)',
    ),
    false,
  );
  const hole = await clickInk(500, 400, true);
  await wait('!!document.querySelector(".drawing-node clipPath")');
  assert.equal(
    await js(
      'window.gameCanvas.listDrawings().then(o=>!!o[0].geometry.erasures)',
    ),
    false,
    'live preview is not persisted',
  );
  await screenshot('partial-preview');
  await mouse('mouseReleased', hole.x, hole.y);
  await wait(
    'window.gameCanvas.listDrawings().then(o=>o[0]?.geometry.erasures?.length===1)',
  );
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(game, '.canvas/drawings/default.json'),
        'utf8',
      ),
    ).version,
    2,
  );
  // A hole must pass pointer input through to the real card beneath the stroke.
  await key('Escape', 'Escape', 27);
  const center = await screen(500, 400);
  assert.ok(
    await js(
      `!!document.elementFromPoint(${center.x},${center.y})?.closest('.document-card')`,
    ),
    'hole passes through to the card',
  );
  await mouse('mousePressed', center.x, center.y);
  await mouse('mouseReleased', center.x, center.y);
  await wait('!!document.querySelector(".react-flow__node-document.selected")');
  await js('document.activeElement?.blur()');
  await key('z', 'KeyZ', 90, 2);
  await wait(
    'window.gameCanvas.listDrawings().then(o=>!o[0].geometry.erasures?.length)',
  );
  await key('z', 'KeyZ', 90, 10);
  await wait(
    'window.gameCanvas.listDrawings().then(o=>o[0].geometry.erasures?.length===1)',
  );
  await clickEraser();
  await js('document.querySelector("input[value=stroke]").click()');
  await key('Escape', 'Escape', 27);
  const hit = await clickInk(350, 400, true);
  await wait('!!document.querySelector("[data-erase-pending=true]")');
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector("[data-erase-pending=true]")).opacity',
    ),
    '0.3',
  );
  assert.equal(
    await js('window.gameCanvas.listDrawings().then(o=>o.length)'),
    1,
  );
  await screenshot('stroke-preview');
  await key('Escape', 'Escape', 27);
  await mouse('mouseReleased', hit.x, hit.y);
  assert.equal(
    await js('window.gameCanvas.listDrawings().then(o=>o.length)'),
    1,
  );
  await clickInk(350, 400);
  await wait('window.gameCanvas.listDrawings().then(o=>o.length===0)');
  await key('z', 'KeyZ', 90, 2);
  await wait(
    'window.gameCanvas.listDrawings().then(o=>o[0]?.geometry.erasures?.length===1)',
  );
  await clickEraser();
  await js('document.querySelector("input[value=partial]").click()');
  await key('Escape', 'Escape', 27);
  const saved = await js('window.gameCanvas.listDrawings().then(o=>o[0])');
  assert.deepEqual(saved.geometry.points, original.geometry.points);
  await stop(true);
  await boot();
  await wait(
    'window.gameCanvas.listDrawings().then(o=>o[0]?.geometry.erasures?.length===1)',
  );
  assert.deepEqual(
    await js('window.gameCanvas.listDrawings().then(o=>o[0].geometry)'),
    saved.geometry,
  );
  await clickEraser();
  assert.equal(
    await js('document.querySelector("input[value=partial]").checked'),
    true,
  );
  assert.equal(
    await js(
      'document.querySelector(".drawing-eraser-menu__size input").value',
    ),
    '26',
  );
  await screenshot('reopened');
  await fs.writeFile(
    'out/drawing-packaged/report.json',
    JSON.stringify(
      {
        passed: true,
        version: '0.27.0',
        productionIpc: true,
        nativePointerInput: true,
        strokePreviewAndCancel: true,
        partialHoleHitThrough: true,
        undoRedo: true,
        fullProcessRestart: true,
        personalSettings: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Windows package verifies eraser popup/size, pending opacity/cancel, partial hole click-through, atomic Undo/Redo, v2 disk persistence and settings after full restart.',
  );
} catch (error) {
  if (js) {
    console.log(
      await js(
        '(async()=>({drawings:JSON.stringify(await window.gameCanvas.listDrawings()),nodes:[...document.querySelectorAll(".drawing-node")].map(e=>e.outerHTML.slice(0,500)),body:document.body.innerText.slice(-800),viewport:document.querySelector(".react-flow__viewport")?.style.transform,input:document.querySelector(".drawing-input-layer")?.outerHTML.slice(0,250)}))()',
      ),
    );
    await screenshot('failure');
  }
  throw error;
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
