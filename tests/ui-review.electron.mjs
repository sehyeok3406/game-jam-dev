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
    await sleep(260);
    const dockSelectors = [
      '.react-flow__controls',
      '.canvas-utility',
      '.bottom-toolbar',
      '.react-flow__minimap',
      '.status-toast',
    ];
    const sampleDock = () =>
      js(
        `(()=>Object.fromEntries(${JSON.stringify(dockSelectors)}.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,{top:r.top,bottom:r.bottom,left:r.left,right:r.right}];})))()`,
      );
    const originalDock = await sampleDock();
    const originalViewport = await js(
      "getComputedStyle(document.querySelector('.react-flow__viewport')).transform",
    );
    const footer = await bounds('.canvas-tabs');
    assert.equal(footer.left, 0);
    assert.equal(footer.right, await js('innerWidth'));
    assert.equal(footer.bottom, await js('innerHeight'));
    assert.equal(footer.height, 40);
    const motion = await js(
      `new Promise(resolve=>{const before=document.querySelector('.bottom-toolbar').getBoundingClientRect().bottom;document.querySelector('.ui-tools-toggle').click();requestAnimationFrame(()=>{const started=performance.now();const samples=[];function frame(now){samples.push(document.querySelector('.bottom-toolbar').getBoundingClientRect().bottom-before);if(now-started<270)requestAnimationFrame(frame);else resolve(samples);}requestAnimationFrame(frame);});})`,
    );
    assert(
      motion.some((offset) => offset > 1 && offset < 39),
      'Dock should pass through intermediate positions',
    );
    assert(Math.abs(motion.at(-1) - 40) < 1);
    const hiddenDock = await sampleDock();
    for (const selector of dockSelectors) {
      assert(
        Math.abs(
          hiddenDock[selector].bottom - originalDock[selector].bottom - 40,
        ) < 1,
        selector + ' follows footer',
      );
      assert.equal(hiddenDock[selector].left, originalDock[selector].left);
    }
    assert.equal(
      (await js('innerHeight')) - hiddenDock['.bottom-toolbar'].bottom,
      12,
    );
    assert.equal(
      await js('document.querySelector(".canvas-tabs").inert'),
      true,
    );
    assert.equal(
      await js(
        'document.querySelector(".canvas-tabs").getAttribute("aria-hidden")',
      ),
      'true',
    );
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.react-flow__viewport')).transform",
      ),
      originalViewport,
    );
    await fs.writeFile(
      'out/ui-review/footer-hidden.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.querySelector(".ui-tools-toggle").click()');
    await sleep(260);
    assert.deepEqual(await sampleDock(), originalDock);
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".canvas-tabs")).opacity',
      ),
      '1',
    );
    assert.equal(await js('document.querySelector(".app-shell").scrollTop'), 0);
    await js("document.querySelector('.canvas-tabs__manage').click()");
    await wait('!!document.querySelector(".canvas-sheet-dialog input")');
    await js(
      `{const input=document.querySelector('.canvas-sheet-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'보존할 이름');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ui-tools-toggle').click();}`,
    );
    await sleep(260);
    assert.equal(
      await js('document.querySelector(".canvas-sheet-dialog input").value'),
      '보존할 이름',
    );
    assert.equal(
      await js('document.querySelector(".canvas-tabs").inert'),
      true,
    );
    await js('document.querySelector(".ui-tools-toggle").click()');
    await sleep(260);
    assert.equal(
      await js('document.querySelector(".canvas-sheet-dialog input").value'),
      '보존할 이름',
    );
    await js(
      'document.querySelector(".canvas-sheet-dialog [aria-label=닫기]").click()',
    );
    // Reverse an in-progress movement; there must be no immediate position jump.
    const reversed = await js(
      `new Promise(resolve=>{document.querySelector('.ui-tools-toggle').click();setTimeout(()=>{const before=document.querySelector('.bottom-toolbar').getBoundingClientRect().bottom;const observer=new MutationObserver(()=>{observer.disconnect();const after=document.querySelector('.bottom-toolbar').getBoundingClientRect().bottom;setTimeout(()=>resolve({before,after,final:document.querySelector('.bottom-toolbar').getBoundingClientRect().bottom}),270);});observer.observe(document.querySelector('.app-shell'),{attributes:true,attributeFilter:['class']});document.querySelector('.ui-tools-toggle').click();},75);})`,
    );
    assert(
      Math.abs(reversed.after - reversed.before) < 4,
      'Rapid toggle must reverse without snapping',
    );
    assert(
      Math.abs(reversed.final - originalDock['.bottom-toolbar'].bottom) < 1,
    );
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const reduced = await js(
      `new Promise(resolve=>{document.querySelector('.ui-tools-toggle').click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({duration:getComputedStyle(document.querySelector('.bottom-toolbar')).transitionDuration,bottom:document.querySelector('.bottom-toolbar').getBoundingClientRect().bottom})));})`,
    );
    assert.equal(reduced.duration, '0s');
    assert.equal(reduced.bottom, hiddenDock['.bottom-toolbar'].bottom);
    await js('document.querySelector(".ui-tools-toggle").click()');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [],
    });
    win.webContents.debugger.detach();
    await sleep(260);
    for (const [width, height] of [
      [1280, 900],
      [980, 640],
      [640, 640],
    ]) {
      win.setSize(width, height);
      await sleep(260);
      const tabs = await bounds('.canvas-tabs');
      assert.equal(tabs.width, width);
      assert.equal(tabs.bottom, height);
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
      const panels = [
        '.react-flow__controls',
        '.canvas-utility',
        '.bottom-toolbar',
      ];
      for (let i = 0; i < panels.length; i++)
        for (let j = i + 1; j < panels.length; j++) {
          const a = await bounds(panels[i]),
            b = await bounds(panels[j]);
          assert(
            a.right <= b.left ||
              b.right <= a.left ||
              a.bottom <= b.top ||
              b.bottom <= a.top,
            'Panels overlap at ' + width,
          );
        }
    }
    win.setSize(1280, 900);
    await sleep(260);
    await fs.writeFile(
      'out/ui-review/footer-visible.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(
      `(async()=>{for(let i=0;i<25;i++){const sheets=await gameCanvas.getCanvasSheets();await gameCanvas.changeCanvasSheets({action:'add',id:'overflow-'+i,name:'길게 표시하는 캔버스 '+i,expected:sheets.raw??null});}})()`,
    );
    await wait(
      'document.querySelectorAll(".canvas-tabs [role=tab]").length>=26',
    );
    assert(
      await js(
        'document.querySelector(".canvas-tabs__list").scrollWidth>document.querySelector(".canvas-tabs__list").clientWidth',
      ),
    );
    await js(
      'document.querySelector(".canvas-tabs [role=tab]:first-child").focus();document.querySelectorAll(".canvas-tabs [role=tab]")[25].focus()',
    );
    const lastTab = await bounds('.canvas-tabs__item:last-child [role=tab]');
    const tabList = await bounds('.canvas-tabs__list');
    assert(
      lastTab.left >= tabList.left - 1 && lastTab.right <= tabList.right + 1,
      'Keyboard can reach overflowing tabs',
    );
    assert(
      lastTab.top >= footer.top && lastTab.bottom <= footer.bottom,
      'Overflow must remain in one footer row',
    );
    const add = await bounds('.canvas-tabs__add');
    assert(add.right <= 1280 && add.bottom <= 900);
    await fs.writeFile(
      'out/ui-review/footer-overflow.png',
      (await win.webContents.capturePage()).toPNG(),
    );
    await js('document.activeElement.blur()');
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
      'PASS: full-width footer, visible/hidden dock spacing, intermediate animation, rapid reversal, reduced motion, retained management input, overflow keyboard access, minimum window layout, toolbar shortcuts/order, native pointer note drawing, colored minimap and completion persistence.',
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
