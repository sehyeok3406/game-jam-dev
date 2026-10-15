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
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-approval-package-'),
);
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
  console.log(JSON.stringify({ type: 'result', is_error: false, result: 'mock approved' }));
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
const click = async (client, selector, text) => {
  await client.js(
    `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`,
  );
  await pause();
};
try {
  await startServer();
  const admin = await boot('approval-admin');
  const source = await call(admin, 'createIdea', { x: 100, y: 100 });
  const shared = await call(admin, 'createCollaboration', {
    serverUrl,
    serverKey: key,
    nickname: '패키지 관리자',
  });
  const team = await boot('approval-team');
  const joined = await call(team, 'joinCollaboration', {
    serverUrl,
    code: shared.inviteCode,
    nickname: '패키지 팀원',
  });
  assert.equal(joined.role, 'editor');
  const request = {
    canvasId: 'default',
    organize: false,
    implement: true,
    inputPaths: [source.relativePath],
    x: 500,
    y: 100,
    resultName: '패키지 요청',
    htmlResult: { mode: 'new' },
    instructions: {
      organize: '문서를 정리해줘',
      implement: '간단한 게임을 만들어줘',
    },
  };
  const item = await call(team, 'mutateApproval', 'create', {
    commandId: randomUUID(),
    request,
  });
  await admin.wait(
    `window.gameCanvas.listApprovals().then(r=>r.items.some(i=>i.id===${JSON.stringify(item.id)}))`,
  );
  await assert.rejects(
    admin.js('window.gameCanvas.discordApproval.sendTest()'),
    /먼저.*저장.*연결/,
  );
  await click(admin, 'header button', '요청함');
  await admin.wait('!!document.querySelector(".approval-list > button")');
  await click(admin, '.approval-list > button', '패키지 요청');
  const updated = await call(team, 'mutateApproval', 'update', {
    commandId: randomUUID(),
    id: item.id,
    revision: 1,
    request: { ...request, resultName: '패키지 요청 수정' },
  });
  await admin.wait('!!document.querySelector(".approval-change")');
  await click(admin, '.approval-change button', '최신 내용 확인');
  const detail = await call(admin, 'readApproval', item.id);
  assert.equal(detail.item.revision, updated.revision);
  const feedback = await call(admin, 'mutateApproval', 'feedback', {
    commandId: randomUUID(),
    id: item.id,
    revision: updated.revision,
    message: '조작 설명을 보완해주세요',
  });
  const revised = await call(team, 'mutateApproval', 'update', {
    commandId: randomUUID(),
    id: item.id,
    revision: feedback.revision,
    request: {
      ...request,
      resultName: '패키지 요청 수정',
      instructions: {
        ...request.instructions,
        implement: '방향키로 움직이는 게임을 만들어줘',
      },
    },
  });
  assert.equal(revised.status, 'pending');
  await click(admin, '.approval-change button', '최신 내용 확인');
  await admin.js(
    `{const e=document.querySelector('.approval-admin select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'claude-cli');e.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  await click(admin, '.approval-admin button', '승인하고 구현하기');
  await admin.wait('!document.querySelector(".approval-inbox")');
  await admin.wait(
    `window.gameCanvas.readApproval(${JSON.stringify(item.id)}).then(d=>d.item.status==='completed')`,
  );
  const completed = (await call(team, 'readApproval', item.id)).item;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.providerId, 'claude-cli');
  assert.equal(completed.approvedBy, shared.memberId);
  assert.equal(
    completed.executionRequest.instructions.implement,
    '방향키로 움직이는 게임을 만들어줘',
  );
  await team.wait(
    `window.gameCanvas.listPreviews().then(p=>p.some(r=>r.relativePath===${JSON.stringify(completed.outputs[0])}))`,
  );
  const previews = await call(team, 'listPreviews');
  assert.ok(previews.some((p) => completed.outputs.includes(p.relativePath)));
  const html = await call(team, 'readPreview', completed.outputs[0]);
  assert.match(html.content, /패키지 승인 검증 완료/);
  await assert.rejects(
    call(team, 'mutateApproval', 'update', {
      commandId: randomUUID(),
      id: item.id,
      revision: completed.revision,
      request,
    }),
    /시작|종료/,
  );
  await assert.rejects(
    call(team, 'startCodexRun', {
      taskPath: completed.taskPath,
      providerId: 'claude-cli',
      modelId: null,
    }),
    /관리자/,
  );
  await click(team, 'header button', '내 요청');
  await team.wait('!!document.querySelector(".approval-list > button")');
  await click(team, '.approval-list > button', '패키지 요청 수정');
  await fs.mkdir('out/gamejam-approval', { recursive: true });
  const png = await team.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    'out/gamejam-approval/packaged-team-completed.png',
    Buffer.from(png.data, 'base64'),
  );
  await stopChild(server);
  await startServer();
  assert.equal(
    (await call(admin, 'readApproval', item.id)).item.status,
    'completed',
  );
  console.log(
    'PASS: final Windows package and bundled Node/server verify independent admin/team IPC, request edit/feedback, stale review, approval via real UI, isolated mock CLI, verified HTML publication, role enforcement and restart persistence.',
  );
} finally {
  for (const app of apps) {
    app.ws?.close();
    await stopChild(app.child);
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
