import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presentWindow } from '../src/window-presentation.ts';

function windowFixture(showWorks = true) {
  const events = [];
  let visible = false;
  return {
    events,
    isDestroyed: () => false,
    isVisible: () => visible,
    show: () => {
      events.push('show');
      visible = showWorks;
    },
    setSkipTaskbar: (skip) => events.push(['taskbar', skip]),
  };
}

test('presentation waits for page loading and then shows a taskbar window', async () => {
  const window = windowFixture();
  let finish;
  const loaded = new Promise((resolve) => {
    finish = resolve;
  });
  const ready = presentWindow(window, () => loaded);
  assert.equal(window.isVisible(), false);
  assert.deepEqual(window.events, []);
  finish();
  await ready;
  assert.deepEqual(window.events, [['taskbar', false], 'show']);
  assert.equal(window.isVisible(), true);
});

test('failed loading is never reported as a visible/ready window', async () => {
  const window = windowFixture();
  await assert.rejects(
    presentWindow(window, async () => {
      throw new Error('renderer file missing');
    }),
    (error) =>
      error.code === 'GC-TEST-002' &&
      error.message.includes('renderer file missing'),
  );
  assert.deepEqual(window.events, []);
});

test('a created but hidden window fails presentation with a specific error code', async () => {
  const window = windowFixture(false);
  await assert.rejects(
    presentWindow(window, async () => {}),
    (error) =>
      error.code === 'GC-TEST-002' &&
      error.message.includes('표시되지 않았습니다'),
  );
});

test('a window closed during startup cannot succeed or be shown again', async () => {
  const window = windowFixture();
  window.isDestroyed = () => true;
  await assert.rejects(
    presentWindow(window, async () => {}),
    (error) =>
      error.code === 'GC-TEST-002' && error.message.includes('닫혔습니다'),
  );
  assert.deepEqual(window.events, []);
});
