import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const packageDir = path.resolve(
  process.env.GAMEJAM_PACKAGE_DIR ?? 'out/Game Jam!-win32-x64',
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-queue-package-'));
const profileRoot = path.resolve(
  process.env.APPDATA,
  'Game Canvas',
  'test-users',
);
const profiles = [];
const apps = [];
const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
const bin = path.join(root, 'mock-bin');
await fs.mkdir(path.join(bin, 'node_modules/@anthropic-ai/claude-code'), {
  recursive: true,
});
await fs.writeFile(path.join(bin, 'claude.cmd'), '@echo off\r\nexit /b 1\r\n');
// The app resolves the npm entrypoint directly; this fixture has no network calls or credentials.
await fs.writeFile(
  path.join(bin, 'node_modules/@anthropic-ai/claude-code/cli.js'),
  `
const fs = require('node:fs'); const path = require('node:path');
const matter = require(${JSON.stringify(path.resolve('node_modules/gray-matter'))});
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('approval-package-mock'); process.exit(0); }
if (args.includes('--help')) { console.log('--restricted --strict-mcp-config --tools --output-format'); process.exit(0); }
if (args[0] === 'auth') { process.exit(0); }
if (!args.includes('--print')) process.exit(2);
let input = ''; process.stdin.on('data', (d) => input += d); process.stdin.on('end', () => {
  const relative = input.match(/at (\\.ai\\/tasks\\/[^\\n]+\\.md)\\./)?.[1];
  if (!relative) throw Error('Missing task scope');
  const spec = matter(fs.readFileSync(relative, 'utf8')).data;
  for (const output of spec.expected_outputs) {
    if (!output.endsWith('.html')) throw Error('Unexpected fixture output');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>승인된 게임</title></head><body><h1>패키지 승인 검증 완료</h1></body></html>');
  }
  setTimeout(() => console.log(JSON.stringify({ type: 'result', is_error: false, result: 'mock queued' })), 1800);
});
`,
);
const childEnv = {
  ...process.env,
  PATH: bin + path.delimiter + process.env.PATH,
};
const serverPort = await port();
const serverUrl = `http://127.0.0.1:${serverPort}`;
const key = 'approval-package-test-' + randomUUID();
let server;
const waitServer = async () => {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(serverUrl + '/health')).ok) return;
    } catch {}
    await pause();
  }
  throw Error('Bundled server did not start');
};
async function startServer() {
  const runtime = path.join(packageDir, 'resources/self-host-runtime');
  server = spawn(
    path.join(runtime, 'node.exe'),
    [path.join(runtime, 'server.mjs')],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnv,
        GAME_CANVAS_HOST: '127.0.0.1',
        GAME_CANVAS_PORT: String(serverPort),
        GAME_CANVAS_DATA: path.join(root, 'server-data'),
        GAME_CANVAS_SERVER_KEY: key,
      },
    },
  );
  server.on('error', (e) =>
    console.error('Bundled server spawn failed:', e.message),
  );
  await waitServer();
}
async function stopChild(child) {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
}
async function boot(name) {
  const profileId = randomUUID();
  const profile = path.join(profileRoot, profileId);
  profiles.push(profile);
  const game = path.join(root, name);
  await fs.mkdir(game, { recursive: true });
  await fs.writeFile(path.join(game, 'project.md'), '# 승인 패키지 검사\n');
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(
    path.join(profile, 'local-projects.json'),
    JSON.stringify([
      {
        id: 'local:' + game.toLowerCase(),
        root: game,
        name,
        kind: 'local',
        lastOpenedAt: Date.now(),
      },
    ]),
  );
  const debugPort = await port();
  const child = spawn(
    path.join(packageDir, 'Game Canvas.exe'),
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${debugPort}`,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: childEnv },
  );
  let diagnostic = '';
  child.stderr.on('data', (d) => {
    diagnostic = (diagnostic + d.toString()).slice(-1000);
  });
  const context = { child, ws: null };
  apps.push(context);
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
  assert.ok(target, diagnostic || 'Packaged app did not load');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  context.ws = ws;
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data));
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  const send = (method, params) =>
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
  const wait = async (code) => {
    for (let i = 0; i < 250; i++) {
      if (await js(code)) return;
      await pause();
    }
    throw Error('Packaged approval timeout: ' + code);
  };
  await wait(
    '!!window.gameCanvas && !!document.querySelector(".home-project-open")',
  );
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(game)})`,
  );
  return { js, wait, send };
}
const call = (client, method, ...args) =>
  client.js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );

