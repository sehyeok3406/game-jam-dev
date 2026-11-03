import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
import { validateHtml } from '../../src/html-validation.ts';
import { htmlReferences } from '../../src/html-references.ts';
import { validateMultiplayerHtml } from '../../src/multiplayer/contract.ts';
import { withMultiplayerSdk } from '../../src/multiplayer/sdk.ts';
import { withPreviewKeyboardBridge } from '../../src/preview-window.ts';
import { PREVIEW_SANDBOX } from '../../src/preview-permissions.ts';
import { checkSnapshot } from '../../src/collaboration-model.ts';
import { inspectImportedHtml } from '../../src/html-source.ts';

app.setPath('userData', process.env.GAMEJAM_STAGE0_PROFILE);
app.on('window-all-closed', () => {});
const input = JSON.parse(
  readFileSync(process.env.GAMEJAM_STAGE0_INPUT, 'utf8'),
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dataUrl = (html) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
const windows = new Set();
const outcomes = [];

function windowFor() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: `stage0-${randomUUID()}`,
    },
  });
  windows.add(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_c, _p, done) =>
    done(false),
  );
  return window;
}

async function observe(item, mode) {
  const window = windowFor();
  const errors = [],
    blocked = [];
  window.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') errors.push(message.slice(0, 1000));
  });
  window.webContents.session.webRequest.onBeforeRequest((details, done) => {
    const cancel = !['data:', 'blob:', 'about:'].some((prefix) =>
      details.url.startsWith(prefix),
    );
    if (cancel) blocked.push(details.resourceType);
    done({ cancel });
  });
  try {
    const id = `stage0-${item.id}`;
    const source = withPreviewKeyboardBridge(
      withMultiplayerSdk(await fs.readFile(item.file, 'utf8'), 'solo', id),
      id,
    );
    const relay = `<script>setInterval(()=>{const value=window.__stage0||(window.GameJamMultiplayer?{ready:document.querySelector('#score')?.textContent.includes('혼자 연습'),moves:0,errors:[]}:null);if(value)parent.postMessage({type:'stage0',value},'*');},60);</script>`;
    const parentScript = `<script>addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&e.data?.type==='stage0')window.__observed=e.data.value});</script>`;
    const policy =
      mode === 'player-policy'
        ? `<meta http-equiv="Content-Security-Policy" content="${input.playerCsp}">`
        : '';
    const wrapped = `<!doctype html><html><head>${policy}</head><body>${parentScript}<iframe sandbox="${PREVIEW_SANDBOX}"></iframe></body></html>`;
    await window.loadURL(dataUrl(wrapped));
    // The real app assigns srcDoc to an existing iframe, rather than encoding
    // the entire game into the parent navigation URL.
    await window.webContents.executeJavaScript(
      `document.querySelector('iframe').srcdoc=${JSON.stringify(source + relay)};void 0;`,
    );
    let observed;
    for (let n = 0; n < 70; n++) {
      observed =
        await window.webContents.executeJavaScript('window.__observed');
      if (observed?.ready || observed?.errors?.length || errors.length) break;
      await pause(100);
    }
    return {
      id: item.id,
      mode,
      ok:
        !!observed?.ready &&
        observed.render?.nonBlank !== false &&
        !observed.errors.length &&
        !errors.length &&
        !blocked.length,
      observed,
      errors,
      blocked,
    };
  } finally {
    windows.delete(window);
    if (!window.isDestroyed()) window.destroy();
  }
}

async function limits() {
  const rows = [];
  for (const bytes of [7_900_000, 8_100_000, 16_000_000]) {
    const prefix = '<!doctype html><html><body>limit sample</body><!--';
    const html =
      prefix +
      'x'.repeat(bytes - Buffer.byteLength(prefix) - 10) +
      '--></html>';
    const result = {
      requestedBytes: bytes,
      actualBytes: Buffer.byteLength(html),
    };
    try {
      inspectImportedHtml(html, 'limit.html');
      result.import = true;
    } catch (error) {
      result.import = false;
      result.importError = error.message;
    }
    try {
      checkSnapshot({ 'output/index.html': html });
      result.shared = true;
    } catch (error) {
      result.shared = false;
      result.sharedError = error.message;
    }
    const window = windowFor();
    const before = performance.now();
    try {
      await window.loadURL(dataUrl(html));
      result.rendererLoaded = true;
      result.loadMs = Math.round(performance.now() - before);
    } catch (error) {
      result.rendererLoaded = false;
      result.rendererError = error.message.slice(0, 500);
    }
    try {
      const started = performance.now();
      await window.loadURL(
        dataUrl(
          '<html><body><iframe sandbox="allow-scripts"></iframe><script>onmessage=e=>{if(e.source===document.querySelector("iframe").contentWindow)window.__size=e.data}</script></body></html>',
        ),
      );
      const child =
        html +
        '<script>parent.postMessage({ready:document.body.textContent.includes("limit sample")},"*")</script>';
      await window.webContents.executeJavaScript(
        `document.querySelector('iframe').srcdoc=${JSON.stringify(child)};void 0;`,
      );
      for (let n = 0; n < 50; n++) {
        result.srcdocLoaded = !!(
          await window.webContents.executeJavaScript('window.__size')
        )?.ready;
        if (result.srcdocLoaded) break;
        await pause(50);
      }
      result.srcdocMs = Math.round(performance.now() - started);
      result.rendererMemoryKb = app
        .getAppMetrics()
        .find(
          (item) => item.pid === window.webContents.getOSProcessId(),
        )?.memory;
    } catch (error) {
      result.srcdocLoaded = false;
      result.srcdocError = error.message.slice(0, 500);
    } finally {
      windows.delete(window);
      window.destroy();
    }
    rows.push(result);
  }
  return rows;
}

app.whenReady().then(async () => {
  try {
    const gpu = await app.getGPUInfo('basic');
    for (const item of input.cases) {
      const content = await fs.readFile(item.file, 'utf8');
      const start = performance.now();
      const references = htmlReferences(content, 'html');
      const staticMs = Math.round(performance.now() - start);
      let multiplayerContract;
      try {
        validateMultiplayerHtml(content);
        multiplayerContract = { ok: true };
      } catch (error) {
        multiplayerContract = { ok: false, error: error.message };
      }
      try {
        await validateHtml(content, item.id);
        outcomes.push({
          id: item.id,
          mode: 'production-validator',
          ok: true,
          references,
          staticMs,
          multiplayerContract,
        });
      } catch (error) {
        outcomes.push({
          id: item.id,
          mode: 'production-validator',
          ok: false,
          error: error.message.slice(0, 600),
          code: error.code,
          references,
          staticMs,
          multiplayerContract,
        });
      }
      for (const mode of ['preview-policy', 'player-policy'])
        outcomes.push(await observe(item, mode));
      console.log(`stage0 electron: ${item.id}`);
    }
    const result = {
      versions: process.versions,
      gpu,
      outcomes,
      limits: await limits(),
      memory: process.memoryUsage(),
    };
    await fs.writeFile(input.electronResult, JSON.stringify(result, null, 2));
    app.exit(0);
  } catch (error) {
    await fs.writeFile(
      input.electronResult,
      JSON.stringify({ error: error.stack, outcomes }, null, 2),
    );
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    app.exit(1);
  }
});
