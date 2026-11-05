import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

app.setPath(
  'userData',
  path.resolve('out/camera-performance/preparation-profile'),
);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const watchdog = setTimeout(() => {
  console.error('Preparation UI timeout');
  app.exit(1);
}, 120000);

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
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.startsWith('ResizeObserver'))
      errors.push(event.message);
  });
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => {
    for (let i = 0; i < 180; i++) {
      if (await js(code)) return;
      await pause(50);
    }
    console.error(
      'Preparation diagnostic',
      await js(
        '({nodes:window.__perfFlow?.getNodes().length,status:window.__viewportStore?.preparations.getStatus(),fast:window.__viewportStore?.getPreparationSnapshot().fast,errors:window.__testPreparationErrors})',
      ),
      errors,
    );
    throw Error('Timed out: ' + code);
  };
  await win.loadURL(
    process.env.QA_URL + '?kind=markdown&n=300&updates&preparation',
  );
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'window.__viewportStore && window.__perfFlow?.getNodes().length===300 && __perfFlow.getNodes().every(n=>n.measured?.width)',
  );
  await pause(5200);
  await js('__perfFlow.setViewport({x:0,y:0,zoom:1})');
  await wait(
    '__viewportStore.getPreparationSnapshot().targets.get("perf-0")?.level==="detail"',
  );
  await js(`window.__testPreparationErrors=[];window.__prepared=[];window.__steps=0;window.__release=[];
    for(const node of __perfFlow.getNodes()) {
      __release.push(__viewportStore.preparations.register(node.id,node.data.document.modifiedAt,{
        prepare(ctx) { let slices=0; const step=()=>{__steps++;return ++slices===3?{done:true,value:node.id}:{done:false,next:step};};return step(); },
        commit(id,level) { __prepared.push({id,level,moving:__viewportStore.getPreparationSnapshot().moving,fast:__viewportStore.getPreparationSnapshot().fast}); },
        error(error) { __testPreparationErrors.push(String(error)); }
      }));
    }
    window.__viewportGeometryScans=0;window.__perfCounts={};true;`);
  const moving =
    await js(`(async()=>{let maxPending=0,maxActive=0,fastFrames=0;for(let i=1;i<=40;i++){
    await __perfFlow.setViewport({x:-i*20,y:0,zoom:1});await new Promise(r=>setTimeout(r,16));
    const status=__viewportStore.preparations.getStatus();maxPending=Math.max(maxPending,status.pending);maxActive=Math.max(maxActive,status.active);
    if(__viewportStore.getPreparationSnapshot().fast)fastFrames++;
  } return {maxPending,maxActive,fastFrames,steps:__steps,commits:__prepared.length,movingCommits:__prepared.filter(v=>v.moving).length,summaryCommits:__prepared.filter(v=>v.fast&&v.level==='summary').length,geometryScans:__viewportGeometryScans,nodeEffects:__perfCounts.nodeEffects??0};})()`);
  assert.ok(
    moving.fastFrames > 5 && moving.steps >= 10 && moving.movingCommits >= 2,
  );
  assert.ok(
    moving.summaryCommits > 0,
    'fast movement still prepares current-screen summaries',
  );
  assert.ok(moving.maxPending <= 32 && moving.maxActive <= 2);
  assert.equal(moving.geometryScans, 0);
  assert.equal(moving.nodeEffects, 0);
  rows.push({
    label:
      'continuous camera input prepares visible summaries with bounded work',
    ...moving,
  });
  await wait(
    '!__viewportStore.getPreparationSnapshot().moving && __viewportStore.preparations.getStatus().pending===0 && __viewportStore.preparations.getStatus().active===0',
  );
  assert.equal(
    await js(
      '[...__viewportStore.getPreparationSnapshot().targets.values()].every(t=>__prepared.some(p=>p.id===t.id&&p.level===t.level))',
    ),
    true,
  );
  rows.push({
    label: 'quiet camera finishes all final-screen preparation',
    complete: true,
  });
  await js(
    `document.querySelector('[data-find-document="perf-0"] .document-card__title').focus({preventScroll:true});true;`,
  );
  await wait(
    '__viewportStore.getPreparationSnapshot().targets.get("perf-0")?.priority===0',
  );
  rows.push({
    label: 'focused element takes priority outside the preparation boundary',
    complete: true,
  });
  await js(`__release.forEach(fn=>fn());window.__betweenApplied=[];window.__betweenDiscarded=[];
    __viewportStore.preparations.register('perf-0','camera race',{prepare:()=>new Promise(resolve=>window.__resolveBetween=resolve),commit:v=>__betweenApplied.push(v),discard:v=>__betweenDiscarded.push(v)});true;`);
  await wait('!!window.__resolveBetween');
  await js(
    `(async()=>{document.querySelector('.canvas-shell').focus({preventScroll:true});await __perfFlow.setViewport({x:-50000,y:-50000,zoom:1});__resolveBetween({done:true,value:'old camera'});return true;})()`,
  );
  await wait('__betweenDiscarded.length===1');
  assert.deepEqual(await js('__betweenApplied'), []);
  rows.push({
    label:
      'completion before the next camera RAF is held and discarded against the latest plan',
    complete: true,
  });
  await js(
    `__perfFlow.setViewport({x:0,y:0,zoom:1});document.querySelector('[data-find-document="perf-0"] .document-card__title').focus({preventScroll:true});true;`,
  );
  await wait(
    '__viewportStore.getPreparationSnapshot().targets.get("perf-0")?.priority===0',
  );
  await js(`__release.forEach(fn=>fn());window.__revisionApplied=[];window.__revisionDiscarded=[];
    __viewportStore.preparations.register('perf-0',1,{prepare:({signal})=>{window.__oldRevisionSignal=signal;return new Promise(resolve=>window.__resolveRevision=resolve);},commit:v=>__revisionApplied.push(v),discard:v=>__revisionDiscarded.push(v)});true;`);
  await wait('!!window.__resolveRevision');
  await js(`qaNodeUpdates.body('최신 revision 본문');true;`);
  await wait(
    '__perfFlow.getNode("perf-0").data.document.body==="최신 revision 본문"',
  );
  await js(
    `__viewportStore.preparations.register('perf-0',__perfFlow.getNode('perf-0').data.document.modifiedAt,{prepare:()=>({done:true,value:'current revision'}),commit:v=>__revisionApplied.push(v)});__resolveRevision({done:true,value:'old revision'});true;`,
  );
  await wait('__revisionApplied.includes("current revision")');
  assert.deepEqual(
    await js(
      '({applied:__revisionApplied,discarded:__revisionDiscarded,aborted:__oldRevisionSignal.aborted})',
    ),
    {
      applied: ['current revision'],
      discarded: ['old revision'],
      aborted: true,
    },
  );
  rows.push({
    label: 'remote content change cannot publish a stale preparation result',
    complete: true,
  });
  await js(`window.__visitApplied=[];window.__visitDiscarded=[];window.__oldViewportStore=__viewportStore;
    __viewportStore.preparations.register('perf-0','pending visit',{prepare:({signal})=>{window.__visitSignal=signal;return new Promise(resolve=>window.__resolveVisit=resolve);},commit:v=>__visitApplied.push(v),discard:v=>__visitDiscarded.push(v)});true;`);
  await wait('!!window.__resolveVisit');
  await js(
    `[...document.querySelectorAll('.canvas-tabs [role="tab"]')].find(b=>b.textContent==='다른 화면').click();true;`,
  );
  await wait(
    '__viewportStore!==__oldViewportStore && __perfFlow.getNodes().length===0',
  );
  assert.equal(await js('__visitSignal.aborted'), true);
  await js(`__resolveVisit({done:true,value:'old visit'});true;`);
  await wait('__visitDiscarded.length===1');
  assert.deepEqual(await js('__visitApplied'), []);
  await js(
    `[...document.querySelectorAll('.canvas-tabs [role="tab"]')].find(b=>b.textContent==='성능 점검').click();true;`,
  );
  await wait(
    '__perfFlow.getNodes().length===300 && __viewportStore!==__oldViewportStore',
  );
  assert.deepEqual(await js('__visitApplied'), []);
  assert.equal(
    await js('document.querySelectorAll(".react-flow__node").length'),
    300,
  );
  rows.push({
    label:
      'A to B to A tab visits cancel old work and retain full logical nodes',
    complete: true,
  });
  assert.deepEqual(await js('__testPreparationErrors'), []);
  assert.deepEqual(errors, []);
  await fs.mkdir('out/canvas-stage4', { recursive: true });
  await fs.writeFile(
    'out/canvas-stage4/preparation-ui.json',
    JSON.stringify({ complete: true, rows, errors }, null, 2),
  );
  console.log('PASS preparation UI:', JSON.stringify(rows));
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
