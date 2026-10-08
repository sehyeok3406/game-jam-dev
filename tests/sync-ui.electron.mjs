import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/sync-ui/profile'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  await app.whenReady();
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
      throw new Error(code + '\n' + error.message);
    }
  };
  const titleSelector = '[aria-label="문서 제목"]';
  const titleElement = `document.querySelector(${JSON.stringify(titleSelector)})`;
  const wait = async (code) => {
    for (let i = 0; i < 240; i++) {
      if (await js(code)) return;
      await sleep(50);
    }
    throw Error('UI timed out: ' + code);
  };
  const type = async (value) =>
    js(
      `{const input=document.querySelector('[aria-label="문서 제목"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(input.value.length,input.value.length);}`,
    );
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear()');
    await win.loadURL(process.env.QA_URL);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector(".document-card__content")');
    await js('document.querySelector(".document-card__content").click()');
    await wait(`!!${titleElement}`);
    const relative = await js(
      `${titleElement}.closest('.react-flow__node').getAttribute('data-id')`,
    );
    const files = await js('window.gameCanvas.listDocuments()');
    const doc = files.find((item) => item.id === relative);
    assert.ok(doc);
    for (const delay of [200, 500, 1500]) {
      await js(`window.qa.delay=${delay}`);
      const starts = await js('window.qa.starts');
      await type('저장할 사본 ' + delay);
      await wait(`window.qa.starts>${starts}`);
      const latest = '저장 중 계속 입력 ' + delay;
      await type(latest);
      const focus = await js(`document.activeElement===${titleElement}`);
      await js(
        `window.gameCanvas.setDocumentColor({relativePath:${JSON.stringify(doc.relativePath)}, color:'green'})`,
      );
      await sleep(delay + 250);
      assert.equal(await js(`${titleElement}.value`), latest);
      assert.equal(await js(`document.activeElement===${titleElement}`), focus);
      await wait(
        `window.gameCanvas.getDocument(${JSON.stringify(doc.relativePath)}).then(doc=>doc.title===${JSON.stringify(latest)})`,
      );
    }
    const bodyElement = `document.querySelector('[aria-label="문서 내용"]')`;
    await js(
      `{const e=${bodyElement};e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}`,
    );
    const bodyStarts = await js('window.qa.starts');
    await win.webContents.insertText(' 본문 저장 사본');
    await wait(`window.qa.starts>${bodyStarts}`);
    await win.webContents.insertText(' 계속 작성한 본문');
    const caret = await js(
      '({offset:window.getSelection().anchorOffset,text:window.getSelection().anchorNode.textContent})',
    );
    await js(
      `window.gameCanvas.setDocumentColor({relativePath:${JSON.stringify(doc.relativePath)},color:'purple'})`,
    );
    await sleep(1800);
    assert.ok(
      await js(`${bodyElement}.textContent.includes('계속 작성한 본문')`),
    );
    assert.deepEqual(
      await js(
        '({offset:window.getSelection().anchorOffset,text:window.getSelection().anchorNode.textContent})',
      ),
      caret,
    );
    await wait(
      `window.gameCanvas.getDocument(${JSON.stringify(doc.relativePath)}).then(doc=>doc.body.includes('계속 작성한 본문'))`,
    );
    const starts = await js('window.qa.starts');
    await js(
      `document.querySelector('[aria-label="문서 제목"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'한'}))`,
    );
    await type('한글 조합 중');
    await sleep(3400);
    assert.equal(
      await js('window.qa.starts'),
      starts,
      'IME must not autosave an uncommitted composition',
    );
    await js(
      `document.querySelector('[aria-label="문서 제목"]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한글'}))`,
    );
    await type('한글 조합 확정');
    await wait(
      `window.gameCanvas.getDocument(${JSON.stringify(doc.relativePath)}).then(doc=>doc.title==='한글 조합 확정')`,
    );

    await js(
      `${titleElement}.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    );
    await wait(`!${titleElement}`);
    await js('window.qa.delay=1500');
    const nodeSelector = `[data-id="${relative}"]`;
    const rect = await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(nodeSelector)}).querySelector('.document-card__header').getBoundingClientRect();return {x:r.left+25,y:r.top+14};})()`,
    );
    const drag = async (start, dx, dy) => {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(start.x),
        y: Math.round(start.y),
      });
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: Math.round(start.x),
        y: Math.round(start.y),
        button: 'left',
        clickCount: 1,
      });
      for (let i = 1; i <= 5; i++) {
        win.webContents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(start.x + (dx * i) / 5),
          y: Math.round(start.y + (dy * i) / 5),
          button: 'left',
        });
        await sleep(20);
      }
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: Math.round(start.x + dx),
        y: Math.round(start.y + dy),
        button: 'left',
        clickCount: 1,
      });
      await sleep(80);
    };
    await drag(rect, 35, 30);
    await wait('window.qa.layoutStarts>0');
    const nextRect = await js(
      `(()=>{const r=document.querySelector(${JSON.stringify(nodeSelector)}).querySelector('.document-card__header').getBoundingClientRect();return {x:r.left+25,y:r.top+14};})()`,
    );
    await drag(nextRect, 35, 30);
    await wait('window.qa.layoutStarts>1');
    const latestPosition = await js(
      `document.querySelector(${JSON.stringify(nodeSelector)}).style.transform`,
    );
    await wait('window.qa.layoutAcks>0');
    assert.equal(
      await js(
        `document.querySelector(${JSON.stringify(nodeSelector)}).style.transform`,
      ),
      latestPosition,
      'first drag ACK must preserve newer dropped position',
    );
    await wait('window.qa.layoutAcks>1');
    assert.equal(
      await js(
        `document.querySelector(${JSON.stringify(nodeSelector)}).style.transform`,
      ),
      latestPosition,
    );
    await js(
      `document.querySelector(${JSON.stringify(nodeSelector)}).querySelector('.document-card__content').click()`,
    );
    await wait(`!!${titleElement}`);
    const timings = [];
    await js('window.qa.delay=1500');
    for (let i = 0; i < 20; i++) {
      const time = await js(
        `(async()=>{const start=performance.now(),input=document.querySelector('[aria-label="문서 제목"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'반응 측정 ${i}');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);return performance.now()-start;})()`,
      );
      timings.push(time);
    }
    timings.sort((a, b) => a - b);
    await fs.mkdir('out/sync-ui', { recursive: true });
    await fs.writeFile(
      'out/sync-ui/measurements.json',
      JSON.stringify(
        {
          fixture: 'actual Chromium, simulated 200/500/1500ms saves',
          inputP95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
          samples: timings.length,
        },
        null,
        2,
      ),
    );
    assert.ok(errors.length === 0, errors.join('\n'));
    await fs.writeFile(
      'out/sync-ui/sync-ui.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.log(
      'PASS: actual app UI preserves latest Korean text/focus under 200/500/1500ms saves and teammate color updates; repeated drags preserve newest position; IME waits for commit',
    );
    console.log(
      'Input fixture p95:',
      timings[Math.ceil(timings.length * 0.95) - 1].toFixed(1),
      'ms',
    );
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
