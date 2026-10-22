import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import electron from 'electron';

const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-clipboard-packaged-'),
);
const profileId = randomUUID();
const profile = path.join(
  process.env.APPDATA,
  'Game Canvas',
  'test-users',
  profileId,
);
const game = path.join(root, 'game');
await fs.mkdir(game, { recursive: true });
await fs.writeFile(
  path.join(game, 'project.md'),
  '---\nid: project\ntitle: clipboard test\ntype: idea\nx: 80\ny: 80\nwidth: 360\nheight: 320\n---\n# test',
);
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '이미지 붙여넣기 검증',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
const port = async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const result = server.address().port;
  await new Promise((r) => server.close(r));
  return result;
};
let debugPort = await port();
const clipboardPort = await port(),
  token = randomUUID();
const helper = spawn(electron, ['tests/clipboard-helper.electron.mjs'], {
  windowsHide: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    QA_CLIPBOARD_PORT: String(clipboardPort),
    QA_CLIPBOARD_TOKEN: token,
  },
});
let diagnostic = '';
const startApp = () => {
  const appProcess = spawn(
    path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${debugPort}`,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  appProcess.stderr.on('data', (data) => {
    diagnostic = (diagnostic + data.toString()).slice(-3000);
  });
  return appProcess;
};
let child = startApp();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeClipboard = async (operation) => {
  const r = await fetch(`http://127.0.0.1:${clipboardPort}/${operation}`, {
    headers: { 'x-test-token': token },
  });
  assert.equal(r.ok, true, await r.text());
};
let ws;
try {
  let helperReady = false;
  for (let i = 0; i < 100; i++) {
    try {
      await writeClipboard('ready');
      helperReady = true;
      break;
    } catch {
      if (helper.exitCode !== null)
        throw Error(`Clipboard helper exited: ${helper.exitCode}`);
      await sleep(100);
    }
  }
  assert.ok(helperReady, 'Clipboard helper must be ready');
  let target;
  for (let i = 0; i < 160; i++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(
        (r) => r.json(),
      );
      target = pages.find(
        (p) => p.type === 'page' && p.url.includes('index.html'),
      );
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(target, 'Packaged window must load');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const onMessage = ({ data }) => {
    const message = JSON.parse(String(data));
    const item = pending.get(message.id);
    if (item) {
      pending.delete(message.id);
      if (message.error) item.reject(Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    }
  };
  ws.addEventListener('message', onMessage);
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params }));
    });
  const js = async (expression) => {
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
  const wait = async (expression) => {
    for (let i = 0; i < 160; i++) {
      if (await js(expression)) return;
      await sleep(75);
    }
    const state = await js(`(async () => JSON.stringify({
      notice: document.querySelector('.status-toast')?.textContent,
      focused: document.activeElement?.outerHTML.slice(0, 300),
      selected: [...document.querySelectorAll('.react-flow__node.selected')].map(node => node.dataset.id),
      workspace: await window.gameCanvas.getWorkspace()
    }))()`);
    throw Error('Timeout: ' + expression + '\nState: ' + state);
  };
  const key = async (name, ctrl = true) => {
    const params = {
      key: name,
      code: 'Key' + name.toUpperCase(),
      windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0),
      modifiers: ctrl ? 2 : 0,
    };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  };
  const focusCanvas = () =>
    js(
      'document.activeElement?.blur();document.querySelector(".react-flow__pane").focus()',
    );
  const images = () =>
    js(
      'window.gameCanvas.listDocuments().then(d=>d.filter(x=>x.type==="image"))',
    );
  const waitImages = async (count) =>
    wait(
      `window.gameCanvas.listDocuments().then(d=>d.filter(x=>x.type==="image").length===${count})`,
    );
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait('!!document.querySelector(".react-flow__pane")');
  await focusCanvas();
  await writeClipboard('image');
  await key('v');
  await waitImages(1);
  await wait(
    'document.querySelectorAll(".project-image").length===1 && document.querySelector(".project-image").naturalWidth===1',
  );
  const first = (await images())[0];
  assert.equal(first.title, '붙여넣은 이미지');
  assert.ok((await fs.readFile(path.join(game, first.asset.path))).length > 24);
  await wait(
    'document.querySelectorAll(".react-flow__node-document.selected").length === 1',
  );
  await focusCanvas();
  await key('c');
  await wait('document.body.textContent.includes("복사했습니다.")');
  await key('v');
  await waitImages(2);
  assert.equal(
    new Set((await images()).map((d) => d.asset.path)).size,
    1,
    'Internal copy references the existing original',
  );
  await writeClipboard('text');
  await focusCanvas();
  await key('v');
  await wait(
    'document.body.textContent.includes("붙여넣을 이미지나 복사한 카드가 없습니다")',
  );
  assert.equal((await images()).length, 2);
  await writeClipboard('bitmap');
  await key('v');
  await waitImages(3);
  assert.equal(
    new Set((await images()).map((d) => d.asset.path)).size,
    2,
    'External bitmap replaces the stale internal selection',
  );
  await focusCanvas();
  await key('z');
  await waitImages(2);
  await js('window.gameCanvas.redo()');
  await waitImages(3);
  await writeClipboard('browser-image');
  await focusCanvas();
  await key('v');
  await waitImages(4);
  await wait('document.querySelectorAll(".project-image").length===4');
  await writeClipboard('image');
  // Normal title input owns Ctrl+V and must not create a canvas image.
  await js(
    'document.querySelector(".document-card--idea .document-card__content").click()',
  );
  await wait(`!!document.querySelector('input[aria-label="문서 제목"]')`);
  await sleep(150); // Wait for the editor's initial caret-focus animation frame.
  await js(`document.querySelector('input[aria-label="문서 제목"]').focus()`);
  assert.equal(
    await js('document.activeElement?.tagName'),
    'INPUT',
    'Title input must own paste',
  );
  await key('v');
  await sleep(250);
  assert.equal((await images()).length, 4);
  await focusCanvas();
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.mkdir(path.resolve('out/qa'), { recursive: true });
  await fs.writeFile(
    path.resolve('out/qa/clipboard-packaged.png'),
    Buffer.from(screenshot.data, 'base64'),
  );
  await send('Page.reload');
  await wait(
    'window.gameCanvas.listDocuments().then(d=>d.filter(x=>x.type==="image").length===4)',
  );
  const data = await images();
  assert.ok(
    data.every((d) => d.asset?.path && d.body.includes('assets/images/')),
  );
  const oldContext = await js(
    'window.gameCanvas.getWorkspace().then(w=>w.clipboardContextId)',
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  // Normal window closing flushes Chromium's new profile encryption key too.
  void js('window.close()').catch(() => undefined);
  let exitTimer;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        exitTimer = setTimeout(
          () => reject(Error('Packaged app did not close normally')),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(exitTimer);
  }
  ws.close();
  debugPort = await port();
  diagnostic = '';
  child = startApp();
  target = undefined;
  for (let i = 0; i < 160; i++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(
        (r) => r.json(),
      );
      target = pages.find(
        (p) => p.type === 'page' && p.url.includes('index.html'),
      );
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(
    target,
    `Package must restart (exit ${child.exitCode}): ${diagnostic}`,
  );
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', onMessage);
  await wait('!!window.gameCanvas');
  await waitImages(4);
  await wait(
    'document.querySelectorAll(".project-image").length===4 && Array.from(document.querySelectorAll(".project-image")).every(i=>i.naturalWidth>0)',
  );
  assert.deepEqual(
    (await images()).map((d) => d.id).sort(),
    data.map((d) => d.id).sort(),
  );
  assert.notEqual(
    await js('window.gameCanvas.getWorkspace().then(w=>w.clipboardContextId)'),
    oldContext,
  );
  console.log(
    'PASS: packaged native Ctrl+V, internal copy precedence, external text/bitmap/Chromium copy, title focus, undo/redo, reload and full process restart persistence',
  );
} finally {
  ws?.close();
  child.kill();
  let restoreFailure;
  try {
    await writeClipboard('close');
  } catch (error) {
    console.error('Clipboard restore service failed:', error.message);
    helper.kill();
    restoreFailure = error;
  }
  await sleep(500);
  const temporaryRoot = path.resolve(os.tmpdir()),
    profileRoot = path.resolve(
      process.env.APPDATA,
      'Game Canvas',
      'test-users',
    );
  assert.ok(path.resolve(root).startsWith(temporaryRoot + path.sep));
  assert.ok(path.resolve(profile).startsWith(profileRoot + path.sep));
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
  if (restoreFailure) process.exitCode = 1;
}
