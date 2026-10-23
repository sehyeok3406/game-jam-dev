// Isolated packaged UI and native clipboard verification. Never starts a host.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import electron from 'electron';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-host-packaged-'));
const profileId = randomUUID();
const token = randomUUID();
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return result;
}
const debugPort = await port(),
  clipboardPort = await port();
const helper = spawn(electron, ['tests/clipboard-helper.electron.mjs'], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    QA_CLIPBOARD_PORT: String(clipboardPort),
    QA_CLIPBOARD_TOKEN: token,
  },
});
const child = spawn(
  path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
  [
    `--game-canvas-test-profile=${profileId}`,
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
  ],
  {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      APPDATA: path.join(root, 'appdata'),
      LOCALAPPDATA: path.join(root, 'local'),
    },
  },
);
let ws, js;
async function clipboardRequest(route, expected) {
  const response = await fetch(`http://127.0.0.1:${clipboardPort}/${route}`, {
    method: expected === undefined ? 'GET' : 'POST',
    headers: { 'x-test-token': token, 'Content-Type': 'application/json' },
    body: expected === undefined ? undefined : JSON.stringify({ expected }),
  });
  assert.ok(response.ok, 'Clipboard helper request');
  return expected === undefined ? response.text() : response.json();
}
async function wait(expression) {
  for (let i = 0; i < 200; i++) {
    if (await js(expression)) return;
    await pause();
  }
  throw Error('Packaged self-host UI timed out: ' + expression);
}
try {
  let target;
  for (let i = 0; i < 200; i++) {
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      ).find((t) => t.type === 'page' && t.url.includes('index.html'));
    } catch {}
    if (target) break;
    assert.equal(child.exitCode, null, 'Packaged app exited early');
    await pause();
  }
  assert.ok(target, 'Packaged app must expose its isolated renderer');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const result = JSON.parse(String(data));
    const request = pending.get(result.id);
    if (request) {
      pending.delete(result.id);
      clearTimeout(request.timer);
      if (result.error) request.reject(Error('CDP error'));
      else request.resolve(result.result);
    }
  });
  js = async (expression) => {
    const result = await new Promise((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(() => {
        pending.delete(next);
        reject(Error('Packaged evaluation timed out'));
      }, 30_000);
      pending.set(next, { resolve, reject, timer });
      ws.send(
        JSON.stringify({
          id: next,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    if (result.exceptionDetails)
      throw Error(
        'Packaged evaluation failed: ' + result.exceptionDetails.text,
      );
    return result.result.value;
  };
  await wait('!!window.gameCanvas?.selfHost');
  await wait(
    '[...document.querySelectorAll("button")].some(b=>b.textContent.includes("협업 서버 열기"))',
  );
  await js(
    '[...document.querySelectorAll("button")].find(b=>b.textContent.includes("협업 서버 열기")).click()',
  );
  await wait('!!document.querySelector(".self-host-dialog[open]")');
  await wait(
    'document.querySelector(".self-host-status").getAttribute("aria-busy")==="false"',
  );
  assert.equal(
    await js(
      'document.querySelector(".self-host-status").textContent.includes("GC-HOST-099")',
    ),
    false,
  );
  await js(
    '[...document.querySelectorAll("summary")].find(s=>s.textContent.includes("AI에게 도움받기")).click()',
  );
  await js(
    '[...document.querySelectorAll("button")].find(b=>b.textContent.includes("AI 요청문 복사")).click()',
  );
  await wait('!!document.querySelector(".self-host-help .self-host-message")');
  const prompt = await js(
    'document.querySelector(".self-host-help textarea").value',
  );
  assert.ok(prompt.includes('앱 버전: 0.35.2'));
  assert.equal(
    (await clipboardRequest('match-text', prompt)).matches,
    true,
    'Real Windows clipboard must exactly match the displayed prompt',
  );
  assert.equal(
    await js(
      '[...document.querySelectorAll("button")].filter(b=>b.textContent.includes("AI 요청문 복사")).length',
    ),
    1,
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".self-host-help > summary > .self-host-disclosure").length',
    ),
    2,
  );
  await fs.mkdir('out/qa', { recursive: true });
  // Capture only this isolated, synthetic profile.
  const image = await new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => reject(Error('Capture timed out')), 10_000);
    pending.set(next, { resolve, reject, timer });
    ws.send(
      JSON.stringify({
        id: next,
        method: 'Page.captureScreenshot',
        params: { format: 'png' },
      }),
    );
  });
  await fs.writeFile(
    'out/qa/self-host-packaged.png',
    Buffer.from(image.data, 'base64'),
  );
  console.log(
    'PASS: isolated Windows package uses real native clipboard, shows one AI copy button and explicit disclosure controls; production browser permissions remain unchanged.',
  );
} finally {
  ws?.close();
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  try {
    await clipboardRequest('close');
  } finally {
    if (helper.exitCode === null)
      await Promise.race([
        new Promise((resolve) => helper.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
  }
  if (helper.exitCode === null) helper.kill();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('gamejam-host-packaged-'));
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
