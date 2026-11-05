import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

app.setPath(
  'userData',
  path.resolve('out/camera-performance/viewport-profile'),
);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = [];
let win;
const watchdog = setTimeout(() => {
  console.error('Viewport UI timeout');
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
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.startsWith('ResizeObserver'))
      errors.push(event.message);
  });
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await pause(60);
    }
    console.error(
      'Viewport diagnostic',
      await js(
        '({viewport:!!window.__viewportStore,flow:!!window.__perfFlow,count:window.__perfFlow?.getNodes().length,measured:window.__perfFlow?.getNodes().filter(n=>n.measured?.width).length,query:document.querySelector(".canvas-find input")?.value,search:document.querySelector(".canvas-find")?.textContent,selected:window.__perfFlow?.getNodes().filter(n=>n.selected).map(n=>n.id),camera:window.__perfFlow?.getViewport(),visible:[...window.__viewportStore?.getSnapshot().visible??[]]})',
      ),
      errors,
    );
    throw Error('Timed out: ' + code);
  };
  await win.loadURL(process.env.QA_URL + '?kind=markdown&n=300');
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'window.__viewportStore && window.__perfFlow && __perfFlow.getNodes().length === 300 && __perfFlow.getNodes().every(n=>n.measured?.width)',
  );
  await pause(5200);
  const inspect = () =>
    js(`(() => {
    const s=__viewportFlowStore.getState(), ranges=__viewportStore.getSnapshot();
    const [x,y,z]=s.transform, a={x:-x/z,y:-y/z,width:s.width/z,height:s.height/z};
    const hits=(r,b)=>r.x<=b.x+b.width&&r.x+r.width>=b.x&&r.y<=b.y+b.height&&r.y+r.height>=b.y;
    const expected=[...s.nodeLookup.values()].filter(n=>!n.hidden&&!(n.data.kind==='document'&&n.data.sectionHidden)).filter(n=>hits({ ...n.internals.positionAbsolute,width:n.measured?.width??n.width??Number(n.style?.width??0),height:n.measured?.height??n.height??Number(n.style?.height??0) },a)).map(n=>n.id).sort();
    return {visible:[...ranges.visible].sort(),expected,width:s.width,height:s.height,total:s.nodes.length,
      mounted:document.querySelectorAll('.react-flow__node').length, geometryScans:__viewportGeometryScans,
      nodeEffects:__perfCounts.nodeEffects??0,frames:__viewportFrames};
  })()`);
  async function check(label, settleMs = 450) {
    // Existing search/navigation uses a 300ms fitView animation. Compare the
    // range against a settled camera, not an intentionally one-RAF-old sample.
    await pause(settleMs);
    const result = await inspect();
    assert.deepEqual(
      result.visible,
      result.expected,
      label + ': exact intersection oracle',
    );
    assert.equal(
      result.total,
      result.mounted,
      label + ': all logical nodes remain mounted',
    );
    rows.push({ label, ...result });
    console.log('PASS', label, result.visible.length, '/', result.total);
    return result;
  }
  await js('__perfFlow.setViewport({x:0,y:0,zoom:1})');
  const first = await check('initial screen');
  assert.ok(first.visible.length > 0 && first.visible.length < 300);
  await js(
    'window.__viewportFrames=0;window.__viewportGeometryScans=0;window.__perfCounts={}; for(let i=0;i<40;i++) __perfFlow.setViewport({x:-i*160,y:-i*80,zoom:1}); true;',
  );
  // Count the input burst before the new 160ms motion-settle wakeup.
  const rapid = await check('rapid pan to latest camera', 120);
  assert.equal(rapid.geometryScans, 0, 'camera never rebuilds geometry');
  assert.equal(rapid.nodeEffects, 0, 'camera never rebuilds logical nodes');
  assert.ok(
    rapid.frames <= 2,
    'synchronous camera burst coalesces into one display frame',
  );
  if (!(await js('!!document.querySelector(".canvas-minimap-panel")')))
    await js(`document.querySelector('[aria-label="미니맵 전환"]').click()`);
  await wait('document.querySelectorAll(".canvas-minimap-node").length===300');
  assert.equal(
    await js(
      `!!document.querySelector('.canvas-minimap-node[data-node-id="perf-299"]')`,
    ),
    true,
  );
  win.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'f',
    modifiers: ['control'],
  });
  win.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: 'f',
    modifiers: ['control'],
  });
  await wait('!!document.querySelector(".canvas-find input")');
  await wait(
    'document.activeElement===document.querySelector(".canvas-find input")',
  );
  const farTitle = await js(
    `document.querySelector('[data-find-document="perf-299"] .document-card__title').textContent`,
  );
  assert.ok(farTitle.length > 0);
  await win.webContents.insertText(farTitle);
  await wait(
    'document.querySelector(".canvas-find [aria-live]")?.textContent === "1 / 1" && __perfFlow.getNode("perf-299")?.selected',
  );
  await check('text search includes offscreen document; minimap has all 300');
  await js(`document.querySelector('[title="찾기 닫기 (Esc)"]').click()`);
  // This synthetic 300-card board exceeds the product's minimum zoom. Only
  // this test operation permits a smaller scale to inspect every card at once.
  await js('__perfFlow.fitView({duration:0,padding:0.05,minZoom:0.01})');
  const fit = await check('fit all includes distant nodes (test minZoom .01)');
  assert.equal(fit.visible.length, 300);
  await js('__perfFlow.setNodes(ns=>ns.map(n=>({...n,selected:true})));true;');
  await wait('__perfFlow.getNodes().filter(n=>n.selected).length===300');
  await check('select all retains distant nodes');
  await js(
    '__perfFlow.setNodes(ns=>ns.map(n=>({...n,selected:false})));__perfFlow.setViewport({x:0,y:0,zoom:1});true;',
  );
  await pause(100);
  await js(
    `__perfFlow.setNodes(ns=>ns.map((n,i)=>i===0?{...n,position:{x:20000,y:0}}:n));true;`,
  );
  await wait('!__viewportStore.getSnapshot().visible.has("perf-0")');
  await check('moving node refreshes index without camera movement');
  await js(
    `__perfFlow.setNodes(ns=>ns.map((n,i)=>i===0?{...n,position:{x:-400,y:20},style:{width:600,height:38},width:600,height:38}:n));true;`,
  );
  await wait(
    '__viewportStore.getSnapshot().visible.has("perf-0") && __perfFlow.getNode("perf-0").measured.height===38',
  );
  await check('resized collapsed card intersects by actual bounds');
  // Use the real section node renderer and controlled React Flow geometry.
  await js(`__perfFlow.setNodes(ns=>[{
    id:'section:viewport-test',type:'section',position:{x:7000,y:8000},style:{width:1000,height:800},data:{kind:'section',collapsed:false,locked:false,
      section:{id:'viewport-test',title:'구역 검사',x:7000,y:8000,width:1000,height:800,members:[]},onCollapse:()=>{},onResize:async()=>{},onReveal:async()=>{}}
    },...ns.map((n,i)=>i===1?{...n,parentId:'section:viewport-test',position:{x:50,y:60}}:n)]);true;`);
  await js('__perfFlow.setViewport({x:-7000,y:-8000,zoom:1})');
  await wait('__viewportStore.getSnapshot().visible.has("perf-1")');
  await check('section child uses absolute parent position');
  await js(
    `__perfFlow.setNodes(ns=>ns.map(n=>n.id==='section:viewport-test'?{...n,position:{x:17000,y:18000}}:n));true;`,
  );
  await wait('!__viewportStore.getSnapshot().visible.has("perf-1")');
  await check('moving section refreshes child absolute position');
  await js(
    `__perfFlow.setNodes(ns=>ns.map(n=>n.id==='perf-1'?{...n,className:'section-member-hidden',data:{...n.data,sectionHidden:true}}:n));__perfFlow.setViewport({x:-17000,y:-18000,zoom:1});true;`,
  );
  await check('collapsed section excludes hidden child without deleting it');
  assert.equal(
    await js('__perfFlow.getNodes().some(n=>n.id==="perf-1")'),
    true,
  );
  for (const width of [1920, 3440, 5120]) {
    win.setContentSize(width, 1000);
    await wait(`__viewportFlowStore.getState().width > ${width - 500}`);
    await js('__perfFlow.setViewport({x:0,y:0,zoom:.5})');
    const result = await check('resize window ' + width);
    assert.ok(result.width > width - 500);
  }
  // Existing navigation still uses the full logical index after a distant jump.
  await js(`__perfFlow.fitView({nodes:[{id:'perf-299'}],duration:0});true;`);
  await wait('__viewportStore.getSnapshot().visible.has("perf-299")');
  await check('direct navigation to distant item');
  const oldSnapshot = await js(
    'window.__previousViewportStore=__viewportStore;true;',
  );
  assert.equal(oldSnapshot, true);
  await win.loadURL(process.env.QA_URL + '?kind=html-active&n=5');
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'window.__viewportStore && window.__perfFlow?.getNodes().length===5 && !!document.querySelector("iframe")',
  );
  await pause(500);
  await js(
    'window.__runningFrame=document.querySelector("iframe");window.__runningWindow=__runningFrame.contentWindow;true;',
  );
  await js('__perfFlow.setViewport({x:-50000,y:-50000,zoom:.15})');
  await check('running HTML stays logical and mounted offscreen');
  await js('__perfFlow.setViewport({x:0,y:0,zoom:1})');
  await check('HTML returns to screen');
  assert.equal(
    await js(
      '__runningFrame===document.querySelector("iframe") && __runningWindow===document.querySelector("iframe").contentWindow',
    ),
    true,
  );
  assert.deepEqual(errors, []);
  await fs.mkdir('out/canvas-stage3', { recursive: true });
  await fs.writeFile(
    'out/canvas-stage3/viewport-ui.json',
    JSON.stringify({ complete: true, rows, errors }, null, 2),
  );
  console.log(
    'PASS viewport geometry, rapid input, wide windows and logical/iframe preservation',
  );
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
