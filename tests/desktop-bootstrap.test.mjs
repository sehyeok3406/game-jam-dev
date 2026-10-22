import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

test('desktop bootstrap creates services once, restarts only its sync loop and attempts every cleanup after errors', async (t) => {
  const directory = path.resolve('out', `bootstrap-service-${randomUUID()}`);
  assert.equal(path.dirname(directory), path.resolve('out'));
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: 'src/desktop/bootstrap.ts',
      outDir: directory,
      rolldownOptions: {
        output: {
          format: 'es',
          entryFileNames: 'bootstrap.mjs',
          chunkFileNames: '[name]-[hash].mjs',
        },
      },
    },
  });
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const { DesktopBootstrap } = await import(
    pathToFileURL(path.join(directory, 'bootstrap.mjs')).href
  );
  const events = [],
    calls = { viewer: 0, updates: 0, host: 0 };
  const failure = Error('tray disposal failure');
  const viewer = {};
  const updates = { dispose: () => events.push('updates') };
  const feature = {
    lifecycle: {
      dispose: () => {
        events.push('host');
        throw failure;
      },
    },
  };
  const bootstrap = new DesktopBootstrap(
    () => 'isolated-profile',
    {},
    {
      viewer: () => {
        calls.viewer++;
        return viewer;
      },
      updates: () => {
        calls.updates++;
        return updates;
      },
      host: async () => {
        calls.host++;
        return feature;
      },
      sync: (target) => {
        assert.equal(target, viewer);
        events.push('sync-start');
        return () => events.push('sync-stop');
      },
    },
  );
  assert.equal(bootstrap.webViewer(), bootstrap.webViewer());
  assert.equal(bootstrap.appUpdates({}), bootstrap.appUpdates({}));
  const [one, two] = await Promise.all([
    bootstrap.selfHost({}),
    bootstrap.selfHost({}),
  ]);
  assert.equal(one, two);
  bootstrap.startViewer();
  bootstrap.startViewer();
  assert.deepEqual(calls, { viewer: 1, updates: 1, host: 1 });
  assert.deepEqual(bootstrap.dispose(), [failure]);
  assert.deepEqual(events, [
    'sync-start',
    'sync-stop',
    'sync-start',
    'host',
    'sync-stop',
    'updates',
  ]);
  assert.deepEqual(bootstrap.dispose(), []);
});
