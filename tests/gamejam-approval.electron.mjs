import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.disableHardwareAcceleration();
app.setPath('userData', path.resolve('out/gamejam-approval/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1150,
    height: 850,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const wait = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await pause();
    }
    throw Error('Approval UI timeout: ' + code);
  };
  const click = async (selector, text) => {
    await js(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`,
    );
    await pause();
  };
  const setValue = async (selector, value) => {
    await js(
      `{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
    await pause();
  };
  const finalPage = async () => {
    for (let i = 0; i < 5; i++) {
      if (
        await js(
          `!!document.querySelector('[data-gamejam-page="5"]:not([hidden])')`,
        )
      )
        return;
      await click('.ai-request-dialog > footer button', '다음');
    }
  };
  try {
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".document-card")');
    await js('localStorage.clear()');
    await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
    await wait('!!document.querySelector(".ai-request-dialog")');
    await click('.gamejam-request-history button', '최근 작업 불러오기');
    await finalPage();
    assert.equal(
      await js(`document.querySelector('.ai-advanced-settings').hidden`),
      true,
    );
    assert.equal(
      await js(
        `document.querySelector('.ai-request-dialog > footer .button-primary').getAttribute('aria-disabled')`,
      ),
      'false',
    );
    await click('.ai-request-dialog > footer button', '요청하기');
    await wait('!!document.querySelector(".approval-inbox")');
    await wait('!!document.querySelector(".approval-list > button")');
    assert.equal(await js('qaApproval.creates'), 0);
    assert.equal(await js('qaApproval.runs'), 0);
    await click('.approval-list > button', '팀원 게임');
    await click('.approval-actions button', '수정하기');
    await finalPage();
    await setValue('#ai-result-name', '팀원 수정 완료');
    await click('.ai-request-dialog > footer button', '수정 저장');
    await wait('!!document.querySelector(".approval-inbox")');
    await click('.approval-list > button', '팀원 수정 완료');
    await js('qaApproval.role("admin")');
    await wait('!!document.querySelector(".approval-list > button")');
    await click('.approval-list > button', '팀원 수정 완료');
    await wait('!!document.querySelector(".approval-admin")');
    await click('.discord-approval-settings summary', '디스코드');
    await wait(
      '!!document.querySelector(".discord-approval-settings [role=status]")',
    );
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('.discord-settings-actions button')).find(e=>e.textContent.includes('테스트 알림')).disabled`,
      ),
      true,
    );
    await setValue('[aria-label="디스코드 봇 토큰"]', 'ui-test-token');
    await setValue('[aria-label="디스코드 채널 ID"]', '1560275803198193725');
    await setValue(
      '[aria-label="디스코드 관리자 사용자 ID"]',
      '448449132479381507',
    );
    assert.equal(
      await js(
        `document.querySelector('[aria-label="디스코드 봇 토큰"]').type`,
      ),
      'password',
    );
    await click('.discord-settings-actions button', '저장하고 연결');
    await wait(
      'document.querySelector(".discord-approval-settings").textContent.includes("테스트 연결")',
    );
    assert.equal(
      await js(
        `document.querySelector('[aria-label="디스코드 봇 토큰"]').value`,
      ),
      '',
    );
    await click('.discord-settings-actions button', '테스트 알림');
    await wait(
      'document.querySelector(".discord-approval-settings").textContent.includes("테스트 알림을 보냈습니다")',
    );
    await setValue('[aria-label="디스코드 채널 ID"]', '123456789012345678');
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('.discord-settings-actions button')).find(e=>e.textContent.includes('테스트 알림')).disabled`,
      ),
      true,
    );
    await setValue('[aria-label="디스코드 채널 ID"]', '1560275803198193725');
    await fs.mkdir('out/gamejam-approval', { recursive: true });
    await js('document.documentElement.dataset.theme="dark"');
    await pause(150);
    await fs.writeFile(
      'out/gamejam-approval/discord-settings-dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.documentElement.dataset.theme="light"');
    await pause(150);
    await fs.writeFile(
      'out/gamejam-approval/discord-settings-light.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.documentElement.dataset.theme="dark"');
    await click('.discord-settings-actions button', '연결 해제');
    await wait(
      '!document.querySelector(".discord-settings-actions").textContent.includes("연결 해제")',
    );
    await click('.discord-approval-settings summary', '디스코드');
    await setValue('.approval-admin textarea', '조작 방법을 더 써주세요');
    await click('.approval-admin button', '보완 요청');
    await wait(
      'document.querySelector(".approval-detail").textContent.includes("보완 의견: 조작 방법")',
    );
    await js('qaApproval.changeRequest()');
    await wait('!!document.querySelector(".approval-change")');
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('.approval-admin button')).find(e=>e.textContent.includes('승인하고')).disabled`,
      ),
      true,
    );
    await click('.approval-change button', '최신 내용 확인');
    await wait('!document.querySelector(".approval-change")');
    await js('qaApproval.changeSource()');
    await wait('!!document.querySelector(".approval-change")');
    await click('.approval-change button', '최신 내용 확인');
    await fs.mkdir('out/gamejam-approval', { recursive: true });
    await js('document.documentElement.dataset.theme="dark"');
    await fs.writeFile(
      'out/gamejam-approval/admin-review-dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('qaApproval.login()');
    await click('.approval-admin button', '승인하고 구현하기');
    await wait('qaApproval.runs===1');
    await wait('!document.querySelector(".approval-inbox")');
    await js('qaApproval.role("editor")');
    await click('header button', '내 요청');
    await wait('!!document.querySelector(".approval-list > button")');
    await click('.approval-list > button', '팀원이 변경한 요청');
    assert.equal(
      await js(
        `!!Array.from(document.querySelectorAll('.approval-actions button')).find(e=>e.textContent==='수정하기')`,
      ),
      false,
    );
    assert.equal(await js('qaApproval.creates'), 0);
    await fs.writeFile(
      'out/gamejam-approval/team-running-dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.documentElement.dataset.theme="light"');
    await fs.writeFile(
      'out/gamejam-approval/team-running-light.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    assert(
      await js(
        'document.querySelector(".approval-inbox").scrollWidth<=document.querySelector(".approval-inbox").clientWidth',
      ),
    );
    console.log(
      'Approval UI passed: no-login submit, shared edit, feedback, stale review, source changes, admin start, frozen request.',
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    await fs.mkdir('out/gamejam-approval', { recursive: true });
    await fs.writeFile(
      'out/gamejam-approval/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    app.exit(1);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
