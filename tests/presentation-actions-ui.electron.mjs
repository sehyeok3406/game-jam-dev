import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
import { presentationUiScenarios } from './presentation-ui-scenarios.mjs';
app.setPath(
  'userData',
  path.resolve('out/presentation-actions-ui/profiles', randomUUID()),
);
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
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  async function wait(code) {
    for (let n = 0; n < 200; n++) {
      if (await js(code)) return;
      await pause(60);
    }
    throw Error('Timeout: ' + code);
  }
  async function key(keyCode, modifiers = []) {
    for (const type of ['keyDown', 'keyUp'])
      win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await pause(50);
  }
  let exitCode = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear();sessionStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector("[data-plugin-launcher]")');
    await presentationUiScenarios({
      js,
      key,
      wait,
      pointer: async (type, point) => {
        win.webContents.sendInputEvent({
          type,
          ...point,
          button: 'left',
          clickCount: 1,
        });
      },
      screenshot: async (name) => {
        await pause(300);
        await fs.mkdir('out/presentation-actions-ui', { recursive: true });
        await fs.writeFile(
          `out/presentation-actions-ui/${name}.png`,
          (await win.webContents.capturePage()).toPNG(),
        );
      },
    });
  } catch (error) {
    console.error(error);
    console.error(
      await js(
        `({notice:document.querySelector('.status-toast')?.textContent,dialog:document.querySelector('[aria-modal=true]')?.textContent})`,
      ),
    );
    exitCode = 1;
  } finally {
    win.destroy();
    app.exit(exitCode);
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
