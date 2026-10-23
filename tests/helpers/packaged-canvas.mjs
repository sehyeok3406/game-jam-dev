import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-resize-packaged-'),
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
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

export { root, profile, game, boot, stop, wait, js, send, mouse, key, pause };
