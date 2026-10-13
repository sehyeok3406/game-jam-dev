import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/document-links-ui/profile'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/document-links-ui', { recursive: true });
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
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      throw Error(code + '\n' + error.message);
    }
  };
  const wait = async (code) => {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await sleep(60);
    }
    throw Error('Timed out: ' + code);
  };
  const setInput = async (selector, value) =>
    js(
      `{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
  const key = async (selector, name, ctrl = false) =>
    js(
      `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(name)},ctrlKey:${ctrl},bubbles:true,cancelable:true}))`,
    );
  const source = '.react-flow__node[data-id="raw-loop-note"]';
  const snapshot = () =>
    js('window.gameCanvas.getDocument("ideas/night-farm.md")');
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.reload();
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      `document.querySelectorAll('${source} .document-link').length===2`,
    );
    const initial = await snapshot();
    await js(
      'window.gameCanvas.saveDocument({relativePath:"ideas/automation.md",title:"전투·스킬 시스템",body:"대상 내용"})',
    );
    await wait(
      `document.querySelector('${source} .document-link').textContent==='전투·스킬 시스템'`,
    );
    assert.equal(
      await js(
        `document.querySelectorAll('${source} .document-link')[1].textContent`,
      ),
      '고정 문구',
    );
    assert.equal(
      (await snapshot()).body,
      initial.body,
      'Rename must not rewrite source Markdown',
    );
    await wait('!!document.querySelector(".document-backlinks")');
    await js(
      `document.querySelector('${source} .document-card__content').click()`,
    );
    await wait('!!document.querySelector(".tiptap")');
    await wait(
      'document.querySelector(".tiptap [data-document-link]").textContent==="전투·스킬 시스템"',
    );
    await js(
      'window.gameCanvas.saveDocument({relativePath:"ideas/automation.md",title:"새 전투 이름",body:"대상 내용"})',
    );
    await wait(
      'document.querySelector(".tiptap [data-document-link]").textContent==="새 전투 이름"',
    );
    assert.equal(
      (await snapshot()).body,
      initial.body,
      'Editor title refresh must not emit an edit',
    );
    await js(
      `{document.querySelector('.tiptap').focus();const e=document.querySelector('.tiptap [data-document-link]');const r=document.createRange();r.selectNode(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}`,
    );
    await sleep(80);
    await key('.tiptap', 'k', true);
    await wait(
      `[...document.querySelectorAll('.document-link-actions button')].some(b=>b.textContent==='연결 해제')`,
    );
    await js('document.querySelector(".document-link-option input").click()');
    await wait(`!!document.querySelector('[aria-label="링크 표시 문구"]')`);
    await setInput('[aria-label="링크 표시 문구"]', '직접 지정');
    await setInput('[aria-label="연결할 문서 검색"]', '새 전투 이름');
    await key('[aria-label="연결할 문서 검색"]', 'Enter');
    await wait(
      'document.querySelectorAll(".tiptap [data-document-link]").length===0',
    );
    await wait('document.querySelector(".tiptap a").textContent==="직접 지정"');
    await js(
      `{const e=document.querySelector('.tiptap a');const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}`,
    );
    await sleep(80);
    await key('.tiptap', 'k', true);
    await wait(
      `[...document.querySelectorAll('.document-link-actions button')].some(b=>b.textContent==='연결 해제')`,
    );
    await js(
      `[...document.querySelectorAll('.document-link-actions button')].find(b=>b.textContent==='연결 해제').click()`,
    );
    await wait(
      'document.querySelectorAll(".tiptap a").length===1 && document.querySelector(".tiptap").textContent.includes("직접 지정")',
    );
    await key('.tiptap', 'z', true);
    await wait('document.querySelectorAll(".tiptap a").length===2');
    await key('.tiptap', 'z', true);
    await wait(
      'document.querySelectorAll(".tiptap [data-document-link]").length===1',
    );
    await js(
      `{const e=document.querySelector('.tiptap');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}`,
    );
    await sleep(80);
    await win.webContents.insertText(' [[새 전투');
    await wait('!!document.querySelector(".document-link-picker")');
    await wait(
      `document.querySelector('[aria-label="연결할 문서 검색"]').value==="새 전투"`,
    );
    await fs.writeFile(
      'out/document-links-ui/picker.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await key('.tiptap', 'Enter');
    await wait(
      'document.querySelectorAll(".tiptap [data-document-link]").length===2',
    );
    await key('.tiptap', 'z', true);
    await wait(
      'document.querySelectorAll(".tiptap [data-document-link]").length===1',
    );
    await key('.tiptap', 'y', true);
    await wait(
      'document.querySelectorAll(".tiptap [data-document-link]").length===2',
    );
    await js(`document.querySelector('[aria-label="더 보기"]').click()`);
    await wait(
      `[...document.querySelectorAll('button')].some(b=>b.textContent==='Markdown 원문 보기')`,
    );
    await js(
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='Markdown 원문 보기').click()`,
    );
    await wait(`!!document.querySelector('[aria-label="Markdown 내용"]')`);
    await js(
      '{const e=document.querySelector("textarea");e.focus();e.setSelectionRange(e.value.length,e.value.length)}',
    );
    await key('textarea', 'k', true);
    await wait('!!document.querySelector(".document-link-picker")');
    await setInput('[aria-label="연결할 문서 검색"]', '새 전투 이름');
    await key('[aria-label="연결할 문서 검색"]', 'Enter');
    await wait('!document.querySelector(".document-link-picker")');
    assert.ok(
      await js(
        'document.querySelector("textarea").value.includes("gamejam:auto-title")',
      ),
    );
    await js(`document.querySelector('[aria-label="집중 편집"]').click()`);
    await wait(`!!document.querySelector('[aria-label="메모 집중 편집"]')`);
    await key('textarea', 'k', true);
    await wait('!!document.querySelector(".document-link-picker")');
    await key('[aria-label="연결할 문서 검색"]', 'Escape');
    await wait(
      `!document.querySelector('.document-link-picker') && !!document.querySelector('[aria-label="메모 집중 편집"]')`,
    );
    await key('textarea', 'Enter', true);
    await wait(
      '!document.querySelector(".tiptap") && !document.querySelector("textarea")',
    );
    await js(`document.querySelector('${source} .document-link').click()`);
    await wait(
      'document.querySelector(".react-flow__node[data-id=automation-note]").classList.contains("selected")',
    );
    // Move target to another canvas, collapse its card, then follow its ID link.
    await js(
      '(async()=>{const sheets=await window.gameCanvas.getCanvasSheets();await window.gameCanvas.changeCanvasSheets({action:"add",expected:sheets.raw??null,id:"links-target",name:"대상 캔버스"});await window.gameCanvas.changeCanvasSheets({action:"move",expected:(await window.gameCanvas.getCanvasSheets()).raw,id:"default",targetId:"links-target",paths:["ideas/automation.md"]});await window.gameCanvas.setDocumentCollapsed({relativePath:"ideas/automation.md",collapsed:true});})()',
    );
    await wait(
      '!document.querySelector(".react-flow__node[data-id=automation-note]")',
    );
    await js(`document.querySelector('${source} .document-link').click()`);
    await wait(
      'document.querySelector("[role=tab][aria-selected=true]").textContent.includes("대상 캔버스")',
    );
    await wait(
      '!!document.querySelector(".react-flow__node[data-id=automation-note] .document-card__content")',
    );
    assert.equal(
      (await js('window.gameCanvas.getDocument("ideas/automation.md")'))
        .collapsed,
      true,
      'Navigation must only temporarily expand a card',
    );
    await js(
      'document.querySelector(".document-backlinks summary").click();document.querySelector(".document-backlinks button").click()',
    );
    await wait(`!!document.querySelector('${source} .document-link')`);
    await fs.writeFile(
      'out/document-links-ui/linked.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    assert.deepEqual(errors, []);
    console.log(
      'Document links UI passed: live names without source writes, custom labels, rich/source/focus editing, trigger, undo, cross-canvas navigation, temporary expansion and backlinks',
    );
  } catch (error) {
    await fs.writeFile(
      'out/document-links-ui/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.error(errors);
    throw error;
  } finally {
    win.destroy();
  }
}
run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
