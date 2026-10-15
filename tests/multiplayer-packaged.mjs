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
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { DEFAULT_TASK_INSTRUCTIONS } from '../src/task-instructions.ts';
import { readMultiplayerManifest } from '../src/multiplayer/contract.ts';

// Opt-in: exercises the real authenticated AI provider with the user's captured
// text. No fixed SDK game is supplied to the provider as a test result.
const textGeneration = process.argv.includes('--text-generation');
const sourceArgument = process.argv.indexOf('--generated-source');
const generatedSourcePath =
  sourceArgument >= 0 ? process.argv[sourceArgument + 1] : undefined;
const userGameFlow = textGeneration || !!generatedSourcePath;
const participants = userGameFlow ? 2 : 4;

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
async function until(condition, label, attempts = 200) {
  for (let n = 0; n < attempts; n++) {
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
  const frames = [];
  let sequence = 0;
  socket.addEventListener('message', ({ data }) => {
    const result = JSON.parse(String(data));
    if (
      result.method === 'Target.attachedToTarget' &&
      result.params.targetInfo.type === 'iframe'
    )
      frames.push(result.params.sessionId);
    const item = pending.get(result.id);
    if (!item) return;
    pending.delete(result.id);
    clearTimeout(item.timer);
    if (result.error) item.reject(Error(JSON.stringify(result.error)));
    else item.resolve(result.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('CDP timeout: ' + method));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  return {
    send,
    frames,
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
  const url = `http://127.0.0.1:${server.port}`;
  let gamePath = 'output/prototypes/coop/v001/index.html';
  const created = await CollaborationClient.create(
    url,
    '',
    'QA owner',
    '멀티 패키지 검사',
    {
      'project.md':
        '---\nid: project\ntitle: Multiplayer package QA\ntype: overview\nstatus: draft\nsources: []\n---\nQA only',
      [gamePath]: generatedSourcePath
        ? await fs.readFile(generatedSourcePath, 'utf8')
        : COOP_REFERENCE_HTML.replace(
            '"maxPlayers":2',
            '"maxPlayers":4',
          ).replace(
            '</body>',
            process.argv.includes('--diagnostics')
              ? '<script>addEventListener("keydown",e=>{if(e.code==="F9")GameJamMultiplayer.reportIssue({area:"rules",code:"GAME-PUSH-001",message:"PRIVATE-CONTENT"});});</script></body>'
              : '</body>',
          ),
      ...(textGeneration
        ? {
            'ideas/user.md':
              '---\nid: user-idea\ntitle: 멀티 테스트\ntype: idea\nstatus: draft\nsources: []\n---\n' +
              (await fs.readFile(
                'tests/fixtures/user-multiplayer-request.md',
                'utf8',
              )),
          }
        : {}),
    },
  );
  owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  for (let n = 0; n < participants; n++) {
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
    count: participants,
    role: 'editor',
    nicknamePrefix: '멀티 패키지 QA ' + randomUUID().slice(0, 6),
  });
  await until(async () => {
    const users = await launcher.list(owner.credentials.projectId);
    return (
      users.length === participants && users.every((u) => u.status === 'ready')
    );
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
  if (textGeneration) {
    const member = await mains[0].js('window.gameCanvas.getCollaboration()');
    await CollaborationClient.fetch(
      url,
      `/projects/${created.credentials.projectId}/role`,
      { memberId: member.memberId, role: 'admin' },
      created.credentials.token,
    );
    await until(
      () =>
        mains[0].js(
          'window.gameCanvas.getCollaboration().then(state=>state.role==="admin")',
        ),
      'QA admin role',
    );
    const status = await mains[0].js(
      'window.gameCanvas.getAiStatus("codex-cli")',
    );
    assert(
      status.available && status.authenticated,
      'Real provider must be available and authenticated',
    );
    const input = gamejamTaskInput({
      organize: false,
      implement: true,
      inputPaths: ['ideas/user.md'],
      x: 0,
      y: 0,
      resultName: '실제 텍스트 멀티 테스트',
      htmlResult: { mode: 'new' },
      instructions: DEFAULT_TASK_INSTRUCTIONS,
    });
    assert.equal(input.multiplayer, undefined);
    const task = await mains[0].js(
      `window.gameCanvas.createTask(${JSON.stringify(input)})`,
    );
    await mains[0].js(
      'window.__userTextQaEvents=[];window.gameCanvas.onCodexRunEvent(e=>window.__userTextQaEvents.push(e))',
    );
    const run = await mains[0].js(
      `window.gameCanvas.startCodexRun(${JSON.stringify({ taskPath: task.relativePath, providerId: 'codex-cli', modelId: null })})`,
    );
    const terminal = await until(
      async () => {
        const events = await mains[0].js(
          'window.__userTextQaEvents.map(e=>({runId:e.runId,status:e.status,failure:e.failure,message:e.message}))',
        );
        return events.find(
          (e) =>
            e.runId === run.runId &&
            ['completed', 'failed', 'cancelled'].includes(e.status),
        );
      },
      'actual AI text generation and validation',
      6000,
    );
    await fs.writeFile(
      path.join(output, 'text-generation-result.json'),
      JSON.stringify(
        {
          realProvider: true,
          librarySelected: false,
          status: terminal.status,
          failure: terminal.failure,
        },
        null,
        2,
      ),
    );
    assert.equal(terminal.status, 'completed', JSON.stringify(terminal));
    const generated = await until(
      async () =>
        (await mains[0].js('window.gameCanvas.listPreviews()')).find(
          (p) => p.relativePath !== gamePath,
        ),
      'generated user game',
    );
    assert.equal(readMultiplayerManifest(generated.content).maxPlayers, 2);
    await fs.writeFile(
      path.join(output, 'user-text-generated.html'),
      generated.content,
    );
    gamePath = generated.relativePath;
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
  const gameFrames = [];
  if (userGameFlow) {
    for (const [index, session] of players.entries()) {
      await session.send('Page.bringToFront');
      await session.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: 200,
        y: 200,
        button: 'left',
        clickCount: 1,
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 200,
        y: 200,
        button: 'left',
        clickCount: 1,
      });
      await session.send('Page.enable');
      const tree = await session.send('Page.getFrameTree');
      const frame = tree.frameTree.childFrames?.[0]?.frame;
      let world, childSession;
      if (frame)
        world = await session.send('Page.createIsolatedWorld', {
          frameId: frame.id,
          worldName: 'user-game-qa',
        });
      else {
        await session.send('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
        childSession = await until(
          () => session.frames[0],
          'generated game frame',
        );
      }
      const evaluate = async (expression) => {
        // Request a compositor frame when the other QA native window covers it.
        await session.send('Page.captureScreenshot', { format: 'png' });
        return (
          await session.send(
            'Runtime.evaluate',
            {
              ...(world ? { contextId: world.executionContextId } : {}),
              returnByValue: true,
              expression,
            },
            childSession,
          )
        ).result.value;
      };
      gameFrames.push(evaluate);
      await until(
        () =>
          evaluate(
            `Array.from(document.querySelectorAll('button')).some(b=>/${index + 1}\\s*P/i.test(b.textContent)&&!b.disabled)`,
          ),
        'generated seat button enabled',
      );
      const selected = await evaluate(
        `(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>/${index + 1}\\s*P/i.test(b.textContent)&&!b.disabled);if(!button)return false;button.click();return true;})()`,
      );
      assert.equal(
        selected,
        true,
        'Real generated game exposes requested seat choice',
      );
      await sleep(200);
    }
    for (const evaluate of gameFrames)
      await until(
        () =>
          evaluate(
            "Array.from(document.querySelectorAll('button')).filter(b=>/[12]\\s*P/i.test(b.textContent)).every(b=>b.getClientRects().length===0)",
          ),
        'both seats selected and real game started',
      );
  }
  const beforeCanvases = await Promise.all(
    gameFrames.map((evaluate) =>
      evaluate('document.querySelector("canvas").toDataURL()'),
    ),
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
  if (userGameFlow) {
    const afterCanvases = await Promise.all(
      gameFrames.map((evaluate) =>
        evaluate('document.querySelector("canvas").toDataURL()'),
      ),
    );
    for (let i = 0; i < participants; i++)
      assert.notEqual(
        afterCanvases[i],
        beforeCanvases[i],
        'Native movement must appear on both generated game screens',
      );
    await players[0].send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
    });
    await sleep(450);
    await players[0].send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
    });
    await sleep(250);
    const beforePush = await Promise.all(
      gameFrames.map((evaluate) =>
        evaluate('document.querySelector("canvas").toDataURL()'),
      ),
    );
    await players[0].send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    await sleep(100);
    await players[0].send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    await sleep(450);
    const afterPush = await Promise.all(
      gameFrames.map((evaluate) =>
        evaluate('document.querySelector("canvas").toDataURL()'),
      ),
    );
    for (let i = 0; i < participants; i++)
      assert.notEqual(
        beforePush[i],
        afterPush[i],
        'Space push must remain visible on both screens after the short visual effect ends',
      );
  }
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
  if (process.argv.includes('--diagnostics')) {
    await players[0].send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'F9',
      code: 'F9',
      windowsVirtualKeyCode: 120,
    });
    await players[0].send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'F9',
      code: 'F9',
      windowsVirtualKeyCode: 120,
    });
    const incidents = [];
    for (const [index, session] of players.entries()) {
      await until(
        () =>
          session.js(
            '!document.querySelector("#failure").hidden && document.querySelector("#failure-code").textContent.includes("GC-MP-016")',
          ),
        'packaged diagnostic propagated',
      );
      const value = await session.js('window.gameJamPlayer.diagnostics(false)');
      assert(!value.report.includes('PRIVATE-CONTENT'));
      const report = JSON.parse(value.report),
        incident = report.entries.find((e) => e.failure.code === 'GC-MP-016');
      assert(incident);
      assert.equal(incident.failure.details.customCode, 'GAME-PUSH-001');
      incidents.push(incident.failure.id);
      const screenshot = await session.send('Page.captureScreenshot', {
        format: 'png',
      });
      await fs.writeFile(
        path.join(output, `error-player-${index + 1}.png`),
        Buffer.from(screenshot.data, 'base64'),
      );
    }
    assert(incidents.every((id) => id === incidents[0]));
    for (const session of players)
      await session.js('document.querySelector("#ready").click()');
    await until(
      () => players[0].js('!document.querySelector("#start").disabled'),
      'retry after game error',
    );
    await players[0].js('document.querySelector("#start").click()');
    for (const session of players)
      await until(
        () =>
          session.js(
            'document.querySelector("#status").textContent.includes("함께 플레이 중") && document.querySelector("#failure").hidden',
          ),
        'new round clears error and resumes',
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
        independentProfiles: participants,
        realTextGeneration: textGeneration,
        userGeneratedSource: !!generatedSourcePath,
        ...(userGameFlow
          ? {
              seatsSelected: true,
              movementOnBothScreens: true,
              pushOnBothScreens: true,
            }
          : {}),
        productionPreload: true,
        productionMain: true,
        productionPlayer: true,
        bundledServer: process.argv.includes('--bundled-server'),
        hostLeave: true,
        diagnostics: process.argv.includes('--diagnostics'),
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: actual Windows package, ${participants} isolated authenticated users, production IPC/preloads, frozen game, ready/start, native input and host leave.`,
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
