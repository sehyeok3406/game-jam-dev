import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
app.setPath('userData', path.resolve('out/qa/self-host-ui-profile'));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/qa', { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`UI wait failed: ${code}`);
  };
  const click = (label) =>
    js(
      `{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.split(' ').join('').trim()===${JSON.stringify(label.split(' ').join('').trim())});if(!button||button.disabled)throw Error('button unavailable: '+${JSON.stringify(label)});button.click();}`,
    );
  const capture = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await fs.writeFile(
      `out/qa/${name}.png`,
      (await win.webContents.capturePage()).toPNG(),
    );
  };
  try {
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-entry-actions")');
    await capture('self-host-home');
    await click('협업 서버 열기 이 PC에서 서버 설정 · 실행 · 관리');
    await wait('!!document.querySelector(".self-host-dialog[open]")');
    await wait(
      'document.querySelector(".self-host-status").textContent.includes("GC-HOST-004")',
    );
    await capture('self-host-setup');
    await click('연결 도구 준비');
    await wait('selfHostQa.actions.includes("prepare")');
    await click('서버 켜기');
    await wait(
      'document.querySelector(".self-host-status").dataset.stage==="ready"',
    );
    await capture('self-host-ready');
    await click('연결 정보 복사');
    await wait('selfHostQa.copied.includes("connection")');
    await click('초대 정보 복사');
    await wait('selfHostQa.copied.includes("invite")');
    await js(
      "[...document.querySelectorAll('summary')].find(item=>item.textContent.includes('연결 후 서버 관리')).click()",
    );
    assert.ok(
      await js(
        "document.querySelector('.self-host-dialog').textContent.includes('백업과 다른 PC로 이전')",
      ),
    );
    await js(
      "[...document.querySelectorAll('summary')].find(item=>item.textContent.includes('AI에게 도움받기')).click()",
    );
    await click('AI 요청문 복사');
    await wait('selfHostQa.copied.some(value=>value.includes("QA AI 요청문"))');
    await click('서버 끄기');
    await wait('!!document.querySelector(".self-host-confirm")');
    assert.equal(await js('selfHostQa.actions.includes("stop")'), false);
    await click('취소');
    await js(
      'document.querySelector(\'[aria-label="서버 관리 닫기"]\').click()',
    );
    await wait('!document.querySelector(".self-host-dialog")');
    await click('연결 정보 붙여넣기 · 기존 프로젝트 주소 갱신');
    await wait('!!document.querySelector(".connection-info-dialog[open]")');
    const text = JSON.stringify({
      format: 'gamejam-connection',
      version: 1,
      projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      serverUrl: 'https://new.example',
    });
    await js(
      `{const element=document.querySelector('.connection-info-dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,${JSON.stringify(text)});element.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
    await click('변경 내용 확인');
    await wait('!!document.querySelector(".connection-info-preview")');
    assert.equal(
      await js(
        "[...document.querySelectorAll('.connection-info-dialog button')].find(item=>item.textContent.includes('기존 프로젝트 연결 갱신')).disabled",
      ),
      true,
    );
    await capture('self-host-reconnect');
    await js("document.querySelector('.connection-trust input').click()");
    await click('기존 프로젝트 연결 갱신');
    await wait('selfHostQa.applied.length===1');
    await wait('!document.querySelector(".connection-info-dialog")');
    await click('라이트 모드');
    await click('협업 서버 열기 이 PC에서 서버 설정 · 실행 · 관리');
    await wait('!!document.querySelector(".self-host-dialog[open]")');
    await capture('self-host-light');
    assert.equal(
      await js('document.documentElement.scrollWidth > innerWidth'),
      false,
    );
    console.log(
      'PASS: home, setup, management, help, one-click AI copy, explicit stop confirmation, trusted reconnect and light/dark layout',
    );
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    await capture('self-host-ui-failure');
    win.destroy();
    app.exit(1);
  }
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
