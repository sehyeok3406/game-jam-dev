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
  const select = async (label, value) => {
    if (label === 'PNG 출력 상태')
      await js(
        `Array.from(document.querySelectorAll('.game-ui-inspector-toolbar button')).find(e=>e.textContent==='화면 설정').click()`,
      );
    if (label === 'UI 추가' || label === 'HUD 조합') {
      if (!(await js('!!document.querySelector(".game-ui-inspector")')))
        await click('[aria-label="게임 UI 편집"]');
      if (!(await js('!!document.querySelector(".game-ui-library")')))
        await click('[aria-label="UI 추가 열기"]');
      if (label === 'UI 추가') return click(`[data-game-ui-kind="${value}"]`);
    }
    return js(
      `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  };
  const fill = (label, value) =>
    js(
      `(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');e.closest('details')?.setAttribute('open','');e.focus();e.value=${JSON.stringify(String(value))};e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`,
    );
  let primaryDown = false;
  async function mouse(type, x, y) {
    if (type === 'mouseDown') primaryDown = true;
    if (type === 'mouseUp') primaryDown = false;
    win.webContents.sendInputEvent({
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      clickCount: 1,
      modifiers: primaryDown ? ['leftbuttondown'] : [],
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
    await js(
      `(()=>{const send=window.gameCanvas.applyGameUiCommand;window.qaGameUiCommands=[];window.gameCanvas.applyGameUiCommand=async c=>{const record={command:structuredClone(c)};window.qaGameUiCommands.push(record);try{return await send(c)}catch(e){record.error=String(e);throw e}}})()`,
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===3',
    );
    await click('[data-plugin-launcher]');
    await wait('!!document.querySelector(".builtin-feature-row")');
    win.setSize(980, 640);
    await pause();
    assert.equal(
      await js(`!!document.querySelector('[aria-label="플러그인 패널 닫기"]')`),
      false,
    );
    assert.ok(
      await js(
        `Array.from(document.querySelectorAll('.builtin-feature-row')).every(e=>{const r=e.getBoundingClientRect(),b=e.querySelector('strong').getBoundingClientRect(),s=e.querySelector('[role=switch]').getBoundingClientRect();return b.width>110&&b.height<45&&r.right<=innerWidth&&s.right<=r.right})`,
      ),
    );
    await fs.mkdir('out/game-ui-ui', { recursive: true });
    await fs.writeFile(
      'out/game-ui-ui/plugins-small.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(1600, 1100);
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
    assert.equal(
      await js(
        `!!document.querySelector('[aria-label="속성 패널 배치 전환"], [aria-label="UI 속성 닫기"]')`,
      ),
      false,
    );
    assert.equal(
      await js(
        '!!document.querySelector(".game-ui-detail-editor, .game-ui-selection-actions")',
      ),
      false,
    );
    assert.equal(
      await js('document.querySelectorAll(".game-ui-library-category").length'),
      3,
    );
    await js(
      `(()=>{const e=document.querySelector('[aria-label="UI 요소 검색"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'체력');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait('document.querySelectorAll("[data-game-ui-kind]").length===1');
    assert.equal(
      await js(
        'document.querySelector("[data-game-ui-kind]").dataset.gameUiKind',
      ),
      'health',
    );
    await js(
      `(()=>{const e=document.querySelector('[aria-label="UI 요소 검색"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'zzzz');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait('document.querySelectorAll("[data-game-ui-kind]").length===0');
    await js(
      `(()=>{const e=document.querySelector('[aria-label="UI 요소 검색"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait('document.querySelectorAll("[data-game-ui-kind]").length===10');
    await fs.writeFile(
      'out/game-ui-ui/library.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await select('UI 추가', 'health');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items.length===1)()',
    );
    await select('UI 외형', 'ring');
    assert.equal(
      await js('!!document.querySelector(".game-ui-library")'),
      false,
    );
    assert.equal(
      await js('document.querySelector(".game-ui-layers").open'),
      false,
    );
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
    await wait(
      'document.querySelector(".game-ui-state-banner")?.textContent.includes("호버")',
    );
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
      `(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.relativePath.startsWith('docs/ui/'));await window.gameCanvas.saveDocument({relativePath:d.relativePath,title:d.title,body:d.body.replace('현재 체력과 최대 체력을 표시합니다.','한글로 직접 편집한 기능 설명<br>둘째 줄')})})()`,
    );
    await wait(
      `Array.from(document.querySelectorAll('.document-card td')).some(e=>e.textContent.includes('한글로 직접 편집한 기능 설명')&&e.querySelector('br')&&!e.textContent.includes('<br>'))`,
    );
    if (!(await js('!!document.querySelector(".game-ui-inspector")')))
      await click('[aria-label="게임 UI 편집"]');
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
    // Inspector UX: preserve invalid drafts, cancel safely, edit a range atomically,
    // distinguish test/export state, and keep the panel outside canvas transforms.
    await js(`document.querySelector('.game-ui-layer-list button').click()`);
    await wait(
      'document.querySelector(\'[aria-label="UI 이름"]\')?.value==="플레이어 체력"',
    );
    assert.equal(
      await js(
        'document.querySelector(\'[aria-label="외형 편집 상태"]\').value',
      ),
      'normal',
    );
    assert.equal(
      await js(
        'document.querySelector(".game-ui-inspector").closest(".react-flow__viewport")',
      ),
      null,
    );
    await fill('UI 너비', 1);
    await wait(
      'document.querySelector(\'[aria-label="UI 너비"]\').getAttribute("aria-invalid")==="true"',
    );
    assert.equal(
      await js(
        '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].width)()',
      ),
      180,
    );
    assert.equal(
      await js('document.querySelector(\'[aria-label="UI 너비"]\').value'),
      '1',
    );
    await js(
      `document.querySelector('[aria-label="UI 너비"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    );
    await wait(
      'document.querySelector(\'[aria-label="UI 너비"]\').value==="180"',
    );
    await fill('배경색', '#GGGGGG');
    await wait(
      'document.querySelector(\'[aria-label="배경색"]\').getAttribute("aria-invalid")==="true"',
    );
    assert.equal(
      await js(
        '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].backgroundColor)()',
      ),
      '#112233',
    );
    await js(
      `document.querySelector('[aria-label="배경색"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    );
    await wait(
      'document.querySelector(\'[aria-label="배경색"]\').value==="#112233"',
    );
    await js(`(()=>{
      const low=document.querySelector('[aria-label="최소 값"]'), high=document.querySelector('[aria-label="최대 값"]');
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      low.closest('details').open=true;low.focus();set.call(low,'200');low.dispatchEvent(new Event('input',{bubbles:true}));
      high.focus();set.call(high,'500');high.dispatchEvent(new Event('input',{bubbles:true}));high.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    })()`);
    await wait(
      '(async()=>{const i=(await window.gameCanvas.listGameUi())[0].items[0];return i.minimum===200&&i.maximum===500&&i.value===200})()',
    );
    await wait(
      'document.querySelector(".game-ui-detail-editor").textContent.includes("60 → 200")',
    );
    await js('window.gameCanvas.undo()');
    await wait(
      '(async()=>{const i=(await window.gameCanvas.listGameUi())[0].items[0];return i.minimum===20&&i.maximum===100&&i.value===60})()',
    );

    const scrubLabel = await js(
      `(()=>{const e=document.querySelector('[aria-label="UI 너비"]'),l=e.labels[0];l.scrollIntoView({block:'center'});const r=l.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await mouse('mouseMove', scrubLabel.x, scrubLabel.y);
    await mouse('mouseDown', scrubLabel.x, scrubLabel.y);
    await mouse('mouseMove', scrubLabel.x + 20, scrubLabel.y);
    await mouse('mouseUp', scrubLabel.x + 20, scrubLabel.y);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].width===185)()',
    );
    await js('window.gameCanvas.undo()');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].width===180)()',
    );
    await js(
      `(()=>{const e=document.querySelector('[aria-label="배경색 선택"]');e.closest('details').open=true;e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'#223344');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait(
      `document.querySelector('[data-ui-part="body"]>path')?.getAttribute('fill')==='#223344'`,
    );
    assert.equal(
      await js(
        '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].backgroundColor)()',
      ),
      '#112233',
    );
    await js(
      `document.querySelector('[aria-label="배경색 선택"]').dispatchEvent(new Event('change',{bubbles:true}))`,
    );
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].backgroundColor==="#223344")()',
    );
    assert.equal(
      await js(
        'window.qaGameUiCommands.filter(c=>c.command.patches?.some(p=>p.changes.backgroundColor==="#223344")).length',
      ),
      1,
    );
    await js('window.gameCanvas.undo()');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[0].backgroundColor==="#112233")()',
    );

    const storedBeforeTest = await js(
      '(async()=>JSON.stringify(await window.gameCanvas.listGameUi()))()',
    );
    await fill('테스트 값 직접 입력', 36);
    await wait(
      'document.querySelector(".game-ui-rule-note")?.textContent.includes("20% 이하")',
    );
    assert.equal(
      await js(
        '(async()=>JSON.stringify(await window.gameCanvas.listGameUi()))()',
      ),
      storedBeforeTest,
    );
    await select('PNG 출력 상태', 'saved');
    await js(
      `window.qaGameUiPng=null;Array.from(document.querySelectorAll('.game-ui-drag-handle button')).find(e=>e.textContent==='PNG').click()`,
    );
    await wait('!!window.qaGameUiPng');
    const savedPng = await js('window.qaGameUiPng.data');
    await select('PNG 출력 상태', 'preview');
    await js(
      `window.qaGameUiPng=null;Array.from(document.querySelectorAll('.game-ui-drag-handle button')).find(e=>e.textContent==='PNG').click()`,
    );
    await wait('!!window.qaGameUiPng');
    assert.notEqual(await js('window.qaGameUiPng.data'), savedPng);
    await select('PNG 출력 상태', 'saved');
    await click('.game-ui-test-banner button');
    await wait('!document.querySelector(".game-ui-test-banner")');
    await js(
      `Array.from(document.querySelectorAll('.game-ui-inspector-toolbar button')).find(e=>e.textContent==='속성').click()`,
    );
    assert.equal(
      await js(
        '(async()=>JSON.stringify(await window.gameCanvas.listGameUi()))()',
      ),
      storedBeforeTest,
    );

    const widthBeforeZoom = await js(
      'document.querySelector(".game-ui-inspector").getBoundingClientRect().width',
    );
    assert.equal(
      await js(
        `(()=>{const p=document.querySelector('.game-ui-inspector').getBoundingClientRect(),v=document.querySelector('.react-flow').getBoundingClientRect(),m=document.querySelector('.canvas-minimap-panel')?.getBoundingClientRect();return v.right<=p.left&&(!m||m.right<=p.left)})()`,
      ),
      true,
    );
    const transformBeforeZoom = await js(
      'document.querySelector(".react-flow__viewport").style.transform',
    );
    await click('[aria-label="확대"]');
    await wait(
      `document.querySelector('.react-flow__viewport').style.transform!==${JSON.stringify(transformBeforeZoom)}`,
    );
    assert.equal(
      await js(
        'document.querySelector(".game-ui-inspector").getBoundingClientRect().width',
      ),
      widthBeforeZoom,
    );
    await click('[aria-label="축소"]');
    assert.ok(
      await js(
        '!!document.querySelector(".canvas-dock .canvas-game-ui-host .game-ui-inspector")',
      ),
    );
    await click('[aria-label="AI 작업 패널"]');
    await wait('!document.querySelector(".game-ui-inspector")');
    assert.equal(
      await js('document.querySelectorAll(".canvas-dock").length'),
      1,
    );
    await js(`document.querySelector('[aria-label="게임 UI 편집"]').click()`);
    await wait('!!document.querySelector(".canvas-dock .game-ui-inspector")');
    assert.equal(
      await js(
        '(async()=>JSON.stringify(await window.gameCanvas.listGameUi()))()',
      ),
      storedBeforeTest,
    );

    await select('외형 편집 상태', 'pressed');
    await wait('!!document.querySelector(".game-ui-state-banner")');
    await js(
      `document.querySelectorAll('.game-ui-layer-list button')[1].click()`,
    );
    await wait(
      'document.querySelector(\'[aria-label="외형 편집 상태"]\')?.value==="normal"',
    );
    assert.equal(
      await js('!!document.querySelector(".game-ui-state-banner")'),
      false,
    );
    await js(
      `document.querySelector('.game-ui-layer-list button').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`,
    );
    await wait(
      'document.querySelector(".game-ui-inspector-header").textContent.includes("2개 UI 선택")',
    );
    assert.equal(
      await js('!!document.querySelector(\'[aria-label="채움색"]\')'),
      false,
    );
    await fill('테두리 두께', 5);
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items.slice(0,2).every(i=>i.borderWidth===5))()',
    );
    await js('window.gameCanvas.undo()');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items.slice(0,2).every(i=>i.borderWidth===6))()',
    );
    await select('UI 추가', 'text');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items.length===4)()',
    );
    await wait('!!document.querySelector(\'[aria-label="UI 문구"]\')');
    assert.ok(
      await js(
        'document.querySelector(\'[aria-label="UI 이름"]\').labels[0].getBoundingClientRect().height > 10',
      ),
    );
    await fill('UI 이름', '대화 내용');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[3].name==="대화 내용")()',
    );
    await js('window.gameCanvas.undo()');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[3].name==="텍스트")()',
    );
    const textStyle = async (label, value, field) => {
      await fill(label, value);
      await wait(
        `(async()=> (await window.gameCanvas.listGameUi())[0].items[3][${JSON.stringify(field)}]===${JSON.stringify(value)})()`,
      );
    };
    await textStyle('배경색', '#fce7f3', 'backgroundColor');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[3].backgroundOpacity===1)()',
    );
    await click('[aria-label="테두리 표시"]');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[3].borderWidth===2)()',
    );
    await textStyle('테두리 색', '#be185d', 'borderColor');
    await textStyle('테두리 두께', 6, 'borderWidth');
    await textStyle('모서리 R값', 14, 'cornerRadius');
    // Locate by kind from saved data, rather than relying on SVG selection handles.
    const textId = await js(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[3].id)()',
    );
    const body = `[data-game-ui-item="${textId}"] [data-ui-part="body"]`;
    assert.equal(
      await js(`document.querySelector('${body} > path').getAttribute('fill')`),
      '#fce7f3',
    );
    assert.equal(
      await js(
        `document.querySelector('${body} > path[stroke]').getAttribute('stroke')`,
      ),
      '#be185d',
    );
    assert.match(
      await js(`document.querySelector('${body} > path').getAttribute('d')`),
      /^M15 1/,
    );
    await click('[aria-label="테두리 표시"]');
    await wait(
      `document.querySelector('${body} > path[stroke]').getAttribute('stroke-opacity')==='0'`,
    );
    await click('[aria-label="테두리 표시"]');
    await wait(
      `document.querySelector('${body} > path[stroke]').getAttribute('stroke-opacity')==='1'`,
    );
    await fs.writeFile(
      'out/game-ui-ui/text-appearance.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      `Array.from(document.querySelectorAll('.game-ui-inspector-toolbar button')).find(e=>e.textContent==='화면 설정').click()`,
    );
    await wait('!!document.querySelector(\'[aria-label="게임 화면 배경색"]\')');
    await fill('게임 화면 배경색', '#34495e');
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].backgroundColor==="#34495e")()',
    );
    assert.equal(
      await js(
        'document.querySelector(".game-ui-stage > rect").getAttribute("fill")',
      ),
      '#34495e',
    );
    await js('window.gameCanvas.undo()');
    await wait(
      'document.querySelector(".game-ui-stage > rect").getAttribute("fill")==="#ffffff"',
    );
    await js('window.gameCanvas.redo()');
    await wait(
      'document.querySelector(".game-ui-stage > rect").getAttribute("fill")==="#34495e"',
    );
    await js(
      `window.qaGameUiPng=null;Array.from(document.querySelectorAll('.game-ui-drag-handle button')).find(e=>e.textContent==='PNG').click()`,
    );
    await wait('!!window.qaGameUiPng');
    const backgroundPixel = nativeImage
      .createFromDataURL(await js('window.qaGameUiPng.data'))
      .toBitmap()
      .subarray(0, 4);
    assert.deepEqual([...backgroundPixel], [94, 73, 52, 255]);
    await fs.writeFile(
      'out/game-ui-ui/screen-background.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      `Array.from(document.querySelectorAll('.game-ui-inspector-toolbar button')).find(e=>e.textContent==='속성').click()`,
    );
    await js(
      `Array.from(document.querySelectorAll('.game-ui-selection-actions button')).find(e=>e.textContent==='잠금 전환').click()`,
    );
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi())[0].items[3].locked)()',
    );
    await wait(
      'document.querySelector(\'[aria-label="UI 이름"]\').matches(":disabled")',
    );
    assert.equal(
      await js(
        'document.querySelector(\'[aria-label="UI 문구"]\').matches(":disabled")',
      ),
      true,
    );
    assert.equal(
      await js(
        'document.querySelector(\'[aria-label="미리보기 상태"]\').matches(":disabled")',
      ),
      false,
    );

    await click('[data-plugin-launcher]');
    await js(
      `Array.from(document.querySelectorAll('.builtin-feature-open')).find(e=>e.textContent.includes('게임 UI')).click()`,
    );
    await wait('!!document.querySelector(".game-ui-controls")');
    await js(
      `Array.from(document.querySelectorAll('.game-ui-controls button')).find(e=>e.textContent==='게임 화면 틀 추가').click()`,
    );
    await wait(
      '(async()=> (await window.gameCanvas.listGameUi()).length===2)()',
    );
    await wait(
      'document.querySelectorAll(\'[aria-label="게임 UI 편집"]\').length===2',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    await js(
      `document.querySelectorAll('[aria-label="게임 UI 편집"]')[1].click()`,
    );
    await wait('document.querySelectorAll(".game-ui-inspector").length===1');
    await wait('!!document.querySelector(".game-ui-library")');
    await js(
      `document.querySelectorAll('[aria-label="게임 UI 편집"]')[0].click()`,
    );
    await wait(
      'document.querySelector(\'[aria-label="UI 이름"]\')?.value==="텍스트"',
    );
    assert.equal(
      await js('document.querySelectorAll(".game-ui-inspector").length'),
      1,
    );
    await click('[aria-label="작업 패널 닫기"]');
    await wait('!document.querySelector(".canvas-dock")');
    assert.equal(
      await js(
        '!!document.querySelector(".game-ui-inspector-host[data-game-ui-dock=open]")',
      ),
      false,
    );
    await js(
      `document.querySelectorAll('[aria-label="게임 UI 편집"]')[0].click()`,
    );
    await wait('!!document.querySelector(".game-ui-layer-list button")');
    await js(
      `document.querySelector('.game-ui-layer-list button').click();document.querySelector('.game-ui-inspector-scroll').scrollTop=0`,
    );
    await wait(
      'document.querySelector(\'[aria-label="UI 이름"]\')?.value==="플레이어 체력"',
    );
    await js(`document.querySelector('.game-ui-inspector-scroll').scrollTop=0`);
    await fs.writeFile(
      'out/game-ui-ui/inspector-light.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    const panelCapture = await js(
      `(()=>{const r=document.querySelector('.game-ui-inspector').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()`,
    );
    await fs.writeFile(
      'out/game-ui-ui/inspector-panel.png',
      (await win.webContents.capturePage(panelCapture)).toPNG(),
    );
    await js(`document.documentElement.dataset.theme='dark'`);
    await wait(
      `getComputedStyle(document.querySelector('.game-ui-inspector')).backgroundColor==='rgb(34, 37, 44)'`,
    );
    await pause();
    await fs.writeFile(
      'out/game-ui-ui/inspector-dark.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(`document.documentElement.dataset.theme='light'`);
    await wait(
      `getComputedStyle(document.querySelector('.game-ui-inspector')).backgroundColor==='rgb(255, 255, 255)'`,
    );
    await pause();
    win.setSize(1366, 768);
    await pause();
    assert.equal(
      await js(
        `(()=>{const r=document.querySelector('.game-ui-inspector').getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&r.height>400})()`,
      ),
      true,
    );
    assert.equal(
      await js(
        `(()=>{const p=document.querySelector('.game-ui-inspector').getBoundingClientRect(),t=document.querySelector('.bottom-toolbar').getBoundingClientRect();return t.right<=p.left||t.top>=p.bottom})()`,
      ),
      true,
    );
    await fs.writeFile(
      'out/game-ui-ui/inspector-small.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await fs.writeFile(
      'out/game-ui-ui/frame.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    assert.deepEqual(errors, []);
    console.log(
      'Game UI Electron: legacy editing, native drag/rotation/Undo, invalid drafts/Escape, atomic ranges, warning/test/export state, zoom-independent dock, shared panel switching, multi-selection/Undo, locked text, single active inspector, and themes/small window passed.',
    );
  } catch (e) {
    await fs.mkdir('out/game-ui-ui', { recursive: true });
    await fs.writeFile(
      'out/game-ui-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.error(e);
    console.error(
      await js('JSON.stringify(window.qaGameUiCommands?.filter(c=>c.error))'),
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    win.destroy();
    app.exit(process.exitCode ?? 0);
  }
}
void run();
