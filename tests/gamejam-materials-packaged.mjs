import { verifyMaterials } from './gamejam-materials.scenario.mjs';
import { sourceMetadata, htmlSourcePath } from '../src/html-source.ts';
import matter from 'gray-matter';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const packageDir = path.resolve(
  process.env.GAMEJAM_PACKAGE_DIR ?? 'out/Game Jam!-win32-x64',
);
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-materials-package-'),
);
const profileRoot = path.resolve(
  process.env.APPDATA,
  'Game Canvas',
  'test-users',
);
const profileId = randomUUID();
const profile = path.join(profileRoot, profileId);
const server = net.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(temp, 'project.md'),
  '---\nid: chrome-test\ntitle: UI 패키지 검증\ntype: idea\nstatus: draft\n---\n# 캔버스 UI 검증\n',
);
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + temp.toLowerCase(),
      root: temp,
      name: 'UI 패키지 검증',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);

await fs.mkdir(path.join(temp, '.canvas'), { recursive: true });
await fs.writeFile(
  path.join(temp, '.canvas/canvases.json'),
  JSON.stringify({
    version: 1,
    canvases: [
      { id: 'default', name: '기본 캔버스' },
      { id: 'materials-a', name: '재료 A' },
      { id: 'materials-b', name: '결과 B' },
    ],
  }),
);
await fs.mkdir(path.join(temp, 'ideas'), { recursive: true });
for (const [id, title, canvas_id, x, y] of [
  ['material-a', '직접 쓴 기획', 'materials-a', 120, 120],
  ['material-b', 'AI가 정리한 문서', 'materials-a', 820, 120],
  ['material-c', '아래쪽 자료', 'materials-a', 120, 850],
  ['material-d', '다른 캔버스 자료', 'materials-b', 120, 120],
]) {
  await fs.writeFile(
    path.join(temp, 'ideas/' + id + '.md'),
    matter.stringify('# ' + title, {
      id,
      title,
      canvas_id,
      type: 'idea',
      status: 'raw',
      sources: [],
      x,
      y,
      width: 340,
      height: 300,
    }),
  );
}
const html =
  '<!doctype html><html><head><title>캔버스 게임 이름</title></head><body><h1>캔버스 게임 이름</h1><button>플레이</button></body></html>';
await fs.mkdir(path.join(temp, 'output'), { recursive: true });
await fs.writeFile(path.join(temp, 'output/index.html'), html);
const record = matter(
  sourceMetadata('output/index.html', html, {
    title: '캔버스 게임 이름',
    x: 1520,
    y: 120,
  }),
);
record.data.canvas_id = 'materials-a';
const recordPath = path.join(temp, htmlSourcePath('output/index.html'));
await fs.mkdir(path.dirname(recordPath), { recursive: true });
await fs.writeFile(recordPath, matter.stringify(record.content, record.data));

const child = spawn(
  path.join(packageDir, 'Game Canvas.exe'),
  [
    `--game-canvas-test-profile=${profileId}`,
    `--remote-debugging-port=${port}`,
  ],
  { windowsHide: true, stdio: 'ignore' },
);
const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let n = 0; n < 200; n++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      ).find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (target) break;
    } catch {}
    await pause();
  }
  assert.ok(target, 'Packaged renderer did not load');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const requests = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data)),
      p = requests.get(m.id);
    if (p) {
      requests.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      requests.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params }));
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
    for (let n = 0; n < 200; n++) {
      if (await js(expression)) return;
      await pause();
    }
    console.error(
      await js(
        "JSON.stringify({body:document.body.innerText.slice(-3000),nodes:[...document.querySelectorAll('.react-flow__node')].map(e=>({id:e.dataset.id,selected:e.className,rect:e.getBoundingClientRect().toJSON()}))})",
      ),
    );
    const shot = await send('Page.captureScreenshot');
    await fs.mkdir('out/gamejam-materials-packaged', { recursive: true });
    await fs.writeFile(
      'out/gamejam-materials-packaged/failure.png',
      Buffer.from(shot.data, 'base64'),
    );
    throw Error('Packaged timeout: ' + expression);
  };
  await fs.mkdir('out/gamejam-materials-packaged', { recursive: true });
  const capture = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `out/gamejam-materials-packaged/${name}.png`,
      Buffer.from(result.data, 'base64'),
    );
  };

  const key = async (event) => {
    const virtual = {
      KeyD: 68,
      KeyA: 65,
      KeyS: 83,
      KeyW: 87,
      Space: 32,
      Delete: 46,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
    }[event.code];
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      code: event.code,
      key: event.key,
      windowsVirtualKeyCode: virtual,
      modifiers: event.shiftKey ? 8 : 0,
      autoRepeat: event.repeat ?? false,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code: event.code,
      key: event.key,
      windowsVirtualKeyCode: virtual,
    });
    await pause(60);
  };
  const mouse = async (type, a, b) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      buttons: 1,
      ...a,
      button: 'left',
      clickCount: 1,
    });
    if (type === 'drag')
      for (let i = 1; i <= 12; i++) {
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: a.x + ((b.x - a.x) * i) / 12,
          y: a.y + ((b.y - a.y) * i) / 12,
          button: 'left',
          buttons: 1,
        });
        await pause(20);
      }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      buttons: 0,
      ...(b ?? a),
      button: 'left',
      clickCount: 1,
    });
    await pause(100);
  };
  await verifyMaterials({ js, key, mouse, wait, capture });
} finally {
  ws?.close();
  if (child.exitCode === null) {
    const done = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await done;
  }
  assert.equal(path.dirname(profile), profileRoot);
  assert.ok(
    path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
