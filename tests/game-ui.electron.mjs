import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, nativeImage } from 'electron';
app.setPath('userData', path.resolve('out/game-ui-ui/profile'));
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1100,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (d) => {
    if (d.level === 'error' && !d.message.startsWith('ResizeObserver'))
      errors.push(d.message);
  });
  win.webContents.on('did-fail-load', (_e, code, message) =>
    console.error('Load failed', code, message),
  );
  const watchdog = setTimeout(() => {
    console.error('Game UI QA watchdog', errors);
    win.destroy();
    app.quit();
    process.exitCode = 1;
  }, 90000);
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = () => new Promise((r) => setTimeout(r, 90));
  async function wait(code) {
    console.log('QA wait', code);
    for (let n = 0; n < 100; n++) {
      if (await js(code)) return;
      await pause();
    }
    throw Error('Timed out: ' + code);
  }
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const select = (label, value) =>
    js(
      `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  const fill = (label, value) =>
    js(
      `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.closest('details')?.setAttribute('open','');e.focus();e.value=${JSON.stringify(String(value))};e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`,
    );
  async function mouse(type, x, y) {
    win.webContents.sendInputEvent({
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: 1,
    });
    await pause();
  }
  try {
    console.log('QA loading', process.env.QA_URL);
    await win.loadURL(process.env.QA_URL);
    console.log('QA loaded');
    await js('localStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await click('.home-project-open');
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===3',
    );
    await click('[data-plugin-launcher]');
    await wait('!!document.querySelector(".builtin-feature-row")');
    await js(
      `Array.from(document.querySelectorAll('.builtin-feature-open')).find(e=>e.textContent.includes('게임 UI')).click()`,
    );
    await wait('!!document.querySelector(".game-ui-controls")');
    await select('새 게임 화면 비율', 'pc-1200');
    await js(
      `Array.from(document.querySelectorAll('.game-ui-controls button')).find(e=>e.textContent==='게임 화면 틀 추가').click()`,
    );
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi()).length===1)()',
    );
    await wait('!!document.querySelector(".game-ui-stage")');
    assert.equal(
      await js(
        '(async()=> (await window.gameCanvas.listGameUi())[0].descriptionPath)()',
      ),
      null,
    );
    assert.equal(
      await js(
        '(async()=> (await window.gameCanvas.listGameUi())[0].viewportHeight)()',
      ),
      1200,
    );
    await click('[aria-label="게임 UI 편집"]');
    await wait('!!document.querySelector(".game-ui-inspector")');
    await select('UI 추가', 'health');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items.length===1)()',
    );
    await select('UI 외형', 'ring');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].shape==="ring")()',
    );
    await fill('UI 너비', 180);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].width===180)()',
    );
    await fill('UI 높이', 180);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].height===180)()',
    );
    await js(
      `Array.from(document.querySelectorAll('.game-ui-drag-handle button')).find(e=>e.textContent==='UI 설명 문서 만들기').click()`,
    );
    await wait(
      '(async()=> !!(await window.gameCanvas.listGameUi())[0].descriptionPath)()',
    );
    await wait(
      '(async()=> (await window.gameCanvas.listDocuments()).some(d=>d.relativePath.startsWith("docs/ui/")))()',
    );
    await js(
      `(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.relativePath.startsWith('docs/ui/'));await window.gameCanvas.saveDocument({relativePath:d.relativePath,title:d.title,body:d.body.replace('현재 체력과 최대 체력을 표시합니다.','한글로 직접 편집한 기능 설명')})})()`,
    );
    await fill('UI 이름', '플레이어 체력');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].name==="플레이어 체력")()',
    );
    await wait(
      '(async()=> (await window.gameCanvas.listDocuments()).find(d=>d.relativePath.startsWith("docs/ui/")).body.includes("한글로 직접 편집한 기능 설명"))()',
    );
    await select('HUD 조합', 'inventory');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items.length===2)()',
    );
    await wait(`!!document.querySelector('[aria-label="슬롯 개수"]')`);
    await fill('슬롯 20 수량', 42);
    await fill('슬롯 개수', 12);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[1].count===12)()',
    );
    await fill('슬롯 개수', 20);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[1].count===20)()',
    );
    assert.equal(
      await js(
        '(async()=> (await window.gameCanvas.listGameUi())[0].items[1].slots[19].quantity)()',
      ),
      42,
    );
    await click('[data-plugin-launcher]');
    await js(
      `Array.from(document.querySelectorAll('.builtin-feature-open')).find(e=>e.textContent.includes('게임 UI')).click()`,
    );
    await wait('!!document.querySelector(".game-ui-controls")');
    await js(
      `Array.from(document.querySelectorAll('.game-ui-controls>button')).find(e=>e.textContent.includes('게임 화면')).click()`,
    );
    await new Promise((r) => setTimeout(r, 350));
    const before = await js(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[1].x)()',
    );
    const location = await js(
      `(()=>{const e=document.querySelectorAll('[data-game-ui-item]')[1],r=e.getBoundingClientRect();return{x:r.x+10,y:r.y+10}})()`,
    );
    await mouse('mouseMove', location.x, location.y);
    await mouse('mouseDown', location.x, location.y);
    await mouse('mouseMove', location.x + 40, location.y + 30);
    await mouse('mouseUp', location.x + 40, location.y + 30);
    await wait(
      `(async()=> (await window.gameCanvas.listGameUi())[0].items[1].x!==${before})()`,
    );
    await js('window.gameCanvas.undo()');
    await wait(
      `(async()=> (await window.gameCanvas.listGameUi())[0].items[1].x===${before})()`,
    );
    await select('UI 추가', 'skills');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items.length===3)()',
    );
    await select('UI 외형', 'circle');
    await fill('Y 위치', 1080);
    await fill('슬롯 1 쿨다운 (%)', 50);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[2].slots[0].cooldown===50)()',
    );
    assert.equal(
      await js('document.querySelectorAll(".game-ui-stage clipPath").length'),
      1,
    );
    await js(
      'window.gameCanvas.exportGameUiPng=async input=>{window.qaGameUiPng=input;return true};true',
    );
    await js(
      `Array.from(document.querySelectorAll('.game-ui-drag-handle button')).find(e=>e.textContent==='PNG').click()`,
    );
    await wait('!!window.qaGameUiPng');
    const png = await js('window.qaGameUiPng.data');
    assert.deepEqual(nativeImage.createFromDataURL(png).getSize(), {
      width: 1920,
      height: 1200,
    });
    await fs.mkdir('out/game-ui-ui', { recursive: true });
    await fs.writeFile(
      'out/game-ui-ui/export.png',
      Buffer.from(png.split(',')[1], 'base64'),
    );
    await fs.writeFile(
      'out/game-ui-ui/frame.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    assert.deepEqual(errors, []);
    console.log(
      'Game UI Electron: presets, ring, optional document, manual description, inventory retention, native drag and Undo passed.',
    );
  } catch (e) {
    await fs.mkdir('out/game-ui-ui', { recursive: true });
    await fs.writeFile(
      'out/game-ui-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.error(e);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    win.destroy();
    app.exit(process.exitCode ?? 0);
  }
}
void run();
