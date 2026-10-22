import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
app.setPath(
  'userData',
  path.resolve('out/workspace-panels-ui/profiles', randomUUID()),
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
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function wait(code) {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await sleep(50);
    }
    throw Error('Timeout: ' + code);
  }
  async function key(keyCode, modifiers = []) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(40);
  }
  const button = (text) =>
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)}))`;
  async function click(text) {
    await js(`{const b=${button(text)}; b.focus(); b.click();}`);
  }
  let exitCode = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait(
      '!!document.querySelector(".home-project-open") && qaPanels.subscriptions===2',
    );
    await js(`${button('초대 코드로 참여')}.dataset.qaTrigger='join'`);
    await click('초대 코드로 참여');
    await wait(
      '!!document.querySelector(".collaboration-dialog") && document.querySelector(".collaboration-dialog").contains(document.activeElement)',
    );
    await js('qaPanels.update()');
    await wait('!!document.querySelector(".update-dialog")');
    assert.ok(
      await js(
        'document.querySelector(".collaboration-dialog").contains(document.activeElement)',
      ),
    );
    await js(
      `{const d=document.querySelector('.collaboration-dialog'); const items=[...d.querySelectorAll('input,button,select')].filter(e=>!e.disabled&&e.getClientRects().length);items.at(-1).focus();}`,
    );
    await key('Tab');
    assert.ok(
      await js(
        'document.querySelector(".collaboration-dialog").contains(document.activeElement)',
      ),
    );
    await key('ESC');
    await wait(
      '!document.querySelector(".collaboration-dialog") && !!document.querySelector(".update-dialog")',
    );
    assert.ok(
      await js(
        'document.querySelector(".update-dialog").contains(document.activeElement)',
      ),
    );
    await key('ESC');
    await wait('!document.querySelector(".update-dialog")');
    assert.equal(await js('document.activeElement.dataset.qaTrigger'), 'join');
    console.log(
      'PASS: actual App home collaboration/automatic update overlap respects CSS order, Tab, one Escape per modal and original trigger restoration',
    );
    await click('초대 코드로 참여');
    await wait('!!document.querySelector(".collaboration-dialog")');
    await sleep(250);
    await js(
      `{const inputs=document.querySelectorAll('.collaboration-dialog input');for(const input of inputs){const name=input.type==='url'?'http://127.0.0.1:4317':input.placeholder?.includes('이름')?'격리 사용자':'fixture';Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,name);input.dispatchEvent(new Event('input',{bubbles:true}));}}`,
    );
    await js(
      "document.querySelector('.collaboration-dialog .button-primary').click()",
    );
    await wait(
      '!!document.querySelector(".collaboration-dialog button[disabled]")',
    );
    await key('ESC');
    assert.ok(await js('!!document.querySelector(".collaboration-dialog")'));
    await js('qaPanels.failJoin()');
    await wait(
      'document.querySelector(".collaboration-dialog").textContent.includes("격리한 참여 실패")',
    );
    await key('ESC');
    await wait('!document.querySelector(".collaboration-dialog")');
    console.log(
      'PASS: in-flight collaboration cannot be dismissed by Escape; failure remains visible and can then close',
    );
    for (let i = 0; i < 3; i++) {
      await js('document.querySelector(".home-project-open").click()');
      await wait('!!document.querySelector("[data-plugin-launcher]")');
      assert.equal(await js('qaPanels.subscriptions'), 2);
      await key('K', ['control']);
      await wait('!!document.querySelector(".command-palette")');
      await key('ESC');
      await wait('!document.querySelector(".command-palette")');
      await js(
        `document.querySelector('[title="프로젝트 홈으로 돌아가기"]').click()`,
      );
      await wait('!!document.querySelector(".home-project-open")');
      assert.equal(await js('qaPanels.subscriptions'), 2);
    }
    console.log(
      'PASS: repeated home/workspace switches remount shell subscriptions once and preserve command palette Escape',
    );
    await fs.mkdir('out/workspace-panels-ui', { recursive: true });
    for (const theme of ['dark', 'light'])
      for (const [width, height] of [
        [1280, 900],
        [640, 640],
      ]) {
        await js(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
        );
        win.setSize(width, height);
        await click('초대 코드로 참여');
        await wait('!!document.querySelector(".collaboration-dialog")');
        await sleep(300);
        assert.ok(
          await js(
            `{const r=document.querySelector('.collaboration-dialog').getBoundingClientRect();r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}`,
          ),
        );
        await fs.writeFile(
          path.resolve(`out/workspace-panels-ui/${theme}-${width}.png`),
          (await win.webContents.capturePage()).toPNG(),
        );
        await key('ESC');
        await wait('!document.querySelector(".collaboration-dialog")');
      }
    console.log(
      'PASS: dark/light and 640/1280 layouts retain existing dialog dimensions and close behavior',
    );
  } catch (error) {
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
