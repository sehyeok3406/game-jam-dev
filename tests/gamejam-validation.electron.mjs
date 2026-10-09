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
  const goTo = async (page) => {
    await js(`document.querySelector('[data-gamejam-step="${page}"]').click()`);
    await wait(
      `!!document.querySelector('[data-gamejam-page="${page}"]:not([hidden])')`,
    );
  };
  const next = async () => {
    await js('document.querySelector("#ai-request-next").click()');
    await sleep(80);
  };
  const visiblePages = () =>
    js('document.querySelectorAll(".gamejam-page:not([hidden])").length');
  const setValue = async (id, value) => {
    const page =
      id === 'ai-result-name'
        ? 2
        : id.startsWith('ai-task-instructions')
          ? 3
          : id === 'game-feature-search'
            ? 4
            : 5;
    await goTo(page);
    if (id === 'ai-task-instructions-implement') {
      await js(
        `document.querySelector('.gamejam-instruction-progress button:last-child')?.click()`,
      );
    }
    await js(
      `{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
  };
  const clickRun = async () => {
    await goTo(5);
    await js(
      'document.querySelector(".ai-request-dialog > footer > .button-primary").click()',
    );
    await sleep(80);
  };
  const blocked = () =>
    js(
      'document.querySelector(".ai-request-dialog > footer > .button-primary").getAttribute("aria-disabled")==="true"',
    );
  const refresh = async () => {
    await goTo(5);
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
    await fs.mkdir('out/gamejam-validation', { recursive: true });
    assert.equal(await visiblePages(), 1);
    assert.equal(
      await js(
        `!!document.querySelector('[data-gamejam-page="1"]:not([hidden])')`,
      ),
      true,
    );
    assert.equal(
      await js(
        'document.querySelector(".ai-request-dialog > footer").textContent.includes("gamejam! 실행")',
      ),
      false,
    );
    assert.equal(
      await js(`document.querySelector('[data-gamejam-step="5"]').disabled`),
      true,
    );
    await next();
    await wait(
      `!!document.querySelector('[data-gamejam-page="2"]:not([hidden])')`,
    );
    await setValue('ai-result-name', '설정 보존 테스트');
    await next();
    await wait(
      `!!document.querySelector('[data-gamejam-page="3"]:not([hidden])')`,
    );
    assert.equal(
      await js(
        'document.querySelector("#ai-task-instructions-organize").closest(".gamejam-instructions").hidden',
      ),
      false,
    );
    assert.equal(
      await js(
        'document.querySelector("#ai-task-instructions-implement").closest(".gamejam-instructions").hidden',
      ),
      true,
    );
    await setValue(
      'ai-task-instructions-organize',
      '선택 문서만 정리하고 기존 입력은 보존한다.',
    );
    await next();
    assert.equal(
      await js(
        'document.querySelector("#ai-task-instructions-implement").closest(".gamejam-instructions").hidden',
      ),
      false,
    );
    await js('document.querySelector("#ai-request-previous").click()');
    await sleep(80);
    assert.equal(
      await js(
        'document.querySelector("#ai-task-instructions-organize").value',
      ),
      '선택 문서만 정리하고 기존 입력은 보존한다.',
    );
    await next();
    await next();
    await wait(
      `!!document.querySelector('[data-gamejam-page="4"]:not([hidden])')`,
    );
    assert.equal(await visiblePages(), 1);
    assert(
      await js(
        `document.querySelector('[data-gamejam-page="4"] .ai-step-heading').textContent.includes('미리보기')`,
      ),
    );
    assert(
      await js(
        'document.querySelector(".game-feature-detail button").disabled',
      ),
    );
    assert.equal(
      await js('document.querySelectorAll(".game-feature-category").length'),
      32,
    );
    await js(
      'document.querySelector(".game-feature-category summary").click()',
    );
    assert(await js('document.querySelector(".game-feature-category").open'));
    await setValue('game-feature-search', '추격');
    await js(
      `Array.from(document.querySelectorAll('.game-feature-group button')).find(b=>b.textContent==='플레이어 추적').click()`,
    );
    await wait(
      'document.querySelector(".game-feature-detail h4").textContent==="플레이어 추적"',
    );
    assert(
      await js(
        'document.querySelector(".game-feature-detail").textContent.includes("추적 포기 거리")',
      ),
    );
    await js('document.documentElement.dataset.theme="light"');
    await sleep(300);
    await fs.writeFile(
      'out/gamejam-validation/library-light.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await setValue('game-feature-search', '존재하지않는기능');
    assert(await js('!!document.querySelector(".game-feature-empty")'));
    await js('document.querySelector(".game-feature-empty button").click()');
    await js(
      'document.querySelector(".game-feature-views button:last-of-type").click()',
    );
    assert.equal(
      await js(
        'document.querySelectorAll(".game-feature-presets section").length',
      ),
      16,
    );
    await js(
      `Array.from(document.querySelectorAll('.game-feature-presets button')).find(b=>b.textContent==='재장전').click()`,
    );
    await wait(
      'document.querySelector(".game-feature-detail h4").textContent==="재장전"',
    );
    await js('document.querySelector("#ai-request-previous").click()');
    await sleep(80);
    assert.equal(
      await js(
        'document.querySelector("#ai-task-instructions-implement").closest(".gamejam-instructions").hidden',
      ),
      false,
    );
    await next();
    assert.equal(
      await js('document.querySelector("#game-feature-search").value'),
      '재장전',
    );
    await next();
    await wait(
      `!!document.querySelector('[data-gamejam-page="5"]:not([hidden])')`,
    );
    assert.equal(await visiblePages(), 1);
    assert(
      await js(
        'document.querySelector(".gamejam-review").textContent.includes("설정 보존 테스트")',
      ),
    );
    assert(
      await js(
        'document.querySelector(".gamejam-review").textContent.includes("이번 작업에 반영되지 않습니다")',
      ),
    );
    assert.equal(await js('qaValidation.creates'), 0);
    // Typical HTML result titles contain characters that are invalid for result names.
    await setValue('ai-result-name', '2인용 · 버전 1');
    await wait(
      'document.querySelector("#ai-result-name").getAttribute("aria-invalid")==="true"',
    );
    assert(await blocked());
    await next();
    assert.equal(await js('document.activeElement.id'), 'ai-result-name');
    assert.equal(await visiblePages(), 1);
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
      `(()=>{const r=document.querySelector('.ai-request-dialog').getBoundingClientRect();const f=document.querySelector('.ai-validation-summary').getBoundingClientRect();const n=document.querySelector('#ai-result-name').getBoundingClientRect();const s=document.querySelector('.ai-request-fields').getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,visible:f.top>=r.top&&f.bottom<=r.bottom,inputVisible:n.top>=s.top&&n.bottom<=s.bottom};})()`,
    );
    assert(geometry.fits && geometry.visible);
    assert(geometry.inputVisible, 'focused error input must be visible');
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
    await goTo(1);
    await js(
      'document.querySelectorAll(".gamejam-steps input")[0].click();document.querySelectorAll(".gamejam-steps input")[1].click()',
    );
    await wait('!!document.querySelector("#ai-validation-steps")');
    await clickRun();
    assert.equal(await js('document.activeElement.id'), 'ai-request-steps');
    await js('document.querySelectorAll(".gamejam-steps input")[1].click()');
    await wait('!document.querySelector("#ai-validation-steps")');
    await next();
    await next();
    assert.equal(
      await js(
        'document.querySelectorAll(".gamejam-instruction-progress").length',
      ),
      0,
    );
    assert.equal(
      await js(
        'document.querySelector("#ai-task-instructions-implement").closest(".gamejam-instructions").hidden',
      ),
      false,
    );
    await next();
    await next();
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
    const request = await js('qaValidation.requests[0]');
    assert.equal(request.kind, 'implement');
    assert.equal(request.thenImplement, undefined);
    assert(!JSON.stringify(request).includes('game-feature'));
    assert(!request.instructions.includes('미리보기'));
    assert(!request.instructions.includes('추적 포기 거리'));
    await setValue('ai-result-name', '고친 이름');
    await wait('!document.querySelector(".ai-validation-summary")');
    await goTo(4);
    win.setSize(1280, 900);
    await js('document.documentElement.dataset.theme="dark"');
    await setValue('game-feature-search', '8방향');
    await js(
      `Array.from(document.querySelectorAll('.game-feature-group button')).find(b=>b.textContent==='8방향 이동').click()`,
    );
    await sleep(400);
    await fs.writeFile(
      'out/gamejam-validation/library-desktop-dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await goTo(5);
    await sleep(200);
    await fs.writeFile(
      'out/gamejam-validation/review-desktop-dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(390, 844);
    await js('document.documentElement.dataset.theme="light"');
    for (const page of [1, 2, 3, 4, 5]) {
      await goTo(page);
      await sleep(100);
      const geometry = await js(
        `(()=>{const d=document.querySelector('.ai-request-dialog').getBoundingClientRect();const fields=document.querySelector('.ai-request-fields');return {fits:d.left>=0&&d.right<=innerWidth&&d.top>=0&&d.bottom<=innerHeight,noOverflow:fields.scrollWidth<=fields.clientWidth,one:document.querySelectorAll('.gamejam-page:not([hidden])').length===1};})()`,
      );
      assert(
        geometry.fits && geometry.noOverflow && geometry.one,
        `narrow page ${page}`,
      );
      assert.equal(
        await js(
          'Number(document.querySelector(".gamejam-progress [aria-current=step]").dataset.gamejamStep)',
        ),
        page,
      );
      if (page === 4) {
        win.webContents.invalidate();
        await sleep(400);
        await fs.writeFile(
          'out/gamejam-validation/library-mobile-light.png',
          (await win.webContents.capturePage()).toPNG(),
        );
      }
    }
    await js(`document.querySelector('[title="AI 실행창 닫기"]').click()`);
    await wait('!document.querySelector(".ai-request-dialog")');
    await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
    await wait(
      `!!document.querySelector('[data-gamejam-page="1"]:not([hidden])')`,
    );
    assert.equal(
      await js('document.querySelector("#game-feature-search").value'),
      '',
    );
    assert.equal(
      await js(`document.querySelector('[data-gamejam-step="5"]').disabled`),
      true,
    );
    await js('document.querySelectorAll(".gamejam-steps input")[1].click()');
    await next();
    await next();
    assert.equal(
      await js(
        'document.querySelectorAll(".gamejam-instruction-progress").length',
      ),
      0,
    );
    assert.equal(
      await js(
        'document.querySelector("#ai-task-instructions-organize").closest(".gamejam-instructions").hidden',
      ),
      false,
    );
    await next();
    await next();
    assert(
      await js(
        'document.querySelector(".gamejam-review").textContent.includes("문서 정리")',
      ),
    );
    assert.equal(await js('qaValidation.creates'), 1);
    assert.equal(await js('qaValidation.runs'), 0);
    console.log(
      'PASS: five-page wizard, separate instruction pages, previous/next preservation, single-task flow, searchable 32-folder preview, presets, disabled application, review, validation routing, blocked submit, folded settings, role/sync reasons, light/dark narrow layout, server errors and preserved input; preview excluded from task and no AI calls.',
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
