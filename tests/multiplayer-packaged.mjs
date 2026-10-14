import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { TestUserLauncher, testProfilePath } from '../src/test-users.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { COOP_REFERENCE_HTML } from '../src/multiplayer/reference-game.ts';

const executable = await fs.realpath(
  path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
);
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-multiplayer-package-'),
);
const output = path.resolve('out/multiplayer-packaged');
await fs.mkdir(output, { recursive: true });
const base = path.join(process.env.APPDATA, 'Game Canvas');
const profiles = [],
  children = [],
  cdpSockets = [],
  ports = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, label) {
  for (let n = 0; n < 200; n++) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw Error('Timeout: ' + label);
}
async function targets(port) {
  try {
    return await fetch(`http://127.0.0.1:${port}/json/list`).then((r) =>
      r.json(),
    );
  } catch {
    return [];
  }
}
async function cdp(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  cdpSockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', ({ data }) => {
    const result = JSON.parse(String(data)),
      item = pending.get(result.id);
    if (!item) return;
    pending.delete(result.id);
    clearTimeout(item.timer);
    if (result.error) item.reject(Error(JSON.stringify(result.error)));
    else item.resolve(result.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('CDP timeout: ' + method));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    async js(expression) {
      const value = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (value.exceptionDetails)
        throw Error(
          value.exceptionDetails.exception?.description ??
            value.exceptionDetails.text,
        );
      return value.result.value;
    },
  };
}
let server, owner;
try {
  if (process.argv.includes('--bundled-server')) {
    const entry = path.resolve('out/self-host-runtime/server.mjs');
    await fs.access(entry);
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const child = spawn(process.execPath, [entry], {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        GAME_CANVAS_DATA: root,
        GAME_CANVAS_HOST: '127.0.0.1',
        GAME_CANVAS_PORT: String(port),
        GAME_CANVAS_PUBLIC: '0',
        GAME_CANVAS_SERVER_KEY: '',
      },
    });
    server = {
      port,
      async close() {
        if (child.exitCode !== null) return;
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      },
    };
    await until(async () => {
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`).then(
          (r) => r.json(),
        );
        return health.multiplayerVersion === 1;
      } catch {
        return false;
      }
    }, 'bundled collaboration server');
  } else
    server = await createCollaborationServer({ port: 0, dataDirectory: root });
  const url = `http://127.0.0.1:${server.port}`,
    gamePath = 'output/prototypes/coop/v001/index.html';
  const created = await CollaborationClient.create(
    url,
    '',
    'QA owner',
    '멀티 패키지 검사',
    {
      'project.md':
        '---\nid: project\ntitle: Multiplayer package QA\ntype: overview\nstatus: draft\nsources: []\n---\nQA only',
      [gamePath]: COOP_REFERENCE_HTML.replace(
        '"maxPlayers":2',
        '"maxPlayers":4',
      ),
    },
  );
  owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  for (let n = 0; n < 4; n++) {
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    ports.push(listener.address().port);
    await new Promise((resolve) => listener.close(resolve));
  }
  const launcher = new TestUserLauncher({
    base,
    executable,
    appPath: '',
    packaged: true,
    spawn(command, args, options) {
      const profile = testProfilePath(base, args);
      assert.ok(profile);
      profiles.push(profile);
      const child = spawn(
        command,
        [...args, `--remote-debugging-port=${ports[children.length]}`],
        options,
      );
      children.push(child);
      return child;
    },
  });
  await launcher.launch(owner, {
    count: 4,
    role: 'editor',
    nicknamePrefix: '멀티 패키지 QA ' + randomUUID().slice(0, 6),
  });
  await until(async () => {
    const users = await launcher.list(owner.credentials.projectId);
    return users.length === 4 && users.every((u) => u.status === 'ready');
  }, 'packaged users joined');
  const mains = [];
  for (const port of ports) {
    const target = await until(
      async () =>
        (await targets(port)).find(
          (t) => t.type === 'page' && t.url.includes('index.html'),
        ),
      'production canvas',
    );
    const session = await cdp(target);
    await until(
      () => session.js('!!window.gameCanvas?.multiplayer'),
      'production multiplayer API',
    );
    mains.push(session);
  }
  const result = await mains[0].js(
    `window.gameCanvas.multiplayer.control({action:'create',path:${JSON.stringify(gamePath)}})`,
  );
  assert.ok(result.room?.id);
  const roomId = result.room.id;
  for (const main of mains)
    await main.js(
      `window.gameCanvas.multiplayer.open(${JSON.stringify(roomId)})`,
    );
  const players = [];
  for (const port of ports) {
    const target = await until(
      async () =>
        (await targets(port)).find(
          (t) => t.type === 'page' && t.url.startsWith('data:text/html'),
        ),
      'packaged player window',
    );
    const session = await cdp(target);
    await until(
      () =>
        session.js(
          '!!document.querySelector("#ready")&&!document.querySelector("#ready").disabled',
        ),
      'packaged preload and SDK loaded',
    );
    await session.js('document.querySelector("#ready").click()');
    players.push(session);
  }
  await until(
    () => players[0].js('!document.querySelector("#start").disabled'),
    'packaged all ready',
  );
  await players[0].js('document.querySelector("#start").click()');
  for (const session of players)
    await until(
      () =>
        session.js(
          'document.querySelector("#status").textContent.includes("함께 플레이 중")',
        ),
      'packaged game running',
    );
  await players[0].send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 200,
    y: 200,
    button: 'left',
    clickCount: 1,
  });
  await players[0].send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 200,
    y: 200,
    button: 'left',
    clickCount: 1,
  });
  await players[0].send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
  });
  await sleep(650);
  await players[0].send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
  });
  await sleep(250);
  for (const [index, session] of players.entries()) {
    const image = await session.send('Page.captureScreenshot', {
      format: 'png',
    });
    await fs.writeFile(
      path.join(output, `player-${index + 1}.png`),
      Buffer.from(image.data, 'base64'),
    );
    assert.ok(
      (
        await session.js('document.querySelector("#status").textContent')
      ).includes('함께 플레이 중'),
    );
  }
  await mains[0].js(
    `window.gameCanvas.multiplayer.control({action:'leave',roomId:${JSON.stringify(roomId)}})`,
  );
  await until(
    () =>
      players[1].js(
        'document.querySelector("#status").textContent.includes("방장")',
      ),
    'packaged host leave',
  );
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        independentProfiles: 4,
        productionPreload: true,
        productionMain: true,
        productionPlayer: true,
        bundledServer: process.argv.includes('--bundled-server'),
        hostLeave: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: actual Windows package, 4 isolated authenticated users, production IPC/preloads, frozen game, ready/start, native input and host leave.',
  );
} finally {
  for (const socket of cdpSockets) socket.close();
  owner?.stop();
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }),
  );
  await server?.close();
  for (const profile of profiles) {
    assert.equal(path.dirname(profile), path.join(base, 'test-users'));
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
  assert.equal(path.dirname(root), os.tmpdir());
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
