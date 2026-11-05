import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';

app.setPath(
  'userData',
  path.resolve('out/canvas-stage5/profiles', randomUUID()),
);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const watchdog = setTimeout(() => {
  console.error('Content UI timeout');
  app.exit(1);
}, 180000);

async function run() {
  await app.whenReady();
  win = new BrowserWindow({
    show: true,
    width: 1440,
    height: 1000,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const errors = [],
    rows = [];
  win.webContents.debugger.attach('1.3');
  const heap = async () => {
    await win.webContents.debugger.sendCommand('Performance.enable');
    await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
    const result = await win.webContents.debugger.sendCommand(
      'Performance.getMetrics',
    );
    return result.metrics.find((metric) => metric.name === 'JSHeapUsedSize')
      .value;
  };
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.startsWith('ResizeObserver'))
      errors.push(event.message);
  });
  win.webContents.on('will-prevent-unload', (e) => e.preventDefault());
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      console.error('Content script failed:', code, errors);
      throw error;
    }
  };
  const wait = async (code) => {
    for (let i = 0; i < 240; i++) {
      if (await js(code)) return;
      await pause(50);
    }
    console.error(
      'Content diagnostic',
      await js(
        '({status:window.__viewportStore?.preparations.getStatus(),cache:window.__viewportStore?.content.getStatus(),camera:window.__perfFlow?.getViewport(),mode:window.__viewportStore?.contentMode("perf-0"),body:document.body.innerText.slice(-400)})',
      ),
      errors,
    );
    throw Error('Timed out: ' + code);
  };
  async function load(kind, n) {
    await win.loadURL(`${process.env.QA_URL}?kind=${kind}&n=${n}&updates`);
    await wait('!!document.querySelector(".home-project-open")');
    await js('document.querySelector(".home-project-open").click()');
    await wait(
      `window.__viewportStore && window.__perfFlow?.getNodes().length===${n}`,
    );
    await wait('__perfFlow.getNodes().every(n=>n.measured?.width)');
    await pause(250);
    await js('__perfFlow.setViewport({x:0,y:0,zoom:1})');
    await pause(800);
    await wait('Math.abs(__perfFlow.getZoom()-1)<.001');
  }
  const camera = async (x, y = 0, zoom = 1) => {
    await js(`__perfFlow.setViewport({x:${x},y:${y},zoom:${zoom}})`);
    await pause(950);
  };
  const idle = () =>
    wait(
      '__viewportStore.preparations.getStatus().pending===0 && __viewportStore.preparations.getStatus().active===0',
    );
  const budget = async () => {
    const state = await js('__viewportStore.content.getStatus()');
    assert.ok(
      state.entries <= state.maxEntries &&
        state.estimatedBytes <= state.maxBytes,
    );
    return state;
  };
  await load('markdown', 300);
  await wait(
    '!!document.querySelector(\'[data-find-document="perf-0"] .markdown-body h2\')',
  );
  await idle();
  const initial = await js(
    '({nodes:__perfFlow.getNodes().length,bodies:document.querySelectorAll(".markdown-body h2").length,far:document.querySelector(\'[data-find-document="perf-299"] .markdown-body h2\')!==null,builds:__resourceBuilds["markdown:perf-0"]})',
  );
  assert.equal(initial.nodes, 300);
  assert.ok(initial.bodies > 0 && initial.bodies < 100);
  assert.equal(initial.far, false);
  await fs.writeFile(
    'out/canvas-stage5/near.png',
    (await win.webContents.capturePage()).toPNG(),
  );
  const beforeHeap = await heap();
  const geometry = await js(
    '__perfFlow.getNodes().map(n=>[n.id,n.position,n.style])',
  );
  await camera(-60000);
  assert.equal(
    await js('document.querySelectorAll(".markdown-body h2").length'),
    0,
  );
  await camera(0);
  await wait(
    '!!document.querySelector(\'[data-find-document="perf-0"] .markdown-body h2\')',
  );
  await idle();
  assert.equal(
    await js('__resourceBuilds["markdown:perf-0"]'),
    initial.builds,
    'a warm document does not reparse on a round trip',
  );
  for (let i = 0; i < 3; i++) {
    await camera(-60000);
    await camera(0);
    await idle();
  }
  const afterHeap = await heap();
  assert.equal(await js('__resourceBuilds["markdown:perf-0"]'), initial.builds);
  await camera(0, 0, 0.2);
  await fs.writeFile(
    'out/canvas-stage5/overview.png',
    (await win.webContents.capturePage()).toPNG(),
  );
  assert.equal(
    await js('document.querySelectorAll(".markdown-body h2").length'),
    0,
  );
  assert.deepEqual(
    await js('__perfFlow.getNodes().map(n=>[n.id,n.position,n.style])'),
    geometry,
  );
  rows.push({
    label:
      '300 Markdown shells retain geometry; far/overview bodies unload; warm revisit reuses parsed tree',
    ...initial,
    jsHeapBefore: beforeHeap,
    jsHeapAfterThreeMoreRoundTrips: afterHeap,
    cache: await budget(),
  });
  await camera(0);
  await js(
    `qaNodeUpdates.body(${JSON.stringify('## 새 본문\n\n최신 revision 확인')})`,
  );
  await wait(
    'document.querySelector(\'[data-find-document="perf-0"] .markdown-body\')?.textContent.includes("최신 revision 확인")',
  );
  assert.ok((await js('__resourceBuilds["markdown:perf-0"]')) > initial.builds);
  rows.push({
    label: 'a remote body revision invalidates the prepared tree',
    complete: true,
  });
  await js(`qaNodeUpdates.body(${JSON.stringify('- [ ] 첫째\n- [x] 둘째')})`);
  const checks =
    '[data-find-document="perf-0"] .markdown-body input[type="checkbox"]';
  await wait(`document.querySelectorAll('${checks}').length===2`);
  await js(
    `window.__readingCheck=document.querySelector('${checks}');__readingCheck.focus();true;`,
  );
  await js(`qaNodeUpdates.body(${JSON.stringify('- [x] 첫째\n- [x] 둘째')})`);
  await wait(`document.querySelector('${checks}')?.checked`);
  assert.ok(
    await js(
      `document.querySelector('${checks}')===__readingCheck && document.activeElement===__readingCheck`,
    ),
    'preparing a newer Markdown revision preserves its focused checkbox',
  );
  rows.push({
    label:
      'a focused Markdown checkbox keeps its DOM and focus through a body revision',
    complete: true,
  });
  await js(
    `document.querySelector('[data-find-document="perf-0"] .document-card__content').click()`,
  );
  await wait(
    '!!document.querySelector(\'[data-find-document="perf-0"] .tiptap[contenteditable="true"]\')',
  );
  await js(
    `window.__editingNode=document.querySelector('[data-find-document="perf-0"] .tiptap[contenteditable="true"]');__editingNode.focus();__editingNode.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'한'}));true;`,
  );
  await win.webContents.insertText('한글 초안 보존');
  const selection = await js(
    '({anchor:window.getSelection().anchorOffset,focus:window.getSelection().focusOffset})',
  );
  await camera(-60000);
  assert.equal(
    await js(
      'document.querySelector(\'[data-find-document="perf-0"] .tiptap[contenteditable="true"]\')===__editingNode',
    ),
    true,
  );
  assert.ok(await js('__editingNode.textContent.includes("한글 초안 보존")'));
  assert.deepEqual(
    await js(
      '({anchor:window.getSelection().anchorOffset,focus:window.getSelection().focusOffset})',
    ),
    selection,
  );
  await js(
    `__editingNode.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한글 초안 보존'}));true;`,
  );
  rows.push({
    label:
      'active Markdown DOM, IME draft and caret survive offscreen movement',
    complete: true,
  });

  await load('text', 300);
  await idle();
  assert.equal(
    await js('document.querySelectorAll(".ProseMirror").length'),
    0,
    'read-only text does not construct 300 editors',
  );
  await wait('!!document.querySelector(".canvas-text-summary .tiptap p")');
  const textId = await js('__perfFlow.getNodes()[0].data.object.id');
  const textBuild = await js(
    `__resourceBuilds[${JSON.stringify('text:' + textId)}]`,
  );
  await camera(-60000);
  await camera(0);
  await idle();
  assert.equal(
    await js(`__resourceBuilds[${JSON.stringify('text:' + textId)}]`),
    textBuild,
  );
  rows.push({
    label:
      '300 text objects use cached formatted HTML without mounting idle editors',
    cache: await budget(),
  });

  await load('strokes', 300);
  await idle();
  await wait('!!document.querySelector(".drawing-node__hit")');
  const stroke = await js(
    '({id:__perfFlow.getNodes()[0].data.object.id,path:document.querySelector(".drawing-node__hit").getAttribute("d")})',
  );
  const pathBuild = await js(
    `__resourceBuilds[${JSON.stringify('path:' + stroke.id)}]`,
  );
  await camera(-60000);
  assert.equal(
    await js('document.querySelectorAll(".drawing-node__hit").length'),
    0,
  );
  await camera(0);
  await idle();
  assert.equal(
    await js('document.querySelector(".drawing-node__hit").getAttribute("d")'),
    stroke.path,
  );
  assert.equal(
    await js(`__resourceBuilds[${JSON.stringify('path:' + stroke.id)}]`),
    pathBuild,
  );
  rows.push({
    label: 'stroke revisit reuses the original exact SVG hit path',
    cache: await budget(),
  });

  await load('images', 100);
  await idle();
  await wait(
    '!!document.querySelector(\'[data-find-document="perf-0"] img.project-image\')',
  );
  const imageBuild = await js('__resourceBuilds["image:assets/image-0.png"]');
  const imageCount = await js(
    'document.querySelectorAll("img.project-image").length',
  );
  assert.ok(imageCount > 0 && imageCount < 100);
  await camera(-60000);
  await camera(0);
  await idle();
  assert.equal(
    await js('__resourceBuilds["image:assets/image-0.png"]'),
    imageBuild,
  );
  await js('qaNodeUpdates.asset()');
  await wait(`(__resourceBuilds["image:assets/image-0.png"]??0)>${imageBuild}`);
  rows.push({
    label:
      '100 images load only nearby previews; revisit reuses them and asset revision invalidates them',
    imageCount,
    cache: await budget(),
  });

  await load('game-ui', 50);
  await idle();
  const itemCount = await js(
    'document.querySelectorAll("[data-game-ui-item]").length',
  );
  assert.ok(itemCount > 0 && itemCount < 1000);
  await camera(0, 0, 0.2);
  assert.equal(
    await js('document.querySelectorAll("[data-game-ui-item]").length'),
    0,
  );
  await js(`document.querySelector('[aria-label="게임 UI 편집"]').click()`);
  await wait('document.querySelectorAll("[data-game-ui-item]").length>=20');
  await camera(-60000);
  assert.ok(
    (await js('document.querySelectorAll("[data-game-ui-item]").length')) >= 20,
  );
  rows.push({
    label:
      '50 game UI frames summarize distant layers while an open inspector stays detailed',
    itemCount,
    cache: await budget(),
  });
  await load('markdown', 20);
  await js(`(async()=>{
    const statuses=(await gameCanvas.getDocumentStatuses()).value;
    __perfFlow.setNodes(ns=>[...ns,{id:'kanban:content-test',type:'kanban',position:{x:0,y:0},style:{width:960,height:520},data:{
      kind:'kanban',locked:false,canvasId:'default',activeCanvas:'default',scope:'canvas',
      preferences:{enabled:true,minimized:false,scope:'canvas',x:0,y:0,width:960,height:520,placed:true},
      documents:[{id:'test-card',title:'보존할 카드',kind:'문서',statusPropertyEnabled:true,workflowStatusId:statuses.statuses[0].id,locked:false}],
      statuses,editable:true,busy:false,move:async()=>{},open:()=>{},manage:()=>{},update:()=>{},controls:()=>{}
    }}]);
  })()`);
  await wait('!!document.querySelector(".kanban-card")');
  await js(`{
    const input=document.querySelector('.kanban-search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'보존');
    input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();
  }`);
  await camera(-60000);
  assert.equal(await js('document.querySelectorAll(".kanban-card").length'), 0);
  assert.equal(
    await js('document.querySelector(".kanban-search").value'),
    '보존',
  );
  await camera(0);
  await wait('!!document.querySelector(".kanban-card")');
  assert.equal(
    await js('document.querySelector(".kanban-search").value'),
    '보존',
  );
  assert.ok(
    await js(
      'document.querySelector(".kanban-columns").getBoundingClientRect().height>100',
    ),
  );
  rows.push({
    label:
      'Kanban columns unload offscreen while the board search and layout survive a round trip',
    complete: true,
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(
    'out/canvas-stage5/content-ui.json',
    JSON.stringify({ complete: true, rows, errors }, null, 2),
  );
  console.log('PASS canvas content', JSON.stringify(rows));
}
run()
  .then(() => {
    clearTimeout(watchdog);
    win?.destroy();
    app.exit(0);
  })
  .catch((error) => {
    clearTimeout(watchdog);
    console.error(error);
    win?.destroy();
    app.exit(1);
  });
