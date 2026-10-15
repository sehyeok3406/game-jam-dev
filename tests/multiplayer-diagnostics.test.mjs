import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { PlayClient } from '../src/multiplayer/client.ts';
import { JSDOM } from 'jsdom';
import {
  PlayError,
  PLAY_ERRORS,
  playFailure,
  playDetails,
} from '../src/multiplayer/errors.ts';
import {
  PlayDiagnostics,
  diagnosticRef,
} from '../src/multiplayer/diagnostics.ts';
import { failureInfo } from '../src/app-errors.ts';
import { installMultiplayerSdk } from '../src/multiplayer/sdk-runtime.js';

const privateText = 'PRIVATE-GAME-TOKEN-AND-CONTENT';
test('all multiplayer codes survive common errors and IPC serialization without copying private messages', () => {
  assert.equal(Object.keys(PLAY_ERRORS).length, 30);
  for (const code of Object.keys(PLAY_ERRORS)) {
    assert.equal(failureInfo(new PlayError(code)).code, code);
    const failure = playFailure(
      new PlayError(code, { callback: 'step', token: privateText }),
    );
    const restored = playFailure(
      new Error(`[${code}] ${privateText} [incident:${failure.id}]`),
    );
    assert.equal(restored.id, failure.id);
    assert.equal(restored.code, code);
    assert(!JSON.stringify(restored).includes(privateText));
  }
  assert.equal(playFailure({ status: 403 }).code, 'GC-MP-008');
  assert.equal(playFailure({ status: 429 }).code, 'GC-MP-022');
  assert.equal(playFailure({ code: 'GC-NET-001' }).code, 'GC-MP-006');
  assert.deepEqual(
    playDetails(
      JSON.parse(
        '{"constructor":"secret","__proto__":"secret","token":"secret","line":8,"callback":"render"}',
      ),
    ),
    { line: 8, callback: 'render' },
  );
});

test('diagnostics remain bounded, persist, aggregate bursts, preserve incident IDs and isolate reports by project', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-play-diagnostics-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'diagnostics.json'),
    store = new PlayDiagnostics(file, 'test-version');
  const projectRef = diagnosticRef('test-project');
  const first = store.record(new PlayError('GC-MP-016'), 'GC-MP-029', {
    projectRef,
    callback: 'step',
    token: privateText,
    state: { score: privateText },
    url: `https://user:${privateText}@host.invalid`,
    stack: privateText,
  });
  store.record(first);
  for (let n = 0; n < 1000; n++)
    store.record(new PlayError('GC-MP-016'), 'GC-MP-029', {
      projectRef,
      callback: 'step',
    });
  let report = await store.report({ projectRef });
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].count, 1001);
  assert.equal(report.entries[0].failure.id, first.id);
  assert(!JSON.stringify(report).includes(privateText));
  assert(!JSON.stringify(report).includes('test-project'));
  store.record(new PlayError('GC-MP-017'), 'GC-MP-029', {
    projectRef: diagnosticRef('other-project'),
  });
  for (let n = 0; n < 260; n++)
    store.record(new PlayError('GC-MP-016'), 'GC-MP-029', {
      projectRef,
      tick: n,
    });
  await store.flush();
  const persisted = await fs.readFile(file, 'utf8');
  assert(persisted.length < 300_000);
  assert.equal(JSON.parse(persisted).entries.length, 200);
  const restored = new PlayDiagnostics(file, 'next-version');
  report = await restored.report({ projectRef });
  assert.equal(report.count, 100);
  assert.equal(report.entries.at(-1).failure.details.tick, 259);
  assert.equal(report.appVersion, 'next-version');
});

test('a diagnostic storage failure keeps the original error in memory and reports GC-MP-028', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-play-storage-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'blocked'), 'file');
  const store = new PlayDiagnostics(
    path.join(root, 'blocked/log.json'),
    'test',
  );
  store.record(new PlayError('GC-MP-017'));
  const report = await store.report();
  assert.equal(report.storageAvailable, false);
  assert(report.entries.some((e) => e.failure.code === 'GC-MP-017'));
  assert(report.entries.some((e) => e.failure.code === 'GC-MP-028'));
});

