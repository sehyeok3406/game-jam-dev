import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/location-links-ui/profile'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const errors = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => {
    for (let n = 0; n < 120; n++) {
      if (await js(code)) return;
      await sleep(60);
    }
    throw Error('Timeout: ' + code + '\n' + errors.join('\n'));
  };
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.reload();
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector("[data-id=raw-loop-note]")');
    await js(
      'window.sendLocation({kind:"document",id:"raw-loop-note",blockId:"22222222-2222-4222-8222-222222222222"})',
    );
    await wait('!!document.querySelector(".location-link-highlight")');
    await wait(
      '(document.querySelector("[data-location-block]")?.closest(".document-card__content")?.scrollTop ?? 0)>0',
    );
    const block = await js(
      '(()=>{const a=document.querySelector("[data-location-block]");const p=a?.closest("p");const s=p?.closest(".document-card__content");return {exists:!!a,scroll:s?.scrollTop,rect:p?.getBoundingClientRect().toJSON(),parent:s?.getBoundingClientRect().toJSON()}})()',
    );
    assert.ok(block.exists);
    assert.ok(block.scroll > 0, JSON.stringify(block));
    assert.ok(
      block.rect.top >= block.parent.top &&
        block.rect.bottom <= block.parent.bottom,
      JSON.stringify(block),
    );
    await js(
      'document.querySelector("[data-id=raw-loop-note]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:300,clientY:250,cancelable:true}))',
    );
    await wait(
      '[...document.querySelectorAll("[role=menuitem]")].some(b=>b.textContent.includes("위치 링크 복사"))',
    );
    await js(
      '[...document.querySelectorAll("[role=menuitem]")].find(b=>b.textContent.includes("위치 링크 복사")).click()',
    );
    await wait('!!window.copiedLocation');
    assert.match(await js('window.copiedLocation'), /gamejam:\/\/open\?/);
    await fs.mkdir('out/location-links-ui', { recursive: true });
    await fs.writeFile(
      'out/location-links-ui/paragraph.png',
      (await win.capturePage()).toPNG(),
    );
    assert.ok(!errors.length, errors.join('\n'));
    console.log(
      'PASS: actual renderer shared-link receive, persistent paragraph rendering, scroll/highlight and copy menu',
    );
  } finally {
    win.destroy();
    app.quit();
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