try {
  const admin = await boot('queue-admin');
  const source = await call(admin, 'createIdea', { x: 100, y: 100 });
  let htmlMaterial = null;
  const enqueue = async () => {
    const task = await call(admin, 'createTask', {
      queueVersion: 1,
      kind: 'implement',
      ...(htmlMaterial ? { sourceMode: 'html-compose' } : {}),
      inputPaths: [
        source.relativePath,
        ...(htmlMaterial ? [htmlMaterial.relativePath] : []),
      ],
      htmlResult: { mode: 'new' },
      resultName: '예약 패키지',
      x: 500,
      y: 100,
    });
    return call(admin, 'startCodexRun', {
      queueVersion: 1,
      taskPath: task.relativePath,
      providerId: 'claude-cli',
      modelId: null,
    });
  };
  const a = await enqueue();
  await admin.wait(
    `window.gameCanvas.listAiQueue().then(ts=>ts.some(t=>t.runId===${JSON.stringify(a.runId)}&&t.status==='starting'))`,
  );
  const b = await enqueue();
  const c = await enqueue();
  await admin.wait(
    'document.querySelectorAll(".ai-queue-panel li[data-status=queued]").length===2',
  );
  await assert.rejects(
    call(admin, 'saveDocument', {
      relativePath: source.relativePath,
      title: 'blocked',
      body: 'blocked',
    }),
    /AI 작업/,
  );
  assert.equal(
    await admin.js(
      `document.querySelector('[aria-label="gamejam!"]').disabled`,
    ),
    false,
  );
  await admin.wait('!!document.querySelector(".ai-material-badge")');
  await fs.mkdir('out/ai-queue-ui', { recursive: true });
  const png = await admin.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    'out/ai-queue-ui/packaged-reservations.png',
    Buffer.from(png.data, 'base64'),
  );
  await call(admin, 'cancelQueuedTask', b.runId);
  await admin.wait(
    `window.gameCanvas.listAiQueue().then(ts=>ts.find(t=>t.runId===${JSON.stringify(c.runId)})?.status==='completed')`,
  );
  const localTasks = await call(admin, 'listAiQueue');
  assert.equal(localTasks.find((t) => t.runId === a.runId).status, 'completed');
  assert.equal(localTasks.find((t) => t.runId === b.runId).status, 'cancelled');
  assert.equal((await call(admin, 'listPreviews')).length, 2);
  await call(admin, 'saveDocument', {
    relativePath: source.relativePath,
    title: 'after queue',
    body: 'unlocked',
  });
  htmlMaterial = (await call(admin, 'listPreviews'))[0];
  console.log(
    'PASS: Windows package local reservations run with an isolated real mock CLI, share material protection, cancel individually and publish two versions',
  );
  await startServer();
  const shared = await call(admin, 'createCollaboration', {
    serverUrl,
    serverKey: key,
    nickname: '예약 관리자',
  });
  const team = await boot('queue-team');
  await call(team, 'joinCollaboration', {
    serverUrl,
    code: shared.inviteCode,
    nickname: '예약 팀원',
  });
  const d = await enqueue();
  const e = await enqueue();
  await team.wait('window.gameCanvas.listAiQueue().then(ts=>ts.length===2)');
  await assert.rejects(
    call(team, 'acquireDocumentLock', source.relativePath),
    /AI 작업/,
  );
  await admin.wait(
    `window.gameCanvas.listAiQueue().then(ts=>ts.find(t=>t.runId===${JSON.stringify(e.runId)})?.status==='completed')`,
  );
  assert.equal(
    (await call(admin, 'listAiQueue')).find((t) => t.runId === d.runId).status,
    'completed',
  );
  await team.wait('document.querySelectorAll("[data-ai-usage]").length===0');
  assert.equal((await call(admin, 'listPreviews')).length, 4);
  assert.equal(
    (await call(admin, 'readPreview', htmlMaterial.relativePath)).content,
    htmlMaterial.content,
  );
  await stopChild(server);
  await startServer();
  assert.equal((await call(admin, 'listAiQueue')).length, 2);
  console.log(
    'PASS: bundled Node/server plus independent desktop clients share durable reservations, enforce locks and automatically execute queued work',
  );
} finally {
  for (const context of apps) {
    context.ws?.close();
    await stopChild(context.child);
  }
  await stopChild(server);
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  await fs.rm(root, { recursive: true, force: true });
  for (const profile of profiles) {
    assert.ok(path.resolve(profile).startsWith(profileRoot + path.sep));
    await fs.rm(profile, { recursive: true, force: true });
  }
}
