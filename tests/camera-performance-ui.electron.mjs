import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const variant = process.env.CAMERA_VARIANT;
const baseline = variant === 'baseline';
const output =
  process.env.CAMERA_OUTPUT ?? `out/camera-performance/${variant}.json`;
app.setPath('userData', path.resolve('out/camera-performance/profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
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
  const watchdog = setTimeout(
    () => {
      console.error('Camera test timeout');
      app.exit(1);
    },
    Number(process.env.CAMERA_TIMEOUT_MS ?? 180000),
  );
  const bounded = (promise, label) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('Camera test response timeout: ' + label)),
          12000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const js = async (code) => {
    try {
      return await bounded(
        win.webContents.executeJavaScript(code),
        code.slice(0, 90),
      );
    } catch (error) {
      throw new Error('Camera expression failed: ' + code.slice(0, 300), {
        cause: error,
      });
    }
  };
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  async function wait(code) {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await pause(75);
    }
    throw Error('Timed out: ' + code);
  }
  win.webContents.debugger.attach('1.3');
  const cdp = (method, parameters = {}) =>
    bounded(win.webContents.debugger.sendCommand(method, parameters), method);
  const rows = [];
  const interactions = [];
  const cases =
    process.env.CAMERA_INTERACTIONS_ONLY === '1'
      ? []
      : process.env.CAMERA_CASES
        ? JSON.parse(process.env.CAMERA_CASES)
        : [
            ['markdown', 300],
            ['text', 300],
            ['shapes', 300],
            ['strokes', 300],
            ['game-ui', 50],
            ['html-active', 5],
          ];
  const repeats = Number(process.env.CAMERA_REPEATS ?? 2);
  const viewport = (zoom) =>
    js(`__perfFlow.setViewport({x:100,y:130,zoom:${zoom}})`);
  async function assertLabel() {
    await wait(
      `Math.abs(parseFloat(document.querySelector('.canvas-zoom-menu summary').textContent) - Math.round(__perfFlow.getZoom()*100)) < .1`,
    );
  }
  async function gestures(overview = false) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.focus();
    await viewport(overview ? 0.18 : 1);
    await pause(350);
    await js(
      `window.__perfCounts={};window.__cameraFrames=[];window.__cameraLongTasks=[];window.__cameraObserver=new PerformanceObserver(list=>__cameraLongTasks.push(...list.getEntries().map(e=>e.duration)));__cameraObserver.observe({type:'longtask'});window.__cameraPrevious=0;window.__cameraSampling=true;requestAnimationFrame(function tick(t){if(!window.__cameraSampling)return;if(window.__cameraPrevious)window.__cameraFrames.push(t-window.__cameraPrevious);window.__cameraPrevious=t;requestAnimationFrame(tick);});window.__cameraFrame=document.querySelector('iframe');window.__cameraWindow=window.__cameraFrame?.contentWindow;true;`,
    );
    const metric = async () =>
      Object.fromEntries(
        (await cdp('Performance.getMetrics')).metrics.map((m) => [
          m.name,
          m.value,
        ]),
      );
    const before = await metric();
    await js(
      `(async()=>{const v=__perfFlow.getViewport();for(let i=1;i<=30;i++){const s=Math.pow(2,${overview ? 1 : -1}*.08*i);await __perfFlow.setViewport({x:700-(700-v.x)*s,y:430-(430-v.y)*s,zoom:v.zoom*s});await new Promise(r=>setTimeout(r,16));}})()`,
    );
    await pause(180);
    const result = await js(
      `window.__cameraSampling=false;__cameraObserver.disconnect();({counts:__perfCounts,frames:__cameraFrames,longTasks:__cameraLongTasks,zoom:__perfFlow.getZoom(),iframeStable:!window.__cameraFrame||(window.__cameraFrame===document.querySelector('iframe')&&window.__cameraWindow===document.querySelector('iframe')?.contentWindow)})`,
    );
    const after = await metric();
    if (result.frames.length <= 5)
      console.error('Camera sample diagnostic', {
        kind: await js('new URLSearchParams(location.search).get("kind")'),
        frames: result.frames,
        zoom: result.zoom,
        visible: win.isVisible(),
        minimized: win.isMinimized(),
        pageVisibility: await js('document.visibilityState'),
        counts: result.counts,
        scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      });
    assert.ok(
      result.frames.length > 5,
      'visible foreground frame samples required',
    );
    assert.ok(
      overview ? result.zoom > 0.7 : result.zoom < 0.3,
      'actual camera scale changes',
    );
    assert.equal(
      result.iframeStable,
      true,
      'camera never recreates the running iframe',
    );
    if (!baseline) {
      if (Object.values(result.counts).some(Boolean))
        console.error('Camera unexpected render counts', result.counts);
      for (const name of [
        'nodeEffects',
        'workspace',
        'document',
        'drawing',
        'text',
        'gameUi',
        'preview',
      ])
        assert.equal(
          result.counts[name] ?? 0,
          0,
          `${name}: pure zoom must not rebuild unselected content`,
        );
    } else
      assert.ok(
        result.counts.nodeEffects > 0,
        'baseline must reproduce the old node rebuild',
      );
    await assertLabel();
    result.frames.sort((a, b) => a - b);
    return {
      phase: overview ? 'zoom-in' : 'zoom-out',
      counts: result.counts,
      p95: result.frames[Math.floor(result.frames.length * 0.95)],
      max: result.frames.at(-1),
      samples: result.frames.length,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      longTasks: {
        count: result.longTasks.length,
        maxMs: Math.max(0, ...result.longTasks),
        totalMs: result.longTasks.reduce((a, b) => a + b, 0),
      },
    };
  }
  try {
    for (const [kind, count] of cases)
      for (let repeat = 1; repeat <= repeats; repeat++) {
        console.log('CAMERA', variant, kind, count, repeat);
        await bounded(
          win.loadURL(`${process.env.QA_URL}?kind=${kind}&n=${count}`),
          'navigation',
        );
        win.show();
        win.focus();
        win.webContents.focus();
        await cdp('Performance.enable');
        await wait('!!document.querySelector(".home-project-open")');
        await js(
          `window.__cameraWrites=[];for(const name of ['saveDocument','updateLayouts','updateDocumentLayout','updateSectionLayout','applyDrawingCommand','applyGameUiCommand']){const original=window.gameCanvas[name];if(original)window.gameCanvas[name]=(...args)=>{window.__cameraWrites.push(name);return original(...args);}}document.querySelector('.home-project-open').click()`,
        );
        await wait(`window.__perfFlow?.getNodes().length===${count}`);
        await viewport(1);
        await pause(650);
        // Exclude the existing five-second load-notice timer from camera-only render counts.
        await wait('document.querySelector(".status-toast")?.hidden === true');
        await js(
          `document.querySelector('[title="이동 도구 (H)"]').click();window.__cameraWrites=[]`,
        );
        const phases = [await gestures(), await gestures(true)];
        assert.deepEqual(
          await js('window.__cameraWrites'),
          [],
          'camera never writes content or geometry',
        );
        if (!baseline && kind === 'shapes') {
          await js(
            `document.querySelector('[title="선택 도구 (V)"]').click();__perfFlow.setNodes(ns=>ns.map((n,i)=>({...n,selected:i===0})))`,
          );
          await wait('!!document.querySelector("[data-handle=se]")');
          for (const zoom of [0.25, 0.75, 1.5]) {
            await viewport(zoom);
            await pause(90);
            await assertLabel();
            const width = await js(
              `document.querySelector('[data-handle=se]').getBoundingClientRect().width`,
            );
            assert.ok(
              Math.abs(width - 8) < 0.5,
              `shape handle stays 8 screen pixels at ${zoom}, got ${width}`,
            );
            if (count > 1)
              assert.equal(
                await js(
                  `(()=>{const p=document.querySelectorAll('.drawing-node__svg path[stroke="transparent"]')[1],r=p.getBoundingClientRect();return document.elementFromPoint(r.left-3,r.top+r.height/2)===p})()`,
                ),
                true,
                `thin shapes retain a screen-sized hit area at ${zoom}`,
              );
          }
        }
        if (!baseline && kind === 'game-ui') {
          await viewport(1);
          await wait(
            '!!document.querySelector(\'[aria-label="게임 UI 편집"]\')',
          );
          await js(
            `document.querySelector('[aria-label="게임 UI 편집"]').click()`,
          );
          await wait('!!document.querySelector("[data-game-ui-item]")');
          await js(
            `document.querySelector('[data-game-ui-item]').dispatchEvent(new PointerEvent('dblclick',{bubbles:true}))`,
          );
          await wait('!!document.querySelector("[data-game-ui-rotate]")');
          await pause(350);
          for (const zoom of [0.25, 0.75, 1.5]) {
            await viewport(zoom);
            await pause(110);
            const width = await js(
              `document.querySelector('[data-game-ui-rotate]').previousElementSibling.getBoundingClientRect().width`,
            );
            assert.ok(
              Math.abs(width - 12) < 0.8,
              `game UI handle stays 12 screen pixels at ${zoom}, got ${width}`,
            );
          }
        }
        // The label follows both camera changes and restoration of the personal viewport.
        await viewport(0.63);
        await pause(120);
        await assertLabel();
        if (!baseline && repeat === 1) {
          await js(
            `document.querySelector('[title="프로젝트 홈으로 돌아가기"]').click()`,
          );
          await wait('!!document.querySelector(".home-project-open")');
          await js(`document.querySelector('.home-project-open').click()`);
          await wait(
            `document.querySelectorAll('.react-flow__node').length===${count} && Math.abs(__perfFlow.getZoom()-.63)<.001`,
          );
          await assertLabel();
        }
        const row = { kind, count, repeat, variant, phases };
        rows.push(row);
        await fs.writeFile(
          output,
          JSON.stringify({ complete: false, rows }, null, 2),
        );
        console.log(JSON.stringify(row));
      }
    if (!baseline) {
      // Real pointer panning and wheel zoom, independent of the controlled camera benchmark.
      await bounded(
        win.loadURL(`${process.env.QA_URL}?kind=shapes&n=1`),
        'pointer scene',
      );
      await wait('!!document.querySelector(".home-project-open")');
      await js(`document.querySelector('.home-project-open').click()`);
      await wait('window.__perfFlow?.getNodes().length===1');
      await wait('document.querySelector(".status-toast")?.hidden === true');
      await viewport(0.5);
      await js(
        `document.querySelector('[title="이동 도구 (H)"]').click();window.__perfCounts={}`,
      );
      const beforePan = await js('__perfFlow.getViewport()');
      await cdp('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: 850,
        y: 500,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      for (let i = 1; i <= 12; i++) {
        await cdp('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: 850 + i * 8,
          y: 500 + i * 3,
          button: 'left',
          buttons: 1,
        });
        await pause(16);
      }
      await cdp('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 946,
        y: 536,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
      await pause(80);
      const afterPan = await js('__perfFlow.getViewport()');
      assert.ok(
        afterPan.x > beforePan.x + 50,
        'native pointer pan moves the camera',
      );
      await js(
        `window.__wheelLatency=[];window.addEventListener('wheel',()=>{const start=performance.now(),before=__perfFlow.getZoom();let frames=0;requestAnimationFrame(function changed(){if(__perfFlow.getZoom()!==before){__wheelLatency.push(performance.now()-start);return;}if(frames++<60)requestAnimationFrame(changed);});},{capture:true,passive:true});true;`,
      );
      for (let i = 0; i < 8; i++) {
        await cdp('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: 850,
          y: 500,
          deltaY: -60,
          deltaX: 0,
        });
        await pause(16);
      }
      await pause(150);
      assert.ok(
        await js('__perfFlow.getZoom()>.6'),
        'native wheel changes actual zoom',
      );
      await assertLabel();
      assert.equal(
        await js('__perfCounts.nodeEffects??0'),
        0,
        'native camera input never rebuilds all node models',
      );
      interactions.push({
        check: 'native-pan-wheel',
        beforePan,
        afterPan,
        zoom: await js('__perfFlow.getZoom()'),
        wheelEventToChangedCameraRafMs: await js('__wheelLatency'),
      });

      // A pending edit is measured using the zoom at save time, after the camera has changed.
      await bounded(
        win.loadURL(`${process.env.QA_URL}?kind=text&n=1&editing=1`),
        'text editing scene',
      );
      await wait('!!document.querySelector(".home-project-open")');
      await js(`document.querySelector('.home-project-open').click()`);
      await wait('!!document.querySelector(".canvas-text-node .tiptap")');
      await js(
        `document.querySelector('[title="선택 도구 (V)"]').click();__perfFlow.setNodes(ns=>ns.map(n=>({...n,selected:true})));document.querySelector('.canvas-text-node').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
      );
      await wait('document.activeElement?.classList.contains("tiptap")');
      for (const [startZoom, endZoom, marker] of [
        [0.4, 1.5, 'camera-live-zoom-one'],
        [1.5, 0.35, 'camera-live-zoom-two'],
      ]) {
        await viewport(startZoom);
        await win.webContents.insertText(marker);
        await viewport(endZoom);
        await wait(
          `window.gameCanvas.listDrawings().then(items=>items[0]?.geometry.document.includes('${marker}'))`,
        );
        const size = await js(
          `(async()=>({height:(await window.gameCanvas.listDrawings())[0].transform.height,expected:Math.max(42,Math.ceil(document.querySelector('.canvas-text-node .tiptap').getBoundingClientRect().height/__perfFlow.getZoom()))}))()`,
        );
        assert.ok(
          Math.abs(size.height - size.expected) <= 1,
          `saved text height follows live zoom: ${JSON.stringify(size)}`,
        );
        interactions.push({
          check: 'text-save-live-zoom',
          startZoom,
          endZoom,
          ...size,
        });
      }
      console.log(
        'Camera interactions: native pan/wheel and text save across zoom changes passed.',
      );
    }
    assert.deepEqual(errors, [], 'renderer errors');
    await fs.writeFile(
      output,
      JSON.stringify({ complete: true, rows, interactions }, null, 2),
    );
    console.log(
      `Camera regression: ${rows.length} scenes passed (${variant}).`,
    );
  } finally {
    clearTimeout(watchdog);
    win.destroy();
  }
}
run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
