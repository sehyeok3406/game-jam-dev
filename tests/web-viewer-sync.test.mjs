import test from 'node:test';
import assert from 'node:assert/strict';
import { startWebViewerSync } from '../src/web-viewer-sync.ts';

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('opening the app publishes immediately, then updates every 15 seconds and stops on exit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let publications = 0;
  const stop = startWebViewerSync({
    settings: async () => ({}),
    publish: async () => {
      publications++;
    },
  });
  await flush();
  assert.equal(publications, 1);
  t.mock.timers.tick(14_999);
  await flush();
  assert.equal(publications, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(publications, 2);
  stop();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(publications, 2);
});
test('missing setup stays private, and configuring it later starts publication without restarting the app', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let configured = false,
    publications = 0;
  const stop = startWebViewerSync({
    settings: async () => (configured ? {} : null),
    publish: async () => {
      publications++;
    },
  });
  t.after(stop);
  await flush();
  assert.equal(publications, 0);
  configured = true;
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(publications, 1);
});
test('failed publications retry automatically and slow publications never overlap', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0,
    finish;
  const stop = startWebViewerSync({
    settings: async () => ({}),
    publish: async () => {
      attempts++;
      if (attempts === 1) throw new Error('temporary transport failure');
      await new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  t.after(stop);
  await flush();
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(attempts, 2);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(attempts, 2);
  stop();
  finish();
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(attempts, 2);
});
