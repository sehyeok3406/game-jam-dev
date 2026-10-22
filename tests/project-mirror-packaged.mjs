import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-mirror-packaged-'),
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
const call = (method, ...args) =>
  js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
const original = 'output/inbox/package/v001/index.html';
const first = 'output/systems/first/v001/index.html';
const second = 'output/content/second/v001/index.html';
const html = '<!doctype html><html><body>공동 파일 반영 검사</body></html>';
const asset = (relative) =>
  path.posix.join(path.posix.dirname(relative), 'assets/game.js');
async function move(from, category, feature) {
  return call('moveResult', { relativePath: from, category, feature });
}
try {
  await fs.mkdir(path.join(game, path.posix.dirname(asset(original))), {
    recursive: true,
  });
  await fs.writeFile(path.join(game, original), html);
  await fs.writeFile(
    path.join(game, asset(original)),
    'preserved shared asset',
  );
  await boot();
  const localId = 'local:' + game.toLowerCase();
  await call('openProject', localId);
  const server = await call('startLocalCollaborationServer');
  await call('createCollaboration', {
    serverUrl: server.serverUrl,
    serverKey: '',
    nickname: '공동 파일 검사',
  });
  const workspace = await call('getWorkspace');
  assert.ok(
    path.resolve(workspace.root).startsWith(path.resolve(profile) + path.sep),
  );
  const mirrored = (relative) => path.join(workspace.root, relative);
  await move(original, 'systems', 'first');
  assert.equal(await fs.readFile(mirrored(first), 'utf8'), html);
  assert.equal(
    await fs.readFile(mirrored(asset(first)), 'utf8'),
    'preserved shared asset',
  );
  await fs.writeFile(
    mirrored(path.posix.join(path.posix.dirname(first), 'assets/local.log')),
    'untracked personal auxiliary',
  );
  const window = { x: 40, y: 50, width: 777, height: 520, collapsed: false };
  await call('savePreviewWindow', window, first);
  await move(first, 'content', 'second');
  assert.equal(await fs.readFile(mirrored(second), 'utf8'), html);
  assert.equal(
    await fs.readFile(mirrored(asset(second)), 'utf8'),
    'preserved shared asset',
  );
  assert.equal(
    await fs.readFile(
      mirrored(path.posix.join(path.posix.dirname(second), 'assets/local.log')),
      'utf8',
    ),
    'untracked personal auxiliary',
  );
  assert.equal((await call('getPreviewWindow', second)).width, 777);
  await assert.rejects(fs.access(mirrored(first)), { code: 'ENOENT' });
  // Server history and the PC mirror retain separate responsibilities: Undo restores the server;
  // the next mirror operation materializes that authoritative snapshot at the captured cache root.
  await call('undo');
  assert.ok(
    (await call('listPreviews')).some(
      (result) => result.relativePath === first,
    ),
  );
  await call('redo');
  assert.ok(
    (await call('listPreviews')).some(
      (result) => result.relativePath === second,
    ),
  );
  await call('deleteDocument', { documentId: second, relativePath: second });
  await assert.rejects(fs.access(mirrored(path.posix.dirname(second))), {
    code: 'ENOENT',
  });
  assert.ok(
    !(await call('listPreviews')).some(
      (result) => result.relativePath === second,
    ),
  );
  await call('undo');
  await move(second, 'systems', 'restored');
  const restored = 'output/systems/restored/v001/index.html';
  assert.equal(await fs.readFile(mirrored(restored), 'utf8'), html);
  assert.equal(
    await fs.readFile(mirrored(asset(restored)), 'utf8'),
    'preserved shared asset',
  );
  assert.equal(await fs.readFile(path.join(game, original), 'utf8'), html);
  assert.equal(
    await fs.readFile(path.join(game, asset(original)), 'utf8'),
    'preserved shared asset',
  );
  await call('goHome');
  await call('openProject', localId);
  const document = await call('getDocument', 'project.md');
  await call('saveDocument', {
    relativePath: 'project.md',
    title: '로컬 변경',
    body: '새 세션의 내용',
    revision: document.revision,
    documentId: document.id,
  });
  assert.match(
    (await call('getDocument', 'project.md')).body,
    /새 세션의 내용/,
  );
  assert.equal(await fs.readFile(mirrored(restored), 'utf8'), html);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await js(
    'window.__mirrorWatchCount = 0; window.__stopMirrorWatch = window.gameCanvas.onWorkspaceChanged(() => window.__mirrorWatchCount++)',
  );
  const localDocument = await fs.readFile(
    path.join(game, 'project.md'),
    'utf8',
  );
  await fs.writeFile(
    path.join(game, 'project.md'),
    localDocument.replace('새 세션의 내용', '외부 파일 변경 감시 확인'),
  );
  await wait('window.__mirrorWatchCount > 0');
  assert.match(
    (await call('getDocument', 'project.md')).body,
    /외부 파일 변경 감시 확인/,
  );
  await js('window.__stopMirrorWatch()');
  console.log(
    'PASS: actual Windows shared result moves retain tracked assets, local auxiliary files and personal window settings; Undo/Redo/deletion/rebuild keep server history and original local source intact across project switches',
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