function sdk(mode = 'solo') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
  });
  const events = [],
    intervals = [],
    frames = [],
    timers = [];
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  w.setInterval = (fn) => intervals.push(fn);
  w.setTimeout = (fn, delay) => timers.push({ fn, delay });
  w.requestAnimationFrame = (fn) => frames.push(fn);
  w.postMessage = (m) => events.push(m);
  w.console.error = () => {};
  const cfg = JSON.stringify({ mode, id: 'test', errors: PLAY_ERRORS });
  vm.runInContext(
    `(${installMultiplayerSdk.toString()})(${cfg})`,
    dom.getInternalVMContext(),
  );
  const register = (overrides = {}) =>
    w.GameJamMultiplayer.register({
      createState: () => ({ x: 0 }),
      validateInput: () => true,
      step: () => undefined,
      render: () => {},
      getOutcome: () => null,
      ...overrides,
    });
  return { dom, w, events, intervals, frames, timers, register };
}
test('SDK identifies registration, initial state, input, simulation, render and outcome exceptions separately', () => {
  const cases = [
    ['GC-MP-014', (s) => s.w.GameJamMultiplayer.register({})],
    [
      'GC-MP-013',
      (s) =>
        s.register({
          createState: () => {
            throw new TypeError(privateText);
          },
        }),
    ],
    [
      'GC-MP-015',
      (s) => {
        s.register({
          validateInput: () => {
            throw new TypeError(privateText);
          },
        });
        s.w.GameJamMultiplayer.sendInput({ x: 1 });
      },
    ],
    [
      'GC-MP-016',
      (s) => {
        s.register({
          step: () => {
            throw new RangeError(privateText);
          },
        });
        s.intervals[0]();
      },
    ],
    [
      'GC-MP-017',
      (s) => {
        s.register({
          render: () => {
            throw new ReferenceError(privateText);
          },
        });
        s.frames[0]();
      },
    ],
    [
      'GC-MP-018',
      (s) => {
        s.register({
          getOutcome: () => {
            throw new Error(privateText);
          },
        });
        s.intervals[0]();
      },
    ],
    [
      'GC-MP-019',
      (s) => {
        s.register();
        s.w.GameJamMultiplayer.sendInput({ x: 'a'.repeat(2048) });
      },
    ],
    [
      'GC-MP-025',
      (s) =>
        s.w.dispatchEvent(
          new s.w.ErrorEvent('error', {
            error: new Error(privateText),
            lineno: 31,
            colno: 9,
          }),
        ),
    ],
  ];
  for (const [code, run] of cases) {
    const s = sdk();
    try {
      run(s);
      const event = s.events.find((e) => e.type === 'gamejam:diagnostic');
      assert.equal(event?.diagnostic.code, code);
      assert(!JSON.stringify(s.events).includes(privateText));
      assert.equal(
        s.w.document.querySelector('#gamejam-error')?.getAttribute('role'),
        'alert',
      );
      assert.match(
        s.w.document.querySelector('#gamejam-error').textContent,
        new RegExp(code),
      );
      const count = s.events.length;
      s.frames[0]?.();
      s.intervals[0]?.();
      assert.equal(
        s.events.length,
        count,
        'a failed game does not flood diagnostics',
      );
    } finally {
      s.dom.window.close();
    }
  }
});

test('SDK reports missing registration and game-specific issue codes without raw game data', () => {
  const absent = sdk();
  try {
    absent.timers.find((t) => t.delay === 10000).fn();
    assert.equal(absent.events[0].diagnostic.code, 'GC-MP-014');
  } finally {
    absent.dom.window.close();
  }
  const custom = sdk();
  try {
    custom.register();
    custom.w.GameJamMultiplayer.reportIssue({
      area: 'rules',
      code: 'GAME-PUSH-001',
      message: privateText,
      state: privateText,
    });
    const event = custom.events.find(
      (e) => e.type === 'gamejam:diagnostic',
    ).diagnostic;
    assert.equal(event.code, 'GC-MP-016');
    assert.equal(event.diagnostic.customCode, 'GAME-PUSH-001');
    assert(!JSON.stringify(custom.events).includes(privateText));
  } finally {
    custom.dom.window.close();
  }
});

test('connection rejection preserves the server code and repeated failures stop instead of waiting forever', async (t) => {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  let rejected = true;
  server.on('upgrade', (req, socket, head) => {
    if (rejected) {
      socket.end(
        'HTTP/1.1 403 Forbidden\r\nX-GameJam-Error: GC-MP-008\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const credentials = {
    serverUrl: `http://127.0.0.1:${server.address().port}`,
    projectId: '00000000-0000-0000-0000-000000000001',
    token: privateText,
  };
  const room = {
    id: 'room',
    serverEpoch: 'epoch',
    artifactId: 'artifact',
    matchId: null,
    status: 'lobby',
  };
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.close());
    wss.clients.forEach((ws) => ws.terminate());
    await new Promise((r) => wss.close(r));
    await new Promise((r) => server.close(r));
  });
  const until = async (check) => {
    for (let n = 0; n < 100; n++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw Error('diagnostic not delivered');
  };
  const messages = [];
  const denied = new PlayClient(credentials, room, (m) => messages.push(m));
  clients.push(denied);
  denied.connect();
  await until(() => messages.some((m) => m.type === 'error'));
  assert.equal(
    messages.find((m) => m.type === 'error').failure.code,
    'GC-MP-008',
  );
  assert.equal(denied.timer, undefined);
  rejected = false;
  const repeated = [];
  const stalled = new PlayClient(credentials, room, (m) => repeated.push(m));
  clients.push(stalled);
  wss.once('connection', (ws) =>
    ws.once('message', () => {
      stalled.failures = 6;
      ws.terminate();
    }),
  );
  stalled.connect();
  await until(() => repeated.some((m) => m.code === 'GC-MP-024'));
  assert.equal(stalled.stopped, true);
  assert.equal(stalled.timer, undefined);
  assert(!JSON.stringify(repeated).includes(privateText));
  const silent = [];
  const connectedButSilent = new PlayClient(credentials, room, (m) =>
    silent.push(m),
  );
  clients.push(connectedButSilent);
  connectedButSilent.connect();
  await until(() => silent.some((m) => m.type === 'connection' && m.connected));
  connectedButSilent.checkLiveness(connectedButSilent.openedAt + 9000);
  await until(() =>
    silent.some((m) => m.type === 'connection' && !m.connected),
  );
  assert.equal(
    silent.find((m) => m.type === 'connection' && !m.connected).failure.code,
    'GC-MP-006',
  );
});
