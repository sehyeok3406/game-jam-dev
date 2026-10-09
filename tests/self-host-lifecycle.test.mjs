import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'vite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
await build({
  configFile: false,
  logLevel: 'error',
  resolve: {
    alias: { electron: path.resolve('tests/self-host-lifecycle-mock.ts') },
  },
  build: {
    ssr: 'tests/self-host-lifecycle.fixture.ts',
    outDir: 'out/test-self-host-lifecycle',
    rollupOptions: { output: { format: 'es', entryFileNames: 'fixture.mjs' } },
  },
});
const { SelfHostLifecycle, replies, boxes, trays } = await import(
  pathToFileURL(path.resolve('out/test-self-host-lifecycle/fixture.mjs'))
);
const wait = async (condition) => {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Lifecycle did not complete');
};
function fixture(t, options = {}) {
  replies.length = 0;
  boxes.length = 0;
  trays.length = 0;
  const calls = [];
  const service = {
    state: {
      stage: 'ready',
      closeBehavior: options.choice ?? 'ask',
      checks: {
        runtimeValid: true,
        serverOwnership: 'owned',
        tunnelOwnership: 'owned',
      },
    },
    run: async (action) => {
      calls.push(action);
      if (action === 'stop') {
        if (options.ai)
          service.state = {
            ...service.state,
            stage: 'problem',
            message: 'AI 작업 중',
          };
        else
          service.state = {
            ...service.state,
            stage: 'off',
            checks: {
              runtimeValid: true,
              serverOwnership: 'absent',
              tunnelOwnership: 'absent',
            },
          };
      }
      return service.state;
    },
    setCloseBehavior: async (choice) => {
      calls.push(`choice:${choice}`);
      service.state.closeBehavior = choice;
    },
  };
  const window = Object.assign(new EventEmitter(), {
    visible: true,
    destroyed: false,
    isDestroyed: () => window.destroyed,
    hide: () => {
      window.visible = false;
    },
    show: () => {
      window.visible = true;
    },
    focus: () => {},
    close: () => {
      window.destroyed = true;
    },
    webContents: { send: (event) => calls.push(event) },
  });
  let retained = 0;
  const lifecycle = new SelfHostLifecycle(
    service,
    'fixture.ico',
    () => !!options.update,
  );
  lifecycle.attach(window, () => retained++);
  t.after(() => lifecycle.dispose());
  const close = (defaultPrevented = false) => {
    const event = {
      defaultPrevented,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    window.emit('close', event);
    return event;
  };
  return { lifecycle, service, window, calls, close, retained: () => retained };
}
test('background close remembers the selection, preserves the server and opens management from tray', async (t) => {
  const f = fixture(t);
  replies.push({ response: 0, checkboxChecked: true });
  assert.equal(f.close().defaultPrevented, true);
  await wait(() => f.retained() === 1);
  assert.equal(f.window.visible, false);
  assert.equal(f.window.destroyed, false);
  assert.deepEqual(f.calls, ['check', 'choice:background']);
  trays[0].menu.find((item) => item.label === '서버 상태 및 관리').click();
  assert.equal(f.window.visible, true);
  assert.ok(f.calls.includes('self-host:open'));
});
test('cancelled close resets the retained-window draft lifecycle without stopping the server', async (t) => {
  const f = fixture(t);
  replies.push({ response: 2 });
  f.close();
  await wait(() => f.retained() === 1);
  assert.equal(f.window.visible, true);
  assert.equal(f.window.destroyed, false);
  assert.deepEqual(f.calls, ['check']);
});
test('an AI stop refusal keeps the window and server management available', async (t) => {
  const f = fixture(t, { choice: 'stop', ai: true });
  replies.push({ response: 0 }, { response: 0 });
  f.close();
  await wait(() => f.retained() === 1);
  assert.equal(f.window.destroyed, false);
  assert.deepEqual(f.calls, ['check', 'stop']);
  assert.equal(boxes.length, 2);
});
test('tray stop closes only after stop succeeds and preserves the saved background choice', async (t) => {
  const f = fixture(t, { choice: 'background' });
  f.close();
  await wait(() => f.retained() === 1);
  replies.push({ response: 0 });
  trays[0].menu.find((item) => item.label === '서버 종료 후 앱 닫기').click();
  await wait(() => f.window.destroyed);
  assert.equal(f.service.state.closeBehavior, 'background');
  assert.deepEqual(f.calls, ['check', 'self-host:open', 'stop']);
});
test('draft flush prevention and approved app updates bypass the host close dialog', async (t) => {
  const f = fixture(t);
  f.close(true);
  assert.deepEqual(f.calls, []);
  const update = fixture(t, { update: true });
  assert.equal(update.close().defaultPrevented, false);
  assert.deepEqual(update.calls, []);
});
test('closing with no managed processes does not prompt or stop unrelated processes', async (t) => {
  const f = fixture(t);
  f.service.state.checks = {
    runtimeValid: true,
    serverOwnership: 'absent',
    tunnelOwnership: 'absent',
  };
  f.close();
  await wait(() => f.window.destroyed);
  assert.equal(boxes.length, 0);
  assert.deepEqual(f.calls, ['check']);
});
