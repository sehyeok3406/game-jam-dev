import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-new-file-packaged-'),
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
await fs.writeFile(path.join(game, 'project.md'), '# 새 항목 선택 검사\n');
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '새 항목 선택 검사',
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
const fixtureDocument = (id, title, x) =>
  `---\nid: ${id}\ntitle: ${title}\ntype: idea\nstatus: draft\nx: ${x}\ny: 120\nwidth: 300\nheight: 240\n---\n# ${title}\n선택 강조 검증\n`;
await fs.writeFile(
  path.join(game, 'project.md'),
  fixtureDocument('glow-a', '첫 번째 문서', 100),
);
await fs.mkdir(path.join(game, 'ideas'), { recursive: true });
await fs.writeFile(
  path.join(game, 'ideas/b.md'),
  fixtureDocument('glow-b', '두 번째 문서', 460),
);
await fs.writeFile(
  path.join(game, 'ideas/c.md'),
  fixtureDocument('glow-c', '세 번째 문서', 820),
);
await fs.mkdir(path.join(game, 'output'), { recursive: true });
await fs.writeFile(
  path.join(game, 'output/index.html'),
  '<!doctype html><html><head><title>선택 HTML</title></head><body>HTML 선택 확인</body></html>',
);
await fs.mkdir(path.join(game, '.canvas'), { recursive: true });
await fs.writeFile(
  path.join(game, '.canvas/preview.json'),
  JSON.stringify({ x: 100, y: 450, width: 720, height: 300, collapsed: false }),
);
const openProject = async () => {
  await wait('!!window.gameCanvas');
  await js('document.querySelector(".home-project-open")?.click()');
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===3',
  );
};
const reload = async () => {
  await send('Page.reload');
  for (let i = 0; i < 5; i++) await pause();
  await openProject();
};
const capture = async (name) => {
  await fs.mkdir('out/new-file-selection-packaged', { recursive: true });
  const shot = await send('Page.captureScreenshot');
  await fs.writeFile(
    `out/new-file-selection-packaged/${name}.png`,
    Buffer.from(shot.data, 'base64'),
  );
};
try {
  await boot();
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===3',
  );
  await js(
    `(async()=>{const w=await window.gameCanvas.getWorkspace(),docs=await window.gameCanvas.listDocuments(),previews=await window.gameCanvas.listPreviews();const ids=[...docs.filter(d=>d.type!=='ai-task').map(d=>d.id),...previews.map(p=>'preview:'+p.relativePath)];localStorage.setItem('game-canvas-new-files:'+w.root,JSON.stringify({known:ids,unread:ids}));})()`,
  );
  await reload();
  await wait('document.querySelectorAll(".new-file-node").length===4');
  await js(
    `document.querySelector('button[title^="캔버스 전체 보기"]').click()`,
  );
  for (let i = 0; i < 5; i++) await pause();
  const box = await js(
    `(()=>{const r=[...document.querySelectorAll('.react-flow__node-document')].slice(0,2).map(n=>n.getBoundingClientRect());return {left:Math.min(...r.map(n=>n.left))-10,top:Math.min(...r.map(n=>n.top))-10,right:Math.max(...r.map(n=>n.right))+10,bottom:Math.max(...r.map(n=>n.bottom))+10}})()`,
  );
  assert.equal(
    await js(
      `document.elementFromPoint(${box.left},${box.top})?.classList.contains('react-flow__pane')`,
    ),
    true,
  );
  await mouse('mousePressed', box.left, box.top);
  for (let i = 1; i <= 8; i++)
    await mouse(
      'mouseMoved',
      box.left + ((box.right - box.left) * i) / 8,
      box.top + ((box.bottom - box.top) * i) / 8,
    );
  await mouse('mouseReleased', box.right, box.bottom);
  await wait(
    'document.querySelectorAll(".react-flow__node-document.selected").length===2',
  );
  await wait(
    'document.querySelectorAll(".react-flow__node-document.new-file-node").length===1',
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".react-flow__node-preview.new-file-node").length',
    ),
    1,
  );
  await key('a', 'KeyA', 65, 2);
  await wait(
    'document.querySelectorAll(".react-flow__node-document.selected").length===3',
  );
  await wait(
    'document.querySelectorAll(".react-flow__node-document.new-file-node").length===0',
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".react-flow__node-preview.new-file-node").length',
    ),
    1,
  );
  await js('document.querySelector(".react-flow__node-preview").focus()');
  await key('Enter', 'Enter', 13);
  await wait('!!document.querySelector(".react-flow__node-preview.selected")');
  await wait('document.querySelectorAll(".new-file-node").length===0');
  const unread = await js(
    `(async()=>{const w=await window.gameCanvas.getWorkspace();return JSON.parse(localStorage.getItem('game-canvas-new-files:'+w.root)).unread})()`,
  );
  assert.deepEqual(unread, []);
  await capture('acknowledged');
  await reload();
  assert.equal(
    await js('document.querySelectorAll(".new-file-node").length'),
    0,
  );
  await stop(true);
  await boot();
  await wait(
    'document.querySelectorAll(".react-flow__node-document").length===3',
  );
  assert.equal(
    await js('document.querySelectorAll(".new-file-node").length'),
    0,
  );
  console.log(
    'PASS: Windows package acknowledges marquee/Ctrl+A document selection and keyboard HTML selection, preserves untouched unread items and retains acknowledgement after renderer reload and full process restart.',
  );
} catch (error) {
  if (js) await capture('failure').catch(() => {});
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
