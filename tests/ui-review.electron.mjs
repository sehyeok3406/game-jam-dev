import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
app.setPath('userData', path.resolve('out/ui-review/profile'));
async function run() {
  await app.whenReady();
  await fs.mkdir('out/ui-review', { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      offscreen: true,
      backgroundThrottling: false,
    },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (code) => {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await sleep(70);
    }
    throw Error('UI timed out: ' + code);
  };
  const key = async (name) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: name });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: name });
    await sleep(50);
  };
  const toolbar = (label) =>
    js(
      `Array.from(document.querySelectorAll('.bottom-toolbar button')).find(button=>button.querySelector('span')?.textContent===${JSON.stringify(label)}).click()`,
    );
  const pointer = (type, x, y) =>
    win.webContents.sendInputEvent({
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  const bounds = (selector) =>
    js(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};})()`,
    );
  let exitCode = 0;
  try {
    await win.loadURL(process.env.QA_URL);
    await js('localStorage.clear();sessionStorage.clear()');
    await win.reload();
    await wait('!!document.querySelector(".home-project-open")');
    assert.match(
      await js('document.querySelector(".home-sidebar-bottom").textContent'),
      /v0\.12\./,
    );
    assert(
      !(
        await js('document.querySelector(".home-sidebar-bottom").textContent')
      ).includes('아이디어 →'),
    );
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      '!!document.querySelector(".react-flow__node-document") && document.querySelectorAll(".canvas-minimap-node").length>=3',
    );
    await sleep(300);
    assert.deepEqual(
      await js(
        "Array.from(document.querySelectorAll('.bottom-toolbar button span')).map(e=>e.textContent)",
      ),
      ['선택', '이동', '새 메모', '섹션', '불러오기'],
    );
    for (const [name, tool] of [
      ['H', 'hand'],
      ['V', 'select'],
      ['N', 'note'],
    ]) {
      await key(name);
      await wait(
        `document.querySelector('.app-shell').classList.contains('app-shell--tool-${tool}')`,
      );
    }
    await key('ESC');
    const toggleBefore = await bounds('.ui-tools-toggle');
    await js('document.querySelector(".ui-tools-toggle").click()');
    await wait('!!document.querySelector(".ui-reveal-button")');
    assert.deepEqual(await bounds('.ui-tools-toggle'), toggleBefore);
    await js('document.querySelector(".ui-tools-toggle").click()');
    await wait('!!document.querySelector(".floating-header")');
    for (const width of [1280, 980]) {
      win.setSize(width, 900);
      await sleep(150);
      const tabs = await bounds('.canvas-tabs');
      for (const selector of [
        '.react-flow__controls',
        '.canvas-utility',
        '.bottom-toolbar',
      ]) {
        const box = await bounds(selector);
        assert(
          box.bottom <= tabs.top ||
            box.right <= tabs.left ||
            box.left >= tabs.right,
          'Tabs overlap ' + selector + ' at ' + width,
        );
      }
    }
    win.setSize(1280, 900);
    await sleep(100);
    const count = () =>
      js('window.gameCanvas.listDocuments().then(d=>d.length)');
    const drag = async (start, end, legacy = false) => {
      await js(`qaReview.legacy=${legacy}`);
      const before = await count();
      await toolbar('새 메모');
      await sleep(50);
      const matrix = await js(
        "(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);return {zoom:m.a,x:m.e,y:m.f};})()",
      );
      pointer('mouseDown', start.x, start.y);
      pointer('mouseMove', end.x, end.y);
      await wait('!!document.querySelector(".note-drawing-preview")');
      pointer('mouseUp', end.x, end.y);
      await wait(
        `window.gameCanvas.listDocuments().then(d=>d.length===${before + 1})`,
      );
      await wait(
        'document.querySelector(".app-shell").classList.contains("app-shell--tool-select")',
      );
      const created = await js(
        'window.gameCanvas.listDocuments().then(d=>d.at(-1))',
      );
      const expected = {
        x: Math.round((Math.min(start.x, end.x) - matrix.x) / matrix.zoom),
        y: Math.round((Math.min(start.y, end.y) - matrix.y) / matrix.zoom),
        width: Math.round(Math.abs(end.x - start.x) / matrix.zoom),
        height: Math.round(Math.abs(end.y - start.y) / matrix.zoom),
      };
      await wait(
        `window.gameCanvas.getDocument(${JSON.stringify(created.relativePath)}).then(d=>d.width===${expected.width}&&d.height===${expected.height})`,
      );
      const stored = await js(
        `window.gameCanvas.getDocument(${JSON.stringify(created.relativePath)})`,
      );
      for (const k of Object.keys(expected))
        assert(
          Math.abs(stored[k] - expected[k]) <= 1,
          `${legacy ? 'legacy ' : 'draw '}${k}: ${stored[k]} vs ${expected[k]}`,
        );
      await wait(`!!document.querySelector('[data-id="${created.id}"]')`);
      const worldRect = await bounds(`[data-id="${created.id}"]`);
      assert(Math.abs(worldRect.width - Math.abs(end.x - start.x)) <= 2);
      assert(Math.abs(worldRect.height - Math.abs(end.y - start.y)) <= 2);
      return created;
    };
    await drag({ x: 460, y: 280 }, { x: 840, y: 570 });
    await js('document.querySelector(".react-flow__controls-zoomin").click()');
    await sleep(300);
    await drag({ x: 840, y: 570 }, { x: 460, y: 280 }, true);
    await drag({ x: 900, y: 560 }, { x: 940, y: 580 });
    await js('qaReview.legacy=true');
    const beforeLegacySmall = await count();
    await toolbar('새 메모');
    await sleep(50);
    pointer('mouseDown', 900, 560);
    pointer('mouseMove', 940, 580);
    pointer('mouseUp', 940, 580);
    await wait(
      'document.body.textContent.includes("협업 서버를 v0.12.2 이상으로")',
    );
    assert.equal(await count(), beforeLegacySmall);
    await js('qaReview.legacy=false');
    const beforeCancel = await count();
    await toolbar('새 메모');
    await sleep(50);
    pointer('mouseDown', 460, 280);
    pointer('mouseMove', 800, 500);
    await wait('!!document.querySelector(".note-drawing-preview")');
    await key('ESC');
    pointer('mouseUp', 800, 500);
    await sleep(100);
    assert.equal(await count(), beforeCancel);
    assert.equal(
      await js('document.querySelectorAll(".note-drawing-preview").length'),
      0,
    );
    await toolbar('새 메모');
    await sleep(50);
    pointer('mouseDown', 1000, 620);
    pointer('mouseUp', 1000, 620);
    await wait(
      `window.gameCanvas.listDocuments().then(d=>d.length===${beforeCancel + 1})`,
    );
    const clicked = await js(
      'window.gameCanvas.listDocuments().then(d=>d.at(-1))',
    );
    assert.equal(clicked.width, 340);
    assert.equal(clicked.height, 300);
    const first = await js('window.gameCanvas.listDocuments().then(d=>d[0])');
    await js(
      `window.gameCanvas.setDocumentColor({relativePath:${JSON.stringify(first.relativePath)},color:'pink'})`,
    );
    await wait(
      '!!document.querySelector(".canvas-minimap-node[data-card-color=pink]")',
    );
    const mapColor = await js(
      "getComputedStyle(document.querySelector('.canvas-minimap-node[data-card-color=pink]')).fill",
    );
    const cardColor = await js(
      "getComputedStyle(document.querySelector('.document-card[data-card-color=pink]')).backgroundColor",
    );
    assert.equal(mapColor, cardColor);
    assert(
      await js('!!document.querySelector(".canvas-minimap-node--section")'),
    );
    assert(
      await js('!!document.querySelector(".canvas-minimap-node--preview")'),
    );
    await js(
      `{const card=document.querySelector('.document-card');const r=card.getBoundingClientRect();card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+50,clientY:r.y+30}));}`,
    );
    await wait('!!document.querySelector(".card-color-picker button")');
    const swatch = await bounds('.card-color-picker button');
    assert.equal(swatch.width, swatch.height);
    assert.equal(swatch.width, 20);
    await key('ESC');
    await js('qaReview.emit("review-run-1")');
    await wait('!!document.querySelector(".ai-completion-toast")');
    await js('document.querySelector(".ai-completion-toast__close").click()');
    await wait('!document.querySelector(".ai-completion-toast")');
    await js(
      `document.querySelector('[title="프로젝트 홈으로 돌아가기"]').click()`,
    );
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector(".bottom-toolbar")');
    await js('qaReview.emit("review-run-1")');
    await sleep(150);
    assert.equal(
      await js('document.querySelectorAll(".ai-completion-toast").length'),
      0,
    );
    await win.reload();
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector(".bottom-toolbar")');
    await sleep(150);
    assert.equal(
      await js('document.querySelectorAll(".ai-completion-toast").length'),
      0,
    );
    await js('qaReview.emit("review-run-2")');
    await wait('!!document.querySelector(".ai-completion-toast")');
    await fs.writeFile(
      'out/ui-review/review.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.log(
      'PASS: toolbar shortcuts/order, fixed hide/restore position, tabs/zoom separation, drawn note dimensions across zoom/reverse/legacy, click creation, Escape cancellation, colored minimap, circular swatches and dismissed completion persistence across home/reload/new tasks.',
    );
  } catch (error) {
    exitCode = 1;
    await fs.writeFile(
      'out/ui-review/failure.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    console.error(error);
  } finally {
    win.destroy();
    app.exit(exitCode);
  }
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
