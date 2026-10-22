import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.disableHardwareAcceleration();
app.setPath('userData', path.resolve('out/gamejam-history/profile'));
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
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      throw new Error(`UI script failed: ${code}`, { cause: error });
    }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await sleep(50);
    }
    throw Error('History UI timeout: ' + code);
  };
  const click = async (selector, text) => {
    await js(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`,
    );
    await sleep(60);
  };
  const open = async () => {
    await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
    await wait('!!document.querySelector(".ai-request-dialog")');
  };
  const next = () => click('.ai-request-dialog > footer button', '다음');
  const setValue = async (selector, value) => {
    await js(
      `{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}`,
    );
    await sleep(80);
  };
  let exitCode = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".document-card")');
    await js('localStorage.clear()');
    await open();
    await wait(`!!document.querySelector('.gamejam-request-history')`);
    assert.equal(
      await js(
        `document.querySelector('[data-gamejam-page="1"]:not([hidden])')!==null`,
      ),
      true,
    );
    await click('.gamejam-request-history button', '최근 작업 불러오기');
    await wait(
      `document.querySelector('#ai-task-instructions-organize').value==='실패 기록에서 불러온 지시'`,
    );
    assert.equal(await js('qaHistory.runs'), 0);
    await next();
    await setValue('#ai-result-name', '임시 작성 복구');
    await next();
    await setValue(
      '#ai-task-instructions-organize',
      '저장되지 않은 입력도 보관\n## 내 지시',
    );
    await wait(
      `document.querySelector('.gamejam-request-history').textContent.includes('자동 저장됨')`,
    );
    await js(`document.querySelector('[title="AI 실행창 닫기"]').click()`);
    await open();
    assert.equal(
      await js(
        `document.querySelector('#ai-task-instructions-organize').value===${JSON.stringify('저장되지 않은 입력도 보관\n## 내 지시')}`,
      ),
      false,
    );
    await click('.gamejam-request-history button', '작성 중 요청 불러오기');
    assert.equal(
      await js(
        `document.querySelector('#ai-task-instructions-organize').value`,
      ),
      '저장되지 않은 입력도 보관\n## 내 지시',
    );
    assert.equal(
      await js(`document.querySelector('#ai-result-name').value`),
      '임시 작성 복구',
    );
    // Reload the whole renderer to exercise persistent drafts rather than React state.
    await win.reload();
    await wait('!!document.querySelector(".document-card")');
    await open();
    await click('.gamejam-request-history button', '작성 중 요청 불러오기');
    assert.equal(
      await js(
        `document.querySelector('#ai-task-instructions-organize').value`,
      ),
      '저장되지 않은 입력도 보관\n## 내 지시',
    );
    assert.equal(await js('qaHistory.runs'), 0);
    assert(
      await js(
        'document.querySelector(".ai-request-fields").scrollWidth<=document.querySelector(".ai-request-fields").clientWidth',
      ),
    );
    await fs.mkdir('out/gamejam-history', { recursive: true });
    await fs.writeFile(
      'out/gamejam-history/draft-restored.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await click('.gamejam-request-history button', '작업 기록');
    await wait('!!document.querySelector(".history-panel")');
    await click('.history-ai-record-button', '작업 지시');
    await click('.ai-task-details__reuse button', '다시 준비');
    await wait('!!document.querySelector(".ai-request-dialog")');
    assert.equal(
      await js(`document.querySelector('#ai-result-name').value`),
      '실패 기록 복원',
    );
    assert.equal(await js('qaHistory.runs'), 0);
    await next();
    await next();
    await next();
    await next();
    await wait(
      `!!document.querySelector('[data-gamejam-page="5"]:not([hidden])')`,
    );
    assert.equal(
      await js(
        `document.querySelector('.ai-model-fields select[aria-label="AI 제공자"]').value`,
      ),
      'claude-cli',
    );
    assert.equal(
      await js(`document.querySelector('#ai-model-custom').value`),
      'claude-opus-5-5',
    );
    assert.equal(
      await js(`document.querySelector('#ai-reasoning-effort').value`),
      'xhigh',
    );
    await js(`document.querySelector('#ai-request-connection').open=true`);
    await setValue('[aria-label="AI 제공자"]', 'codex-cli');
    await setValue('[aria-label="모델 버전"]', 'gpt-6-luna');
    assert.equal(
      await js(
        `!!document.querySelector('#ai-reasoning-effort option[value="ultra"]')`,
      ),
      false,
    );
    await setValue('#ai-reasoning-effort', 'max');
    await setValue('[aria-label="AI 제공자"]', 'gemini-cli');
    assert.equal(
      await js(`document.querySelector('#ai-reasoning-effort').value`),
      '',
    );
    await setValue('[aria-label="모델 버전"]', 'gemini-3.8-flash');
    assert.deepEqual(
      await js(
        `Array.from(document.querySelector('#ai-reasoning-effort').options).map(e=>e.value)`,
      ),
      ['', 'low', 'medium', 'high'],
    );
    await setValue('#ai-reasoning-effort', 'high');
    await setValue('#ai-model-custom', 'custom-gemini');
    assert.equal(
      await js(`document.querySelector('#ai-reasoning-effort').value`),
      '',
    );
    assert.equal(
      await js(`document.querySelector('#ai-reasoning-effort').disabled`),
      true,
    );
    await setValue('[aria-label="AI 제공자"]', 'claude-cli');
    await setValue('[aria-label="모델 버전"]', 'claude-opus-5-5');
    await setValue('#ai-reasoning-effort', 'xhigh');
    assert(
      await js(
        `document.querySelector('.ai-request-fields').scrollWidth<=document.querySelector('.ai-request-fields').clientWidth`,
      ),
    );
    await js(
      `document.querySelector('#ai-reasoning-effort').scrollIntoView({block:'center'})`,
    );
    await sleep(80);
    await fs.writeFile(
      'out/gamejam-history/ai-reasoning-settings.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await wait(
      `document.querySelector('.ai-request-dialog > footer > .button-primary').getAttribute('aria-disabled')==='false'`,
    );
    await click('.ai-request-dialog > footer button', '바로 구현하기');
    await wait('qaHistory.creates===1');
    assert.equal(
      await js('qaHistory.requests[0].requestSnapshot.retryOf'),
      'interrupted-fixture',
    );
    assert.equal(
      await js('qaHistory.requests[0].instructions'),
      '실패 기록에서 불러온 지시',
    );
    assert.equal(await js('qaHistory.runs'), 1);
    assert.equal(
      await js('qaHistory.requests[0].requestSnapshot.reasoningEffort'),
      'xhigh',
    );
    assert.equal(await js('qaHistory.runInputs[0].reasoningEffort'), 'xhigh');
    await open();
    await click('.gamejam-request-history button', '최근 작업 불러오기');
    assert.equal(
      await js(
        `document.querySelector('#ai-task-instructions-organize').value`,
      ),
      '실패 기록에서 불러온 지시',
    );
    assert.equal(await js('qaHistory.runs'), 1);
    console.log(
      'PASS: persistent drafts across close/reload; restore instructions, output settings, provider/model; failed history reuse; no automatic AI execution; linked retry; recent request after start failure; narrow dialog layout.',
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
