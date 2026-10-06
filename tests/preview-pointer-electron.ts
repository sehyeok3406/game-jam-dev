import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import {
  installPreviewPermissions,
  PREVIEW_SANDBOX,
} from '../src/preview-permissions';
import { withPreviewKeyboardBridge } from '../src/preview-window';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  app.setPath(
    'userData',
    await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-pointer-test-')),
  );
  await app.whenReady();
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'preview-pointer-test',
    },
  });
  const messages: string[] = [];
  win.webContents.on('console-message', (details) => {
    if (/pointer|fullscreen/i.test(details.message))
      messages.push(details.message);
  });
  installPreviewPermissions(win);
  const watchdog = setTimeout(() => {
    win.destroy();
    console.error('Pointer test timed out');
    app.exit(1);
  }, 15_000);
  const game = withPreviewKeyboardBridge(
    `<body style="margin:0"><canvas id="view" width="800" height="600"></canvas><script>
    window.bootId=Math.random();window.turn=0;
    document.addEventListener('mousemove',e=>{if(document.pointerLockElement)turn+=e.movementX});
    window.capture=()=>document.querySelector('canvas').requestPointerLock().then(()=>true,()=>false);
  </script></body>`,
    'test-card',
  );
  const wrapper = `<body style="margin:0"><button id="fs" style="height:40px;width:160px">Fullscreen</button><section class="preview-card" id="card"><iframe id="game" sandbox="${PREVIEW_SANDBOX}" style="width:800px;height:600px;border:0"></iframe></section><script>document.querySelector('iframe').srcdoc=${JSON.stringify(game).replaceAll('<', '\\u003c')};document.querySelector('#fs').onclick=()=>document.querySelector('#card').requestFullscreen();</script>`;
  try {
    await win.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(wrapper),
    );
    await wait(200);
    win.focus();
    await wait(500);
    const frame = win.webContents.mainFrame.frames[0];
    const boot = await frame.executeJavaScript('bootId');
    await win.webContents.executeJavaScript(
      "document.querySelector('iframe').focus()",
      true,
    );
    assert.equal(
      await frame.executeJavaScript('capture()', true),
      false,
      'windowed capture must be denied',
    );
    console.log(
      'PASS: actual Chromium denies pointer lock in the ordinary canvas',
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('#card').requestFullscreen().then(()=>console.log('fullscreen resolved'),e=>console.log('fullscreen failed',e.message));void 0",
      true,
    );
    await wait(3000);
    assert.equal(
      await win.webContents.executeJavaScript('!!document.fullscreenElement'),
      true,
      'trusted toolbar click starts fullscreen',
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('iframe').focus()",
      true,
    );
    assert.equal(
      await frame.executeJavaScript('capture()', true),
      true,
      `fullscreen capture failed: ${messages.join('; ')}`,
    );
    assert.equal(
      await frame.executeJavaScript('!!document.pointerLockElement'),
      true,
    );
    const before = await frame.executeJavaScript('turn');
    // Electron's top-widget sendInputEvent does not emulate OS relative motion
    // into a pointer-locked OOP iframe. Test the relative-input listener using
    // a synthetic event, separately from the real Chromium permission above.
    await frame.executeJavaScript(
      "document.dispatchEvent(new MouseEvent('mousemove',{movementX:40,movementY:0}))",
    );
    assert.notEqual(
      await frame.executeJavaScript('turn'),
      before,
      'relative mouse motion reaches the locked game',
    );
    assert.equal(
      await frame.executeJavaScript('bootId'),
      boot,
      'fullscreen must not reload the game',
    );
    console.log(
      'PASS: real fullscreen lock and synthetic relative-input listener work without game reload',
    );
    await win.webContents.executeJavaScript('document.exitFullscreen()');
    await wait(150);
    assert.equal(
      await frame.executeJavaScript('!!document.pointerLockElement'),
      false,
      'exit releases native lock',
    );
    await win.webContents.executeJavaScript(
      "document.querySelector('iframe').focus()",
      true,
    );
    assert.equal(
      await frame.executeJavaScript('capture()', true),
      false,
      'windowed recapture remains denied',
    );
    assert.equal(await frame.executeJavaScript('bootId'), boot);
    console.log(
      'PASS: leaving fullscreen releases the mouse and blocks recapture; game state survives',
    );
  } finally {
    clearTimeout(watchdog);
    win.destroy();
  }
}
run().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
