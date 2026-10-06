import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  AppUpdateController,
  releaseRepository,
  updateFeed,
  updateBlockers,
} from '../src/app-update.ts';

test('shipping repository configuration produces the intended GitHub Releases feed', () => {
  const config = JSON.parse(
    readFileSync(new URL('../update-config.json', import.meta.url), 'utf8'),
  );
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const repository = releaseRepository(config);
  assert.equal(repository, 'sehyeok3406/game-jam-dev');
  assert.equal(
    updateFeed(repository, 'x64', version),
    `https://update.electronjs.org/sehyeok3406/game-jam-dev/win32-x64/${version}`,
  );
});

function fixture(overrides = {}) {
  const events = new EventEmitter();
  const calls = {
    feed: [],
    checks: 0,
    installs: 0,
    released: 0,
    prepared: 0,
    changed: [],
  };
  const options = {
    updater: Object.assign(events, {
      setFeedURL: ({ url }) => calls.feed.push(url),
      checkForUpdates: () => {
        calls.checks++;
      },
      quitAndInstall: () => {
        calls.installs++;
      },
    }),
    repository: { owner: 'example-user', repository: 'game-canvas' },
    version: '0.9.1',
    arch: 'x64',
    available: true,
    unavailableReason: '개발 실행',
    automatic: true,
    persistAutomatic: async () => {},
    blockers: async () => [],
    prepareRestart: async () => {
      calls.prepared++;
      return [];
    },
    releaseRestart: () => {
      calls.released++;
    },
    confirmRestart: async () => true,
    changed: (state) => calls.changed.push(state),
    log: () => {},
    ...overrides,
  };
  const controller = new AppUpdateController(options);
  return { controller, events, calls, options };
}
test('missing repository is inert even when asked to check, start, or install', async () => {
  const { controller, calls } = fixture({
    repository: { owner: '', repository: '' },
  });
  controller.start();
  controller.check();
  await controller.install();
  assert.equal(controller.snapshot().status, 'unconfigured');
  assert.deepEqual(calls.feed, []);
  assert.equal(calls.checks, 0);
  assert.equal(calls.installs, 0);
  controller.dispose();
});
test('only validated immutable repositories and supported build targets form update URLs', () => {
  assert.equal(releaseRepository({ owner: '', repository: '' }), null);
  for (const repository of [
    { owner: '', repository: 'repo' },
    { owner: 'a/b', repository: 'repo' },
    { owner: 'a', repository: '..' },
    { owner: 'a', repository: 'repo?token=secret' },
  ])
    assert.throws(() => releaseRepository(repository));
  assert.equal(
    updateFeed('owner/game-canvas', 'x64', '0.9.1'),
    'https://update.electronjs.org/owner/game-canvas/win32-x64/0.9.1',
  );
  assert.throws(() => updateFeed('owner/repo/extra', 'x64', '0.9.1'));
  assert.throws(() => updateFeed('owner/repo', 'other', '0.9.1'));
  assert.throws(() => updateFeed('owner/repo', 'x64', 'not-a-version'));
});
test('development, portable, or test-user environments never call the updater', async () => {
  const { controller, calls } = fixture({ available: false });
  controller.start();
  controller.check();
  await controller.install();
  assert.equal(controller.snapshot().status, 'unavailable');
  assert.equal(calls.feed.length, 0);
  assert.equal(calls.checks, 0);
  controller.dispose();
});
test('check/download is single-flight, completion does not auto-restart, listeners clean up', async () => {
  const { controller, events, calls } = fixture();
  controller.check();
  controller.check();
  assert.equal(calls.checks, 1);
  events.emit('update-available');
  assert.equal(controller.snapshot().status, 'downloading');
  controller.check();
  assert.equal(calls.checks, 1);
  events.emit('update-downloaded', {}, '', 'v0.9.2');
  assert.equal(controller.snapshot().status, 'ready');
  assert.equal(controller.snapshot().releaseName, 'v0.9.2');
  assert.equal(calls.installs, 0);
  controller.check();
  assert.equal(calls.checks, 1);
  controller.dispose();
  assert.equal(events.eventNames().length, 0);
});
test('network failures have a dedicated code and retry goes to current', () => {
  const { controller, events, calls } = fixture();
  controller.check();
  events.emit('error', new Error('fixture error'));
  assert.equal(controller.snapshot().errorCode, 'GC-UPD-003');
  controller.check();
  assert.equal(calls.checks, 2);
  events.emit('update-not-available');
  assert.equal(controller.snapshot().status, 'current');
  assert.equal(controller.snapshot().errorCode, undefined);
  controller.dispose();
});
test('automatic preference saves serialize; failed saves preserve old preference', async () => {
  const saved = [];
  const { controller } = fixture({
    persistAutomatic: async (value) => {
      saved.push(value);
    },
  });
  await Promise.all([
    controller.setAutomatic(false),
    controller.setAutomatic(true),
  ]);
  assert.deepEqual(saved, [false, true]);
  assert.equal(controller.snapshot().automatic, true);
  await assert.rejects(controller.setAutomatic('yes'), /GC-UPD-001/);
  controller.dispose();
  const failed = fixture({
    persistAutomatic: async () => {
      throw new Error('disk full');
    },
  });
  await assert.rejects(failed.controller.setAutomatic(false), /GC-UPD-006/);
  assert.equal(failed.controller.snapshot().automatic, true);
  failed.controller.dispose();
});
test('AI, writes, offline collaboration, hosting guests and test windows block restart', async () => {
  for (const key of [
    'aiBusy',
    'pendingWrites',
    'disconnected',
    'hostingGuests',
    'testWindows',
  ]) {
    const reasons = updateBlockers({ [key]: true });
    assert.equal(reasons.length, 1);
    const { controller, events, calls } = fixture({
      blockers: async () => reasons,
    });
    events.emit('update-downloaded', {}, '', 'v0.9.2');
    await controller.install();
    assert.equal(calls.installs, 0);
    assert.equal(calls.prepared, 0);
    assert.equal(controller.snapshot().errorCode, 'GC-UPD-004');
    controller.dispose();
  }
});
test('cancelled restart never freezes the renderer or installs', async () => {
  const { controller, events, calls } = fixture({
    confirmRestart: async () => false,
  });
  events.emit('update-downloaded');
  await controller.install();
  assert.equal(calls.prepared, 0);
  assert.equal(calls.installs, 0);
  controller.dispose();
});
test('renderer edit blockers release the gate and permit a later safe retry', async () => {
  let dirty = true;
  const { controller, events, calls } = fixture({
    prepareRestart: async () => (dirty ? ['편집을 완료해주세요.'] : []),
  });
  events.emit('update-downloaded');
  await controller.install();
  assert.equal(calls.installs, 0);
  assert.equal(calls.released, 1);
  assert.equal(controller.snapshot().status, 'ready');
  dirty = false;
  await controller.install();
  assert.equal(calls.installs, 1);
  assert.equal(controller.snapshot().status, 'installing');
  controller.dispose();
});
test('new activity during restart confirmation is caught by the second main-process check', async () => {
  let busy = false;
  const { controller, events, calls } = fixture({
    blockers: async () => (busy ? ['저장 중'] : []),
    confirmRestart: async () => {
      busy = true;
      return true;
    },
  });
  events.emit('update-downloaded');
  await controller.install();
  assert.equal(calls.installs, 0);
  assert.equal(calls.released, 1);
  controller.dispose();
});
test('double-click install stays single-flight and native failure releases input protection', async () => {
  let resolveConfirmation;
  const confirmed = new Promise((resolve) => {
    resolveConfirmation = resolve;
  });
  const { controller, events, calls } = fixture({
    confirmRestart: () => confirmed,
  });
  events.emit('update-downloaded');
  const first = controller.install();
  await controller.install();
  resolveConfirmation(true);
  await first;
  assert.equal(calls.installs, 1);
  controller.dispose();
  const failure = fixture();
  failure.options.updater.quitAndInstall = () => {
    throw new Error('fixture native error');
  };
  failure.events.emit('update-downloaded');
  await failure.controller.install();
  assert.equal(failure.controller.snapshot().errorCode, 'GC-UPD-005');
  assert.equal(failure.calls.released, 1);
  failure.controller.dispose();
});

test('asynchronous native install error also releases renderer input protection', async () => {
  const { controller, events, calls } = fixture();
  events.emit('update-downloaded');
  await controller.install();
  events.emit('error', new Error('async install failed'));
  assert.equal(controller.snapshot().status, 'ready');
  assert.equal(controller.snapshot().errorCode, 'GC-UPD-005');
  assert.equal(calls.released, 1);
  controller.dispose();
});

test('automatic checks wait for first-run lock, repeat every six hours and stop when disabled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { controller, events, calls } = fixture();
  controller.start();
  t.mock.timers.tick(29_999);
  assert.equal(calls.checks, 0);
  t.mock.timers.tick(1);
  assert.equal(calls.checks, 1);
  events.emit('update-not-available');
  t.mock.timers.tick(6 * 60 * 60 * 1000 - 30_000);
  assert.equal(calls.checks, 2);
  events.emit('update-not-available');
  await controller.setAutomatic(false);
  t.mock.timers.tick(12 * 60 * 60 * 1000);
  assert.equal(calls.checks, 2);
  controller.dispose();
});
