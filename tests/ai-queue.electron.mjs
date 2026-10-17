import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.disableHardwareAcceleration();
app.setPath('userData', path.resolve('out/ai-queue-ui/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
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
      throw new Error(code, { cause: error });
    }
  };
  const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  const errors = [];
  win.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  async function wait(code) {
    for (let i = 0; i < 250; i++) {
      if (await js(code)) return;
      await pause();
    }
    throw new Error('Queue UI timeout: ' + code + '\n' + errors.join('\n'));
  }
  let code = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".document-card")');
    await js(`document.querySelector('[aria-label="AI 작업 패널"]').click()`);
    const tasks = await js(
      'Promise.all([qaQueue.enqueue(),qaQueue.enqueue(),qaQueue.enqueue()])',
    );
    await wait(
      'document.querySelectorAll(".ai-queue-panel li[data-status=queued]").length===2',
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="gamejam!"]').disabled`),
      false,
    );
    await wait('document.querySelectorAll("[data-ai-usage]").length>=2');
    assert.ok(
      await js(
        'Array.from(document.querySelectorAll(".ai-material-badge")).some(e=>e.textContent.includes("예약 2"))',
      ),
    );
    const boxShadow = await js(
      'getComputedStyle(document.querySelector("[data-ai-usage]")).boxShadow',
    );
    assert.notEqual(boxShadow, 'none');
    await fs.mkdir('out/ai-queue-ui', { recursive: true });
    for (const theme of ['dark', 'light']) {
      await js(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await pause(220);
      await fs.writeFile(
        `out/ai-queue-ui/queue-${theme}.png`,
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    await js(`qaQueue.api.cancelQueuedTask(${JSON.stringify(tasks[1].runId)})`);
    await wait(
      'document.querySelectorAll(".ai-queue-panel li[data-status=queued]").length===1',
    );
    await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
    await wait('!!document.querySelector(".ai-request-dialog")');
    await js(
      'document.querySelector(".ai-request-dialog > header button").click()',
    );
    await wait('!document.querySelector(".ai-request-dialog")');
    await wait(
      'document.querySelectorAll(".ai-queue-panel li[data-status=completed]").length===2',
    );
    await wait('document.querySelectorAll("[data-ai-usage]").length===0');
    assert.equal(
      errors.filter((message) =>
        /Maximum update depth|Uncaught|TypeError/.test(message),
      ).length,
      0,
      errors.join('\n'),
    );
    console.log(
      'PASS: Electron UI shows shared material glow/counts, permits another Game Jam request, cancels one reservation and removes protection after completion',
    );
  } catch (error) {
    code = 1;
    console.error(error);
    await fs.mkdir('out/ai-queue-ui', { recursive: true });
    await fs.writeFile(
      'out/ai-queue-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
  } finally {
    win.destroy();
    app.exit(code);
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
