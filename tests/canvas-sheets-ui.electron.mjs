import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/canvas-sheets-ui/profile'));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/canvas-sheets-ui', { recursive: true });
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
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  try {
    const js = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code);
      } catch (error) {
        throw new Error(code + '\n' + error.message);
      }
    };
    const wait = async (code) => {
      for (let i = 0; i < 160; i++) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error('UI timed out: ' + code);
    };
    const click = async (label) => {
      await js(
        `Array.from((document.querySelector('[role=dialog]') ?? document).querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
    };
    const input = async (selector, value) => {
      await js(
        `{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
    };
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      'document.querySelectorAll("[role=tab]").length===1 && document.querySelectorAll(".react-flow__node-document").length===3',
    );
    await js(`document.querySelector('[aria-label="캔버스 추가"]').click()`);
    await wait('!!document.querySelector("#canvas-sheet-title")');
    await input('.canvas-sheet-dialog input', '전투');
    await click('추가');
    await wait(
      'document.querySelector("[role=tab][aria-selected=true]").textContent.includes("전투") && document.querySelectorAll(".react-flow__node").length===0',
    );
    const combatId = await js(
      '(async()=> (await window.gameCanvas.getCanvasSheets()).canvases.find(s=>s.name==="전투").id)()',
    );
    await js(
      `window.gameCanvas.createIdea({canvasId:${JSON.stringify(combatId)},x:0,y:0})`,
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===1',
    );
    await js(`document.querySelector('.document-card__content').click()`);
    await wait(`!!document.querySelector('[aria-label="문서 제목"]')`);
    await input('[aria-label="문서 제목"]', '전투 기획 편집 보존');
    await js(
      'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("기본 캔버스")).click()',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===3',
    );
    assert.equal(
      await js(
        `(async()=> (await window.gameCanvas.listDocuments()).find(doc=>doc.canvasId===${JSON.stringify(combatId)}).title)()`,
      ),
      '전투 기획 편집 보존',
    );
    await js(
      'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("전투")).click()',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===1',
    );
    // Let the newly mounted React Flow store attach its node event handlers.
    await js(
      '(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()',
    );
    await js(
      'document.querySelector(".react-flow__node-document").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:500,clientY:300}))',
    );
    await wait('!!document.querySelector(".document-context-menu")');
    await click('다른 캔버스로 이동파일 경로를 유지하며 이동');
    await wait('!!document.querySelector("#move-canvas-title")');
    await click('이동');
    await wait(
      '!document.querySelector("#move-canvas-title") && document.querySelectorAll(".react-flow__node-document").length===0',
    );
    // Search defaults to the current canvas; project search can jump to another tab.
    await js(
      'Array.from(document.querySelectorAll("button")).find(e=>e.title.includes("문서 목록")).click()',
    );
    await wait('!!document.querySelector(".canvas-navigator")');
    assert.equal(
      await js('document.querySelectorAll(".navigator-item").length'),
      0,
    );
    await js('document.querySelector(".canvas-search-scope input").click()');
    await wait('document.querySelectorAll(".navigator-item").length>0');
    await js(
      'Array.from(document.querySelectorAll(".navigator-item")).find(e=>e.textContent.includes("전투 기획 편집 보존")).click()',
    );
    await wait(
      'document.querySelector("[role=tab][aria-selected=true]").textContent.includes("기본 캔버스") && document.querySelectorAll(".react-flow__node-document").length===4',
    );
    await js(`document.querySelector('[title="탐색 닫기"]').click()`);
    // Move the original HTML to combat, then compose using material from both canvases.
    await js(
      `(async()=>{const s=await window.gameCanvas.getCanvasSheets();await window.gameCanvas.changeCanvasSheets({action:'move',id:'default',targetId:${JSON.stringify(combatId)},paths:['output/index.html'],expected:s.raw});})()`,
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-preview").length===0',
    );
    await js(
      'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("전투")).click()',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-preview").length===1',
    );
    await js(
      `{const e=document.querySelector('.react-flow__node-preview');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));e.dispatchEvent(new MouseEvent('click',{bubbles:true}));}`,
    );
    await js(`document.querySelector('[aria-label="gamejam!"]').click()`);
    await wait('!!document.querySelector("#ai-request-title")');
    await js('document.querySelectorAll(".gamejam-steps input")[1].click()');
    await js('document.querySelectorAll(".gamejam-steps input")[0].click()');
    await js(
      'document.querySelector(".canvas-material-picker summary").click()',
    );
    await js(
      'Array.from(document.querySelectorAll(".canvas-material-picker label")).find(e=>e.textContent.includes("전투 기획 편집 보존")).querySelector("input").click()',
    );
    await fs.writeFile(
      'out/canvas-sheets-ui/materials.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await click('gamejam! 실행');
    await wait('!!window.qaLastRequest');
    const request = await js('window.qaLastRequest');
    assert.equal(request.canvasId, combatId);
    assert.equal(request.sourceMode, 'html-compose');
    assert.equal(request.inputPaths.length, 2);
    await js(
      'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("기본 캔버스")).click()',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-document").length===4',
    );
    await wait(
      '(async()=> (await window.gameCanvas.listPreviews()).length===2)()',
    );
    assert.equal(
      await js('document.querySelectorAll(".react-flow__node-preview").length'),
      0,
    );
    await wait('document.querySelector(".canvas-tabs__unread") !== null');
    await js(
      'Array.from(document.querySelectorAll("[role=tab]")).find(e=>e.textContent.includes("전투")).click()',
    );
    await wait(
      'document.querySelectorAll(".react-flow__node-preview").length===2',
    );
    await js(
      `document.querySelector('button[title^="캔버스 전체 보기"]').click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    await fs.writeFile(
      'out/canvas-sheets-ui/tabs.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    assert.equal(
      await js(
        `(async()=> (await window.gameCanvas.listPreviews()).find(p=>p.relativePath!=='output/index.html').canvasId)()`,
      ),
      combatId,
    );
    await js(
      `document.querySelector('[aria-label="전투 캔버스 관리"]').click()`,
    );
    await wait('!!document.querySelector("#canvas-sheet-title")');
    await input('.canvas-sheet-dialog input', '전투 시스템');
    await click('이름 저장');
    await wait(
      'Array.from(document.querySelectorAll("[role=tab]")).some(e=>e.textContent.includes("전투 시스템"))',
    );
    await js(
      `document.querySelector('[aria-label="전투 시스템 캔버스 관리"]').click()`,
    );
    await click('자료를 옮기고 캔버스 삭제');
    await wait(
      'document.querySelectorAll("[role=tab]").length===1 && document.querySelectorAll(".react-flow__node-preview").length===2',
    );
    assert.equal(
      await js(
        '(async()=> (await window.gameCanvas.listDocuments()).filter(d=>d.type!=="ai-task").length)()',
      ),
      4,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: actual App tabs isolate contents, save edits before switching, move files, search across canvases, compose cross-canvas HTML, freeze AI destination, show new-result badges and preserve content on canvas deletion (mock AI).',
    );
  } catch (error) {
    console.log(
      await win.webContents.executeJavaScript(
        `(async()=>({sheets:await window.gameCanvas.getCanvasSheets(),docs:(await window.gameCanvas.listDocuments()).map(d=>({id:d.id,title:d.title,canvas:d.canvasId})),notice:document.querySelector('.app-notice')?.textContent,dialog:document.querySelector('.canvas-sheet-dialog')?.textContent,active:document.querySelector('[role=tab][aria-selected=true]')?.textContent,nodes:Array.from(document.querySelectorAll('.react-flow__node')).map(n=>n.dataset.id)}))()`,
      ),
    );
    await fs.writeFile(
      'out/canvas-sheets-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    throw error;
  } finally {
    win.destroy();
    app.quit();
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
