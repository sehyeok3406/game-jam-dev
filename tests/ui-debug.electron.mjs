import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/ui-debug-qa/profile'));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/ui-debug-qa', { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1050,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code, timeout = 12000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw Error('Timed out: ' + code);
  };
  const f12 = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F12' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F12' });
    await new Promise((resolve) => setTimeout(resolve, 80));
  };
  const select = (selector, value) =>
    js(
      `{const element=document.querySelector(${JSON.stringify(selector)}); element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
  const failures = [];
  let exitCode = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await f12();
    await wait('!!document.querySelector(".ui-debug-console[open]")');
    assert.equal(
      await js('document.querySelectorAll("[data-debug-entry=editor]").length'),
      0,
    );
    assert.equal(
      await js(
        'document.querySelectorAll("[data-debug-entry=home-create]").length',
      ),
      1,
    );
    const snapshot = await js('JSON.stringify({...localStorage})');
    const checkScope = async (scope) => {
      const entries = await js(
        `uiDebugQa.entries.filter(item=>item.scopes.includes(${JSON.stringify(scope)}))`,
      );
      for (const item of entries) {
        for (const state of item.states) {
          await js(
            `uiDebugQa.events=[];document.querySelector('[data-debug-entry="${item.id}"] button').click()`,
          );
          if (state !== item.states[0])
            await select('[aria-label="미리보기 상태"]', state);
          try {
            await wait(
              'uiDebugQa.events.some(event=>event.type==="ui-debug:ready")',
            );
            const found = await js(
              'uiDebugQa.events.findLast(event=>event.type==="ui-debug:ready").found',
            );
            if (!found)
              failures.push(`${scope}/${item.id}/${state}: missing target`);
            const errors = await js(
              'uiDebugQa.events.filter(event=>event.type==="ui-debug:error")',
            );
            if (errors.length)
              failures.push(
                `${scope}/${item.id}/${state}: ${JSON.stringify(errors)}`,
              );
          } catch (error) {
            failures.push(`${scope}/${item.id}/${state}: ${error.message}`);
          }
        }
        console.log(`Verified ${scope}: ${item.id}`);
      }
    };
    await checkScope('home');
    assert.equal(
      await js('JSON.stringify({...localStorage})'),
      snapshot,
      'preview storage must not persist in live app',
    );
    await js(
      'document.querySelector("[data-debug-entry=home] button:last-child").click()',
    );
    await wait('!!document.querySelector(".ui-debug-highlight")');
    await f12();
    await wait('!document.querySelector(".ui-debug-console")');
    assert.equal(
      await js('document.querySelectorAll(".ui-debug-highlight").length'),
      0,
    );
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      '!!document.querySelector(".document-card") && !!document.querySelector(".canvas-tabs")',
    );
    await f12();
    await wait('!!document.querySelector(".ui-debug-console[open]")');
    assert.equal(
      await js(
        'document.querySelectorAll("[data-debug-entry=home-create]").length',
      ),
      0,
    );
    assert.equal(
      await js('document.querySelectorAll("[data-debug-entry=editor]").length'),
      1,
    );
    const callsBefore = await js('uiDebugQa.calls.length');
    await checkScope('project');
    await fs.writeFile(
      'out/ui-debug-qa/catalog-failures.json',
      JSON.stringify(failures, null, 2),
    );
    assert.equal(
      await js('uiDebugQa.calls.length'),
      callsBefore,
      'opening previews must not call the real API',
    );
    await js(
      'uiDebugQa.events=[];document.querySelector("[data-debug-entry=delete] button").click()',
    );
    await wait('uiDebugQa.events.some(event=>event.type==="ui-debug:ready")');
    await js(
      `{const doc=document.querySelector('.ui-debug-stage iframe').contentDocument;doc.querySelector('[data-ui-id="delete"] .button-danger').click();}`,
    );
    await wait(
      'uiDebugQa.events.some(event=>event.type==="ui-debug:blocked" && event.method==="deleteDocument")',
    );
    assert.equal(await js('uiDebugQa.calls.length'), callsBefore);
    await select('[aria-label="미리보기 테마"]', 'light');
    await wait(
      'document.querySelector(".ui-debug-stage iframe")?.contentDocument?.documentElement.dataset.theme==="light"',
    );
    await select('[aria-label="미리보기 화면 크기"]', '390');
    await wait(
      'document.querySelector(".ui-debug-stage iframe").style.width==="390px"',
    );
    await fs.writeFile(
      'out/ui-debug-qa/console.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      `document.querySelector('.ui-debug-stage iframe').contentDocument.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}));`,
    );
    await wait('!document.querySelector(".ui-debug-console")');
    if (failures.length) throw Error(failures.join('\n'));
    console.log(
      'UI debug: all catalog states, scopes, F12, highlight, storage and action isolation passed.',
    );
  } catch (error) {
    await fs.writeFile(
      'out/ui-debug-qa/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.error(error);
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
