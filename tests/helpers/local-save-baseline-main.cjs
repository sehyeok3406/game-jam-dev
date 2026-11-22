const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const { app, ipcMain } = require('electron');

const clock = () => performance.timeOrigin + performance.now();
const project = process.env.GC_BASELINE_PROJECT;
const profile = process.env.GC_BASELINE_PROFILE;
const tracePath = process.env.GC_BASELINE_TRACE;
const pauseAfterRename = process.env.GC_RECOVERY_PAUSE_AFTER_RENAME;
const recoverySignal = process.env.GC_RECOVERY_SIGNAL;
if (!project || !profile || !tracePath)
  throw Error('Baseline paths are required');

const events = [];
const channels = new AsyncLocalStorage();
for (const method of ['readFile', 'readdir', 'writeFile', 'rename', 'rm']) {
  const run = fs.promises[method];
  fs.promises[method] = async function (filename, ...args) {
    let scope;
    let relative;
    let destination;
    if (typeof filename === 'string') {
      for (const [label, root] of [
        ['project', project],
        ['profile', profile],
      ]) {
        const candidate = path.relative(root, filename);
        if (
          !path.isAbsolute(candidate) &&
          candidate !== '..' &&
          !candidate.startsWith('..' + path.sep)
        ) {
          scope = label;
          relative = candidate.replaceAll('\\', '/');
          if (method === 'rename' && typeof args[0] === 'string')
            destination = path.relative(root, args[0]).replaceAll('\\', '/');
          break;
        }
      }
    }
    if (!scope) return run.call(this, filename, ...args);
    const start = clock();
    try {
      const result = await run.call(this, filename, ...args);
      if (
        method === 'rename' &&
        scope === 'project' &&
        recoverySignal &&
        destination === pauseAfterRename
      ) {
        fs.writeFileSync(recoverySignal, 'original replaced');
        await new Promise(() => {});
      }
      events.push({
        method,
        scope,
        path: relative,
        destination,
        caller: channels.getStore(),
        start,
        end: clock(),
        ok: true,
      });
      return result;
    } catch (error) {
      events.push({
        method,
        scope,
        path: relative,
        start,
        end: clock(),
        ok: false,
      });
      throw error;
    }
  };
}
syncBuiltinESMExports();

const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  handle(channel, (...args) =>
    channels.run(channel, async () => {
      const start = clock();
      try {
        const result = await listener(...args);
        events.push({ channel, start, end: clock(), ok: true });
        return result;
      } catch (error) {
        events.push({ channel, start, end: clock(), ok: false });
        throw error;
      }
    }),
  );

app.on('will-quit', () => fs.writeFileSync(tracePath, JSON.stringify(events)));
require('./.vite/build/main.cjs');
