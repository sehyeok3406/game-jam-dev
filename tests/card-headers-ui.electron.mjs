import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { cardPropertiesScenarios } from './card-properties-ui-scenarios.mjs';
import { cardAppearanceScenarios } from './card-appearance-ui-scenarios.mjs';

app.setPath('userData', path.resolve('out/card-headers-ui/profile'));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/card-headers-ui', { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1060,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (d) => {
    if (d.level === 'error' && !d.message.startsWith('ResizeObserver loop'))
      errors.push(d.message);
  });
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      throw Error(code + '\n' + String(error));
    }
  };
  const pause = (ms = 80) => new Promise((r) => setTimeout(r, ms));
  const wait = async (code) => {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await pause();
    }
    throw Error('Timed out: ' + code);
  };
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp'])
      win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await pause();
  };
  const rect = (selector) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})()`,
    );
  const click = async (selector) => {
    const r = await rect(selector);
    for (const type of ['mouseDown', 'mouseUp'])
      win.webContents.sendInputEvent({
        type,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        button: 'left',
        clickCount: 1,
      });
    await pause();
  };
  const drag = async (selector) => {
    const r = await rect(selector),
      x = Math.round(r.x + 5),
      y = Math.round(r.y + 5);
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    for (let i = 1; i <= 8; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: x + i * 8,
        y: y + i * 4,
        button: 'left',
        modifiers: ['leftButtonDown'],
      });
      await pause(25);
    }
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: x + 64,
      y: y + 32,
      button: 'left',
      clickCount: 1,
    });
    await pause();
  };
  const screenshot = async (name) =>
    fs.writeFile(
      `out/card-headers-ui/${name}.png`,
      (await win.webContents.capturePage()).toPNG(),
    );
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear();sessionStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      'document.querySelectorAll(".document-card").length===3&&!!document.querySelector(".preview-card")',
    );
    const original = (await js('window.gameCanvas.listDocuments()'))[0];
    const doc = `[data-find-document="${original.id}"]`;
    assert.equal(
      await js(
        'document.querySelectorAll(".document-card__header > .document-type").length',
      ),
      0,
    );
    assert.equal(
      await js(
        'document.querySelectorAll(".document-card__content > .document-card__title").length',
      ),
      0,
    );
    assert.equal(
      await js(
        `document.querySelector('${doc} .document-card__header .document-card__title').textContent.trim()`,
      ),
      original.title,
    );
    const titleStyle = (selector) =>
      js(
        `(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return {fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,padding:s.padding}})()`,
      );
    assert.deepEqual(
      await titleStyle(`${doc} .canvas-file-header__title`),
      await titleStyle('.preview-card .canvas-file-header__title'),
    );
    await click(`${doc} button.document-card__title`);
    await wait(
      'document.activeElement?.getAttribute("aria-label")==="문서 제목"',
    );
    assert.equal(
      await js(
        `!!document.querySelector('${doc} .document-card__header input')`,
      ),
      true,
    );
    assert.equal(
      await js('document.querySelectorAll(".document-editor > input").length'),
      0,
    );
    await key('A', ['control']);
    const longTitle =
      '카드 상단 이름 통일 검증 — 아주 긴 한글 제목을 입력해도 편집과 저장을 유지합니다';
    await win.webContents.insertText(longTitle);
    await js('window.qaHeaderInput=document.activeElement');
    await key('s', ['control']);
    await wait(
      `window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id===${JSON.stringify(original.id)}).title===${JSON.stringify(longTitle)})`,
    );
    await pause(1000);
    assert.equal(
      await js(
        'window.qaHeaderInput===document.activeElement&&window.qaHeaderInput.isConnected',
      ),
      true,
    );
    assert.equal(
      (await js('window.gameCanvas.listDocuments()'))[0].body,
      original.body,
    );
    await key('Escape');
    await wait(
      `!!document.querySelector('${doc} button.document-card__title')`,
    );
    assert.equal(
      await js(`document.querySelector('${doc} .document-card__title').title`),
      longTitle,
    );
    await drag(`${doc} .document-card__header`);
    await wait(
      `window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id===${JSON.stringify(original.id)}).x>${original.x + 10})`,
    );
    const moved = (await js('window.gameCanvas.listDocuments()'))[0];
    assert.equal(moved.title, longTitle);
    assert.equal(
      moved.relativePath,
      original.relativePath.slice(
        0,
        original.relativePath.lastIndexOf('/') + 1,
      ) +
        longTitle +
        '.md',
    );
    assert.equal(moved.body, original.body);
    await click(`${doc} [title="메모 최소화"]`);
    await wait(`!!document.querySelector('${doc}.document-card--collapsed')`);
    assert.equal(
      await js(
        `document.querySelector('${doc} .document-card__title').textContent.trim()`,
      ),
      longTitle,
    );
    await click(`${doc} [title="메모 펼치기"]`);
    await wait(`!!document.querySelector('${doc} .document-card__content')`);
    // Keyboard title editing uses the same header and save queue.
    await js(
      `document.querySelector('${doc} button.document-card__title').focus()`,
    );
    await key('Enter');
    await wait(
      'document.activeElement?.getAttribute("aria-label")==="문서 제목"',
    );
    await key('Enter', ['control']);
    await wait(
      `!!document.querySelector('${doc} button.document-card__title')`,
    );
    const preview = (await js('window.gameCanvas.listPreviews()'))[0];
    const htmlTitle = await js(
      'document.querySelector(".preview-card .canvas-file-header__title").textContent.trim()',
    );
    assert.ok(htmlTitle);
    assert.ok(!htmlTitle.startsWith('HTML 실행 ·'));
    await js(
      'window.qaHeaderFrame=document.querySelector(".preview-card iframe")',
    );
    const beforeWindow = await js(
      `window.gameCanvas.getPreviewWindow(${JSON.stringify(preview.relativePath)})`,
    );
    await drag('.preview-drag-handle');
    await wait(
      `window.gameCanvas.getPreviewWindow(${JSON.stringify(preview.relativePath)}).then(w=>w.x>${beforeWindow.x + 10})`,
    );
    assert.equal(
      await js(
        'window.qaHeaderFrame===document.querySelector(".preview-card iframe")',
      ),
      true,
    );
    await click('.preview-card [title="HTML 창 최소화"]');
    await wait('!!document.querySelector(".preview-card--collapsed")');
    assert.equal(
      await js(
        'document.querySelector(".preview-card .canvas-file-header__title").textContent.trim()',
      ),
      htmlTitle,
    );
    await click('.preview-card [title="HTML 창 펼치기"]');
    await wait('!!document.querySelector(".preview-card iframe")');
    await screenshot('wide');
    await js(
      `(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.id===${JSON.stringify(original.id)});await window.gameCanvas.updateLayouts([{...d,width:260}]);})()`,
    );
    await wait(
      `getComputedStyle(document.querySelector('${doc}')).width==='260px'`,
    );
    await click('.preview-card .canvas-file-header__title');
    const handleSelector =
      '.react-flow__node-preview.selected .react-flow__resize-control.bottom.right.handle';
    await wait(`!!document.querySelector('${handleSelector}')`);
    const handle = await rect(handleSelector),
      box = await rect('.preview-card');
    const width = await js(
      'parseFloat(getComputedStyle(document.querySelector(".preview-card")).width)',
    );
    const dx = ((420 - width) * box.width) / width;
    const x = Math.round(handle.x + handle.width / 2),
      y = Math.round(handle.y + handle.height / 2);
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    for (let i = 1; i <= 10; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(x + (dx * i) / 10),
        y,
        button: 'left',
        modifiers: ['leftButtonDown'],
      });
      await pause(25);
    }
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: Math.round(x + dx),
      y,
      button: 'left',
      clickCount: 1,
    });
    await wait(
      'parseFloat(getComputedStyle(document.querySelector(".preview-card")).width)<422',
    );
    for (const selector of [
      `${doc} .canvas-file-header__title`,
      '.preview-card .canvas-file-header__title',
    ]) {
      assert.equal(
        await js(
          `(()=>{const title=document.querySelector(${JSON.stringify(selector)});return title.clientWidth>=Math.min(title.scrollWidth,72)-1;})()`,
        ),
        true,
        selector + ' title remains visible',
      );
      assert.equal(
        await js(
          `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).textOverflow`,
        ),
        'ellipsis',
      );
      const safe = await js(
        `(()=>{const h=document.querySelector(${JSON.stringify(selector)}).closest('header').getBoundingClientRect();return [...document.querySelector(${JSON.stringify(selector)}).closest('header').querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return !r.width||r.right<=h.right+1;});})()`,
      );
      assert.equal(safe, true, 'Header controls fit the card');
    }
    for (const theme of ['light', 'dark']) {
      await js(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await pause();
      await screenshot(theme + '-narrow');
    }
    await key('f', ['control']);
    await wait('!!document.querySelector(".canvas-find")');
    await win.webContents.insertText('카드 상단 이름 통일 검증');
    await wait(
      `document.querySelector('.canvas-find [aria-live]')?.textContent==='1 / 1'`,
    );
    await cardPropertiesScenarios({
      js,
      wait,
      click,
      key,
      insertText: (text) => win.webContents.insertText(text),
      reload: () => win.loadURL(process.env.QA_URL),
      screenshot,
    });
    await cardAppearanceScenarios({
      js,
      wait,
      click,
      key,
      reload: () => win.loadURL(process.env.QA_URL),
      screenshot,
      native: (event) => win.webContents.sendInputEvent(event),
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS: shared MD/HTML header typography, native and keyboard title editing, queued save/focus, unchanged body/path, header dragging, iframe identity, collapse/expand, narrow card controls, themes and title search.',
    );
  } catch (error) {
    await screenshot('failure');
    console.error(error);
    app.exit(1);
  } finally {
    win.destroy();
    app.quit();
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
