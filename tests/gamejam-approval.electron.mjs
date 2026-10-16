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
    assert.equal(
      await js(
        `!!document.querySelector('[aria-label="디스코드 알림 설정 및 테스트"]')`,
      ),
      false,
    );
    await js('qaApproval.role("admin")');
    await click('header button', '디스코드 알림');
    await wait(
      '!!document.querySelector(".discord-approval-dialog details[open]")',
    );
    await setValue('[aria-label="디스코드 봇 토큰"]', 'unsaved-guide-token');
    await click('.discord-guide-entry button', '관리자 설정 도움말');
    await wait(`!!document.querySelector('[data-guide-step="1"]')`);
    assert.equal(
      await js(
        `document.querySelector('.discord-approval-guide footer button').disabled`,
      ),
      true,
    );
    for (let step = 1; step <= 7; step++) {
      await wait(`!!document.querySelector('[data-guide-step="${step}"]')`);
      assert.equal(
        await js('document.querySelectorAll("[data-guide-step]").length'),
        1,
      );
      if (step === 2) {
        await click('.discord-guide-link', 'Developer Portal');
        assert.equal(await js('qaApproval.helpLink'), 'portal');
        await click('.discord-approval-guide footer button', '이전');
        await wait('!!document.querySelector(\'[data-guide-step="1"]\')');
        await click('.discord-approval-guide footer button', '다음');
      }
      if (step === 3) {
        await fs.mkdir('out/gamejam-approval', { recursive: true });
        for (const theme of ['dark', 'light']) {
          await js(`document.documentElement.dataset.theme='${theme}'`);
          await pause(200);
          await fs.writeFile(
            `out/gamejam-approval/discord-guide-${theme}.png`,
            (await win.webContents.capturePage()).toPNG(),
          );
        }
        await js('document.documentElement.dataset.theme="dark"');
        win.setSize(620, 700);
        await pause(200);
        assert.equal(
          await js(
            'document.querySelector(".discord-approval-dialog").scrollWidth <= document.querySelector(".discord-approval-dialog").clientWidth',
          ),
          true,
        );
        await fs.writeFile(
          'out/gamejam-approval/discord-guide-small.png',
          (await win.webContents.capturePage()).toPNG(),
        );
        win.setSize(1150, 850);
      }
      if (step < 7)
        await click('.discord-approval-guide footer button', '다음');
    }
    await click('.discord-approval-guide footer button', '연결 설정 열기');
    assert.equal(
      await js(
        `document.querySelector('[aria-label="디스코드 봇 토큰"]').value`,
      ),
      'unsaved-guide-token',
    );
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('.discord-settings-actions button')).find(e=>e.textContent.includes('테스트 알림')).getBoundingClientRect().height > 0`,
      ),
      true,
    );
    await js(
      `document.querySelector('[aria-label="디스코드 알림 닫기"]').click()`,
    );
    await js('qaApproval.local(true)');
    await click('header button', '디스코드 알림');
    await wait(
      'document.querySelector(".discord-approval-dialog")?.textContent.includes("함께 작업 연결하기")',
    );
    await click('.discord-guide-entry button', '관리자 설정 도움말');
    await wait('!!document.querySelector(\'[data-guide-step="1"]\')');
    await click('.discord-guide-entry button', '설정으로 돌아가기');
    assert.equal(
      await js('!!document.querySelector(".discord-settings-actions")'),
      false,
    );
    await js(
      `document.querySelector('[aria-label="디스코드 알림 닫기"]').click()`,
    );
    await js('qaApproval.local(false);qaApproval.role("editor")');
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
    await js(`document.querySelector('[aria-label="요청함 닫기"]').click()`);
    await click('header button', '디스코드 알림');
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
    assert.equal(await js('qaApproval.runs'), 0);
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
    await js(
      `document.querySelector('[aria-label="디스코드 알림 닫기"]').click()`,
    );
    await js(`document.querySelector('[title="설정 및 도구"]').click()`);
    await click('.canvas-settings button', '디스코드 알림');
    await wait(
      '!!document.querySelector(".discord-approval-dialog details[open]")',
    );
    await js(
      `document.querySelector('[aria-label="디스코드 알림 닫기"]').click()`,
    );
    await click('header button', '요청함');
    await click('.approval-list > button', '팀원 수정 완료');
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
