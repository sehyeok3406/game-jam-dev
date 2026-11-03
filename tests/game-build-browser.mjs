// Explicit Windows Chrome/Edge check of the exported single file; isolated browser profiles.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
const html = path.resolve(
  process.argv[2] ?? 'out/game-build-stage4/build-three.html',
);
await fs.access(html);
const expectedLives = process.argv[3] ?? '7';
const evidenceDirectory = path.dirname(html);
const parent = await fs.realpath(os.tmpdir()),
  root = await fs.mkdtemp(path.join(parent, 'gamejam-build-browser-'));
const evidence = [];
const pause = () => new Promise((r) => setTimeout(r, 100));
try {
  for (const [name, executable] of [
    ['Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
    ['Edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
  ]) {
    const profile = path.join(root, name);
    await fs.mkdir(profile);
    const child = spawn(
      executable,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        `--user-data-dir=${profile}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        'about:blank',
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] },
    );
    let ws;
    try {
      let port;
      for (let n = 0; n < 100; n++) {
        try {
          port = Number(
            (
              await fs.readFile(
                path.join(profile, 'DevToolsActivePort'),
                'utf8',
              )
            ).split('\n')[0],
          );
          break;
        } catch {}
        await pause();
      }
      assert.ok(port, name + ' did not start');
      const target = (
        await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      ).find((t) => t.type === 'page');
      ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        ws.addEventListener('open', r, { once: true });
        ws.addEventListener('error', j, { once: true });
      });
      let sequence = 0;
      const pending = new Map(),
        errors = [],
        network = [];
      ws.addEventListener('message', ({ data }) => {
        const m = JSON.parse(String(data));
        if (m.id) {
          const p = pending.get(m.id);
          if (p) {
            pending.delete(m.id);
            if (m.error) p.reject(Error(JSON.stringify(m.error)));
            else p.resolve(m.result);
          }
        } else if (m.method === 'Runtime.exceptionThrown')
          errors.push(
            m.params.exceptionDetails.exception?.description ??
              m.params.exceptionDetails.text,
          );
        else if (
          m.method === 'Runtime.consoleAPICalled' &&
          m.params.type === 'error'
        )
          errors.push(m.params.args.map((a) => a.value).join(' '));
        else if (
          m.method === 'Network.requestWillBeSent' &&
          !/^(?:file|data|blob|about):/.test(m.params.request.url)
        )
          network.push(m.params.request.url);
      });
      ws.addEventListener('close', () => {
        for (const p of pending.values()) p.reject(Error('browser closed'));
        pending.clear();
      });
      const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });
      const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      await send('Runtime.enable');
      await send('Network.enable');
      await send('Page.enable');
      await send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 650,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Page.navigate', { url: pathToFileURL(html).href });
      let state;
      for (let n = 0; n < 100; n++) {
        state = await evaluate(
          `({ready:document.readyState,lives:document.body?.dataset.lives,image:document.querySelector('#hero')?.naturalWidth,canvas:!!document.querySelector('canvas')})`,
        );
        if (
          state.ready === 'complete' &&
          state.lives === expectedLives &&
          state.image > 0
        )
          break;
        await pause();
      }
      assert.equal(state.lives, expectedLives, JSON.stringify(errors));
      assert.ok(state.image > 0);
      assert.equal(state.canvas, true);
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
      const before = await evaluate(
        `Array.from(document.querySelector('canvas').getContext('2d').getImageData(92,150,1,1).data)`,
      );
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'ArrowRight',
        code: 'ArrowRight',
        windowsVirtualKeyCode: 39,
      });
      const after = await evaluate(
        `Array.from(document.querySelector('canvas').getContext('2d').getImageData(92,150,1,1).data)`,
      );
      assert.notDeepEqual(after, before);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(
        path.join(evidenceDirectory, `${name.toLowerCase()}.png`),
        Buffer.from(shot.data, 'base64'),
      );
      evidence.push({
        browser: name,
        file: path.basename(html),
        state,
        externalRequests: network.length,
        errors: errors.length,
        keyboardChangedCanvas: true,
      });
      console.log(
        'PASS:',
        name,
        'file:// standalone startup, original image decode, keyboard movement, zero external page requests',
      );
      await send('Browser.close').catch(() => {});
    } finally {
      ws?.close();
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once('exit', r));
        await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
        if (child.exitCode === null) {
          child.kill();
          await exited;
        }
      }
    }
  }
  await fs.writeFile(
    path.join(evidenceDirectory, 'browser-evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
} finally {
  assert.equal(path.dirname(root), parent);
  assert.equal((await fs.lstat(root)).isSymbolicLink(), false);
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
