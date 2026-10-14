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
    await select('UI 외형', 'rounded');
    const detail = async (label, value, key) => {
      await fill(label, value);
      await wait(
        `(async()=> (await window.gameCanvas.listGameUi())[0].items[0][${JSON.stringify(key)}]===${JSON.stringify(key.endsWith('Opacity') ? value / 100 : value)})()`,
      );
    };
    await detail('배경색', '#112233', 'backgroundColor');
    await detail('배경 불투명도 (%)', 35, 'backgroundOpacity');
    await detail('테두리 색', '#abcdef', 'borderColor');
    await detail('테두리 두께', 6, 'borderWidth');
    await detail('테두리 불투명도 (%)', 80, 'borderOpacity');
    await detail('모서리 R값', 18, 'cornerRadius');
    await detail('UI 회전 (°)', 45, 'rotation');
    await detail('최소 값', 20, 'minimum');
    await detail('현재 값', 60, 'value');
    await select('채움 방향', 'left');
    await wait(
      'document.querySelector("[data-ui-part=progress]")?.dataset.ratio==="0.5"',
    );
    assert.equal(
      await js(
        'document.querySelector("[data-ui-part=body]>path")?.getAttribute("fill-opacity")',
      ),
      '0.35',
    );
    assert.match(
      await js(
        'document.querySelector("[data-game-ui-item]").getAttribute("transform")',
      ),
      /rotate\(45/,
    );
    await js(
      `Array.from(document.querySelectorAll('.game-ui-detail-editor button')).find(e=>e.textContent==='낮은 값 경고 추가').click()`,
    );
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].thresholds?.length===2)()',
    );
    const persisted = await js(
      '(async()=>JSON.stringify(await window.gameCanvas.listGameUi()))()',
    );
    await js(
      `(()=>{const e=document.querySelector('[aria-label="미리보기 값"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'36');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait(
      'document.querySelector("[data-ui-part=progress]")?.dataset.ratio==="0.2"',
    );
    assert.equal(
      await js(
        '(async()=>JSON.stringify(await window.gameCanvas.listGameUi()))()',
      ),
      persisted,
    );
    assert.equal(
      await js(
        'document.querySelector("[data-ui-part=progress] rect")?.getAttribute("fill")',
      ),
      '#ef4444',
    );
    await js(
      `Array.from(document.querySelectorAll('.game-ui-detail-editor button')).find(e=>e.textContent==='미리보기 초기화').click()`,
    );
    await wait(
      'document.querySelector("[data-ui-part=progress]")?.dataset.ratio==="0.5"',
    );
    await select('UI 외형', 'ring');
    await detail('원형 시작 각도 (°)', 0, 'radialStart');
    await detail('원형 전체 각도 (°)', 270, 'radialSweep');
    await detail('링 두께', 12, 'ringWidth');
    await select('외형 편집 상태', 'hover');
    await fill('배경색', '#445566');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].stateStyles?.hover?.backgroundColor==="#445566")()',
    );
    assert.equal(
      await js(
        'document.querySelector("[data-ui-part=body]>path")?.getAttribute("fill")',
      ),
      '#445566',
    );
    await select('외형 편집 상태', 'normal');
    await js(
      `Array.from(document.querySelectorAll('.game-ui-detail-editor button')).find(e=>e.textContent==='스타일 복사').click()`,
    );
    const handle = await js(
      `(()=>{const r=document.querySelector('[data-game-ui-rotate]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await mouse('mouseMove', handle.x, handle.y);
    await mouse('mouseDown', handle.x, handle.y);
    await mouse('mouseMove', handle.x + 30, handle.y);
    await mouse('mouseUp', handle.x + 30, handle.y);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].rotation!==45)()',
    );
    await js('window.gameCanvas.undo()');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].rotation===45)()',
    );
    const resize = await js(
      `(()=>{const e=document.querySelector('[data-game-ui-item]'),p=new DOMPoint(180,180).matrixTransform(e.getScreenCTM());return{x:p.x,y:p.y};})()`,
    );
    await mouse('mouseMove', resize.x, resize.y);
    await mouse('mouseDown', resize.x, resize.y);
    await mouse('mouseMove', resize.x + 20, resize.y + 10);
    await mouse('mouseUp', resize.x + 20, resize.y + 10);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].width>180)()',
    );
    await js('window.gameCanvas.undo()');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].width===180&&(await window.gameCanvas.listGameUi())[0].items[0].height===180)()',
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
    await js(
      `Array.from(document.querySelectorAll('.game-ui-detail-editor button')).find(e=>e.textContent==='스타일 붙여넣기').click()`,
    );
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[1].borderWidth===6)()',
    );
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
      `(()=>{const e=document.querySelectorAll('[data-game-ui-item]')[1],p=new DOMPoint(20,20).matrixTransform(e.getScreenCTM());return{x:p.x,y:p.y}})()`,
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
    assert.ok(
      (await js(
        'document.querySelectorAll(".game-ui-stage clipPath").length',
      )) >= 1,
    );
    await fill('슬롯 1 전체 쿨다운 (초)', 10);
    await fill('슬롯 1 남은 쿨다운 (초)', 3);
    await select('쿨다운 채움', 'radial');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[2].slots[0].cooldownRemaining===3)()',
    );
    assert.ok(
      await js('!!document.querySelector("[data-ui-part=cooldown] path")'),
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
