import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/text-ui/profile'));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/text-ui', { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1360,
    height: 1000,
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
  const js = (code) => win.webContents.executeJavaScript(code);
  const pause = (ms = 70) => new Promise((r) => setTimeout(r, ms));
  const wait = async (code) => {
    for (let i = 0; i < 170; i++) {
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
  const click = async (x, y, clickCount = 1) => {
    for (const type of ['mouseDown', 'mouseUp'])
      win.webContents.sendInputEvent({
        type,
        x,
        y,
        button: 'left',
        clickCount,
      });
    await pause();
  };
  const toolbar = async (label) => {
    const point = await js(
      `(()=>{const r=document.querySelector('.canvas-text-toolbar [aria-label=${JSON.stringify(label)}]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    await click(point.x, point.y);
  };
  const selectLine = async (selector, full = false) => {
    await js(
      `(()=>{const p=document.querySelector(${JSON.stringify(selector)}),range=document.createRange();p.closest('.tiptap').focus();range.selectNodeContents(p);${full ? '' : 'range.collapse(true);'}const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`,
    );
    await pause();
  };
  const list = () => js('window.gameCanvas.listDrawings()');
  const saved = (condition) =>
    wait(
      `window.gameCanvas.listDrawings().then(o=>o.length===1&&(${condition}))`,
    );
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===3',
    );
    await js(
      `(async()=>{const s=await window.gameCanvas.getCanvasSheets();await window.gameCanvas.changeCanvasSheets({action:'add',id:'text-test',name:'텍스트 테스트',expected:s.raw})})()`,
    );
    await wait('document.querySelectorAll("[role=tab]").length===2');
    await js(
      '[...document.querySelectorAll("[role=tab]")].find(e=>e.textContent.includes("텍스트 테스트")).click()',
    );
    await wait('document.querySelectorAll(".react-flow__node").length===0');
    await key('t');
    await click(340, 300);
    await wait(
      '!!document.querySelector(".canvas-text-node .tiptap[contenteditable=true]")',
    );
    await wait('document.activeElement?.classList.contains("tiptap")');
    await win.webContents.insertText('한글 텍스트 제목');
    await key('Enter');
    await toolbar('글머리 기호 목록');
    await win.webContents.insertText('첫 번째 항목');
    await key('Enter');
    await win.webContents.insertText('두 번째 항목');
    await key('Tab');
    await wait('!!document.querySelector(".canvas-text-node ul ul li")');
    await key('Tab', ['shift']);
    await key('Enter');
    await key('Enter');
    await toolbar('번호 목록');
    await win.webContents.insertText('숫자 첫 항목');
    await key('Enter');
    await win.webContents.insertText('숫자 둘째 항목');
    await wait(
      'document.querySelectorAll(".canvas-text-node ol > li").length===2',
    );
    await saved('o[0].geometry.document.includes("숫자 둘째 항목")');
    await fs.writeFile(
      'out/text-ui/lists.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    const original = (await list())[0];
    const content = JSON.parse(original.geometry.document);
    assert.equal(content.content[1].type, 'bulletList');
    assert.equal(content.content[1].content.length, 2);
    assert.equal(content.content[2].type, 'orderedList');
    await key('Enter');
    await key('Enter');
    await toolbar('굵게');
    await win.webContents.insertText('강조 텍스트');
    await saved('o[0].geometry.document.includes("강조 텍스트")');
    assert.match((await list())[0].geometry.document, /"type":"bold"/);
    // Composition must not trigger canvas shortcuts or save an incomplete text value.
    await js(
      `document.querySelector('.canvas-text-node .tiptap').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'ㅎ'}))`,
    );
    await win.webContents.insertText('한글 조합');
    await js(
      `document.querySelector('.canvas-text-node .tiptap').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한글 조합'}))`,
    );
    await key('Escape');
    await saved('o[0].geometry.document.includes("한글 조합")');
    assert.equal((await list()).length, 1);
    const expected = (await list())[0].geometry;
    await js(
      `document.querySelector('[title="프로젝트 홈으로 돌아가기"]').click()`,
    );
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      '[...document.querySelectorAll("[role=tab]")].some(e=>e.textContent.includes("텍스트 테스트"))',
    );
    await js(
      '[...document.querySelectorAll("[role=tab]")].find(e=>e.textContent.includes("텍스트 테스트")).click()',
    );
    await wait('!!document.querySelector(".canvas-text-node")');
    assert.deepEqual((await list())[0].geometry, expected);
    const position = await js(
      '(()=>{const r=document.querySelector(".canvas-text-node").getBoundingClientRect();return {x:Math.round(r.x+30),y:Math.round(r.y+20)}})()',
    );
    await click(position.x, position.y, 2);
    await wait(
      '!!document.querySelector(".canvas-text-node .tiptap[contenteditable=true]")',
    );
    await pause(100);
    await selectLine('.canvas-text-node ul > li:first-child > p');
    await toolbar('가운데 정렬');
    await saved(
      'JSON.parse(o[0].geometry.document).content[1].content[0].content[0].attrs?.textAlign==="center"',
    );
    assert.equal((await list())[0].geometry.align, 'left');
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-text-node ul > li:first-child")).textAlign',
      ),
      'center',
    );
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-text-node ul > li:first-child")).listStylePosition',
      ),
      'inside',
    );
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-text-node ul > li:first-child > p")).display',
      ),
      'inline',
    );
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-text-node ul > li:nth-child(2)")).textAlign',
      ),
      'left',
    );
    await selectLine('.canvas-text-node ol > li:last-child > p', true);
    await toolbar('오른쪽 정렬');
    await saved(
      'JSON.parse(o[0].geometry.document).content[2].content[1].content[0].attrs?.textAlign==="right"',
    );
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-text-node ol > li:last-child")).textAlign',
      ),
      'right',
    );
    await key('z', ['control']);
    await saved(
      '!JSON.parse(o[0].geometry.document).content[2].content[1].content[0].attrs?.textAlign',
    );
    await key('z', ['control', 'shift']);
    await saved(
      'JSON.parse(o[0].geometry.document).content[2].content[1].content[0].attrs?.textAlign==="right"',
    );
    await selectLine('.canvas-text-node .tiptap > p:first-child', true);
    await toolbar('가운데 정렬');
    await saved(
      'JSON.parse(o[0].geometry.document).content[0].attrs?.textAlign==="center"',
    );
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-text-node ol > li:first-child")).textAlign',
      ),
      'left',
    );
    await fs.writeFile(
      'out/text-ui/alignment.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await toolbar('텍스트 편집 완료');
    assert.equal(
      await js(
        'document.querySelectorAll(".canvas-text-toolbar [aria-pressed=true][aria-label$=정렬]").length',
      ),
      0,
    );
    await toolbar('오른쪽 정렬');
    await saved(
      '(()=>{const doc=JSON.parse(o[0].geometry.document);return doc.content[0].attrs?.textAlign==="right"&&doc.content[1].content.every(i=>i.content[0].attrs?.textAlign==="right")&&doc.content[2].content.every(i=>i.content[0].attrs?.textAlign==="right")})()',
    );
    await toolbar('텍스트 편집 완료');
    await wait('!!document.querySelector(".react-flow__resize-control")');
    const oldWidth = (await list())[0].transform.width;
    const handle = await js(
      '(()=>{const r=document.querySelector(".react-flow__resize-control.bottom.right.handle").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()',
    );
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      ...handle,
      button: 'left',
      clickCount: 1,
    });
    for (let i = 1; i <= 6; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: handle.x + i * 12,
        y: handle.y + i * 2,
        button: 'left',
        modifiers: ['leftButtonDown'],
      });
      await pause();
    }
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: handle.x + 72,
      y: handle.y + 12,
      button: 'left',
      clickCount: 1,
    });
    await saved(`o[0].transform.width>${oldWidth + 30}`);
    await toolbar('텍스트 복제');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===2)');
    assert.deepEqual((await list())[0].geometry, (await list())[1].geometry);
    await toolbar('텍스트 삭제');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===1)');
    await js('window.gameCanvas.undo()');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===2)');
    await js('window.gameCanvas.redo()');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===1)');
    const retryPosition = await js(
      '(()=>{const r=document.querySelector(".canvas-text-node").getBoundingClientRect();return {x:Math.round(r.x+24),y:Math.round(r.y+20)}})()',
    );
    await click(retryPosition.x, retryPosition.y, 2);
    await wait(
      'document.activeElement?.getAttribute("aria-label")==="캔버스 텍스트 내용"',
    );
    await js(
      'window.qaTextSave=window.gameCanvas.applyDrawingCommand;window.gameCanvas.applyDrawingCommand=async()=>{throw Error("QA 텍스트 저장 실패")};void 0',
    );
    await win.webContents.insertText('저장 재시도 내용');
    await wait(
      'document.querySelector(".canvas-text-error")?.textContent.includes("QA 텍스트 저장 실패")',
    );
    assert.ok(
      await js(
        '(async()=>{const w=await window.gameCanvas.getWorkspace(),o=(await window.gameCanvas.listDrawings())[0];return (await window.gameCanvas.getEditorDraft(`canvas-text:${w.saveScope}:${o.id}`))?.body.includes("저장 재시도 내용")})()',
      ),
    );
    await js(
      'window.gameCanvas.applyDrawingCommand=window.qaTextSave;document.querySelector(".canvas-text-error button").click()',
    );
    await saved('o[0].geometry.document.includes("저장 재시도 내용")');
    await wait('!document.querySelector(".canvas-text-error")');
    await key('Escape');
    const panePoint = await js(
      `(()=>{for(let y=250;y<700;y+=80)for(let x=500;x<1100;x+=80)if(document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'))return {x,y};throw Error('No empty canvas point')})()`,
    );
    await click(panePoint.x, panePoint.y);
    await key('t');
    await click(panePoint.x, panePoint.y);
    await wait('document.activeElement?.classList.contains("tiptap")');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===2)');
    await pause(550);
    assert.equal(
      (await list()).length,
      2,
      'An empty box survives while editing',
    );
    await toolbar('굵게');
    await pause(150);
    assert.equal(
      (await list()).length,
      2,
      'Formatting an empty box does not finish editing',
    );
    await key('Escape');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===1)');
    await js('window.gameCanvas.undo()');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===2)');
    await pause(550);
    assert.equal(
      (await list()).length,
      2,
      'Undo restores an empty box without immediately deleting it',
    );
    await js('window.gameCanvas.redo()');
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===1)');
    await click(panePoint.x, panePoint.y);
    await key('t');
    await click(panePoint.x, panePoint.y);
    await wait('document.activeElement?.classList.contains("tiptap")');
    await win.webContents.insertText('  \n\t');
    await click(panePoint.x + 120, panePoint.y + 120);
    await wait('window.gameCanvas.listDrawings().then(o=>o.length===1)');
    // The grouped runtime picks up a replaced bridge method; OS clipboard is untouched.
    await js(
      `window.qaPaste=window.gameCanvas.pasteCanvasClipboard;window.qaPasteCalls=0;window.gameCanvas.pasteCanvasClipboard=async()=>{window.qaPasteCalls++;return {kind:'text',text:'<b>붙여넣은 한글</b>\\n두 번째 줄'}};void 0`,
    );
    await click(panePoint.x, panePoint.y);
    await key('v', ['control']);
    await wait(
      'window.gameCanvas.listDrawings().then(o=>o.some(v=>v.kind==="text"&&v.geometry.document.includes("붙여넣은 한글")))',
    );
    assert.equal(await js('window.qaPasteCalls'), 1);
    assert.ok(
      (await list()).some((o) =>
        o.geometry.document.includes('<b>붙여넣은 한글</b>'),
      ),
    );
    await js('window.gameCanvas.pasteCanvasClipboard=window.qaPaste;void 0');
    // A browser File drop must use canvas coordinates and send file bytes, never navigate.
    await js(
      `window.qaImport=window.gameCanvas.importFiles;window.gameCanvas.importFiles=async(input)=>{window.qaDropped=input;return []};void 0`,
    );
    await js(
      `(()=>{const d=new DataTransfer();d.items.add(new File(['# 드롭 한글'], 'drag.md', {type:'text/markdown'}));document.querySelector('.react-flow__pane').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:${panePoint.x},clientY:${panePoint.y},dataTransfer:d}));})()`,
    );
    await wait('!!window.qaDropped');
    assert.equal(await js('window.qaDropped.files[0].name'), 'drag.md');
    assert.equal(
      await js('new TextDecoder().decode(window.qaDropped.files[0].bytes)'),
      '# 드롭 한글',
    );
    assert.ok(
      await js(
        'Number.isFinite(window.qaDropped.x)&&Number.isFinite(window.qaDropped.y)',
      ),
    );
    await js('window.gameCanvas.importFiles=window.qaImport;void 0');
    win.setSize(1024, 768);
    await pause(150);
    await fs.writeFile(
      'out/text-ui/compact.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    assert.equal(
      await js('document.documentElement.scrollWidth>innerWidth'),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: text editing, empty-box cleanup/undo, whitespace cleanup, plain-text paste, File drop input, durable save retry and compact layout.',
    );
  } catch (error) {
    console.error(error);
    console.log(
      await js(
        '(async()=>({body:document.body.innerText.slice(-1500),drawings:await window.gameCanvas.listDrawings(),html:document.querySelector(".canvas-text-node")?.innerHTML,errors:[] }))()',
      ),
    );
    await fs.writeFile(
      'out/text-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
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
