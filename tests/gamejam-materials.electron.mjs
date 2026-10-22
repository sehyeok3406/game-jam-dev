import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { verifyMaterials } from './gamejam-materials.scenario.mjs';
app.disableHardwareAcceleration();
app.setPath('userData', path.resolve('out/gamejam-materials/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      throw new Error('UI expression: ' + code, { cause: error });
    }
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await pause(50);
    }
    throw Error('Timeout: ' + code);
  };
  const key = async (event) => {
    await js(
      `window.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ ...event, bubbles: true, cancelable: true })}))`,
    );
    await pause(60);
  };
  const pointer = (type, p) =>
    win.webContents.sendInputEvent({
      type,
      ...p,
      button: 'left',
      clickCount: 1,
    });
  const mouse = async (type, a, b) => {
    pointer('mouseMove', a);
    pointer('mouseDown', a);
    if (type === 'drag') {
      for (let i = 1; i <= 12; i++) {
        pointer('mouseMove', {
          x: Math.round(a.x + ((b.x - a.x) * i) / 12),
          y: Math.round(a.y + ((b.y - a.y) * i) / 12),
        });
        await pause(20);
      }
    }
    pointer('mouseUp', b ?? a);
    await pause(100);
  };
  let code = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear();sessionStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await fs.mkdir('out/gamejam-materials', { recursive: true });
    await verifyMaterials({
      js,
      key,
      mouse,
      wait,
      capture: async (name) =>
        fs.writeFile(
          `out/gamejam-materials/${name}.png`,
          (await win.webContents.capturePage()).toPNG(),
        ),
    });
  } catch (error) {
    code = 1;
    console.error(error);
    console.error(await js('document.body.innerText.slice(-4000)'));
    await fs.writeFile(
      'out/gamejam-materials/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
  } finally {
    win.destroy();
    app.exit(code);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
