import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.disableHardwareAcceleration();
app.setPath('userData', path.resolve('out/gamejam-validation/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 850,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await sleep(50);
    }
    throw Error('Validation UI timeout: ' + code);
  };
  const setValue = (id, value) =>
    js(
      `{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
  const clickRun = () =>
    js(
      'document.querySelector(".ai-request-dialog > footer > .button-primary").click()',
    );
  const blocked = () =>
    js(
      'document.querySelector(".ai-request-dialog > footer > .button-primary").getAttribute("aria-disabled")==="true"',
    );
  const refresh = async () => {
    await js('document.querySelector(".ai-advanced-settings").open=true');
    await js(
      `Array.from(document.querySelectorAll('.ai-advanced-settings button')).find(b=>b.textContent.includes('연결 확인')).click()`,
    );
    await wait(
      `!Array.from(document.querySelectorAll('.ai-advanced-settings button')).some(b=>b.textContent.includes('확인 중'))`,
    );
    await sleep(80);
  };
  let exitCode = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".document-card")');
    await js(
      `{const e=document.querySelector('.react-flow__node-document');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));e.dispatchEvent(new MouseEvent('click',{bubbles:true}));}`,
    );
    await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
    await wait('!!document.querySelector(".ai-request-dialog")');
    await wait(
      `document.querySelector('.ai-request-dialog > footer > .button-primary').getAttribute('aria-disabled')==='false'`,
    );
    // Typical HTML result titles contain characters that are invalid for result names.
    await setValue('ai-result-name', '2인용 · 버전 1');
    await wait(
      'document.querySelector("#ai-result-name").getAttribute("aria-invalid")==="true"',
    );
    assert(await blocked());
    assert(
      await js(
        'document.querySelector(".ai-validation-summary").textContent.includes("이름은 80자")',
      ),
    );
    await clickRun();
    assert.equal(await js('document.activeElement.id'), 'ai-result-name');
    assert.equal(await js('qaValidation.creates'), 0);
    assert(
      await js(
        `!!document.getElementById(document.querySelector('#ai-result-name').getAttribute('aria-describedby'))`,
      ),
    );
    await js('document.documentElement.dataset.theme="light"');
    win.webContents.invalidate();
    await sleep(500);
    const geometry = await js(
      `(()=>{const r=document.querySelector('.ai-request-dialog').getBoundingClientRect();const f=document.querySelector('.ai-validation-summary').getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,visible:f.top>=r.top&&f.bottom<=r.bottom};})()`,
    );
    assert(geometry.fits && geometry.visible);
    await fs.mkdir('out/gamejam-validation', { recursive: true });
    await fs.writeFile(
      'out/gamejam-validation/inline-name-light.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await setValue('ai-result-name', '벽돌 탈출');
    await wait(
      '!document.querySelector("#ai-result-name").hasAttribute("aria-invalid")',
    );
    assert(!(await blocked()));
    await setValue('ai-task-instructions-organize', '');
    await wait('!!document.querySelector("#ai-validation-organize")');
    await clickRun();
    assert.equal(
      await js('document.activeElement.id'),
      'ai-task-instructions-organize',
    );
    assert.equal(await js('qaValidation.creates'), 0);
    await js(
      `document.querySelector('#ai-task-instructions-organize').closest('.gamejam-instructions').querySelector('button').click()`,
    );
    await wait('!document.querySelector("#ai-validation-organize")');
    await js(
      'document.querySelectorAll(".gamejam-steps input")[0].click();document.querySelectorAll(".gamejam-steps input")[1].click()',
    );
    await wait('!!document.querySelector("#ai-validation-steps")');
    await clickRun();
    assert.equal(await js('document.activeElement.id'), 'ai-request-steps');
    await js('document.querySelectorAll(".gamejam-steps input")[1].click()');
    await wait('!document.querySelector("#ai-validation-steps")');
    await js('qaValidation.connection(false,false)');
    await refresh();
    await js('document.querySelector(".ai-advanced-settings").open=false');
    assert(await blocked());
    await js('document.querySelector(".ai-validation-summary button").click()');
    assert(await js('document.querySelector(".ai-advanced-settings").open'));
    assert.equal(
      await js('document.activeElement.id'),
      'ai-request-connection',
    );
    await clickRun();
    assert.equal(await js('qaValidation.creates'), 0);
    await js('document.documentElement.dataset.theme="dark"');
    await sleep(600);
    assert(
      await js(
        `(()=>{const r=document.querySelector('#ai-request-connection > summary').getBoundingClientRect();const a=document.querySelector('.ai-request-fields').getBoundingClientRect();return r.top>=a.top&&r.bottom<=a.bottom;})()`,
      ),
    );
    await fs.writeFile(
      'out/gamejam-validation/connection-dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('qaValidation.connection(true,true)');
    await refresh();
    await wait('!document.querySelector("#ai-validation-connection")');
    await setValue('ai-model-custom', 'bad model');
    await wait('!!document.querySelector("#ai-validation-model")');
    await js('document.querySelector(".ai-advanced-settings").open=false');
    await clickRun();
    assert.equal(await js('document.activeElement.id'), 'ai-model-custom');
    assert(await js('document.querySelector(".ai-advanced-settings").open'));
    await setValue('ai-model-custom', '');
    await js('qaValidation.shared({role:"editor",editorAi:false})');
    await wait(
      'document.querySelector(".ai-validation-summary").textContent.includes("AI 실행 권한이 꺼져")',
    );
    await clickRun();
    assert.equal(await js('qaValidation.creates'), 0);
    await js('qaValidation.shared({pendingChanges:1})');
    await wait(
      'document.querySelector(".ai-validation-summary").textContent.includes("동기화가 끝난")',
    );
    await js('qaValidation.shared({})');
    await wait('!document.querySelector(".ai-validation-summary")');
    assert(!(await blocked()));
    await clickRun();
    await wait(
      'document.querySelector(".ai-validation-summary").textContent.includes("테스트 서버에서 작업 요청을 거절")',
    );
    assert.equal(
      await js('document.querySelector("#ai-result-name").value'),
      '벽돌 탈출',
    );
    assert.equal(await js('qaValidation.creates'), 1);
    assert.equal(await js('qaValidation.runs'), 0);
    await setValue('ai-result-name', '고친 이름');
    await wait('!document.querySelector(".ai-validation-summary")');
    console.log(
      'PASS: inline name/instruction/model errors, repair/default restoration, blocked submit, error focus, folded settings, role/sync reasons, light/dark narrow layout, server errors and preserved input; no AI calls.',
    );
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    win.destroy();
    app.exit(exitCode);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
