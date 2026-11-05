import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
const out = 'out/canvas-stage7';
app.setPath('userData', path.resolve(out, 'profiles', randomUUID()));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let win;
const watchdog = setTimeout(() => {
  console.error('Streaming UI timeout');
  app.exit(1);
}, 420000);
async function run() {
  await app.whenReady();
  win = new BrowserWindow({
    show: true,
    width: 1920,
    height: 1080,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const rows = [],
    errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !event.message.startsWith('ResizeObserver'))
      errors.push(event.message);
  });
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  win.webContents.debugger.attach('1.3');
  const cdp = (method, params = {}) =>
    win.webContents.debugger.sendCommand(method, params);
  const js = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code, true);
    } catch (error) {
      console.error('Streaming script', code, errors);
      throw error;
    }
  };
  const wait = async (code) => {
    for (let i = 0; i < 400; i++) {
      if (await js(code)) return;
      await pause(60);
    }
    console.error(
      'Streaming diagnostic',
      await js(
        '({nodes:window.__perfFlow?.getNodes().length,cache:window.__viewportStore?.content.getStatus(),preparations:window.__viewportStore?.preparations.getStatus(),text:document.body.innerText.slice(-400)})',
      ),
    );
    throw Error('Timeout: ' + code);
  };
  const idle = () =>
    wait(
      '__viewportStore.preparations.getStatus().pending===0&&__viewportStore.preparations.getStatus().active===0',
    );
  const camera = async (x, y, zoom = 1, settle = 1000) => {
    await js(`__perfFlow.setViewport({x:${x},y:${y},zoom:${zoom}})`);
    if (settle) await pause(settle);
  };
  const budget = async () => {
    const s = await js('__viewportStore.content.getStatus()');
    assert.ok(s.entries <= s.maxEntries && s.estimatedBytes <= s.maxBytes);
    return s;
  };
  await win.loadURL(
    process.env.QA_URL + '?kind=mixed&n=1000&updates&preparation',
  );
  await wait('!!document.querySelector(".home-project-open")');
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'window.__perfFlow?.getNodes().length===1000&&__perfFlow.getNodes().every(n=>n.measured?.width)',
  );
  await wait('document.querySelector(".status-toast")?.hidden===true');
  await camera(0, 0);
  await idle();
  assert.deepEqual(await js('__fixtureCounts'), {
    markdown: 400,
    images: 100,
    text: 150,
    strokes: 150,
    shapes: 100,
    gameUi: 50,
    html: 50,
  });
  await js(
    'window.__allFrames=[...document.querySelectorAll(".preview-card iframe")];window.__allWindows=__allFrames.map(f=>f.contentWindow);window.__initialGeometry=__perfFlow.getNodes().map(n=>[n.id,n.position,n.style]);true;',
  );
  for (let i = 0; i < 60; i++)
    await camera(i % 2 ? -6500 : 0, i % 3 ? -21000 : 0, i % 2 ? 0.2 : 1.15, 16);
  await camera(0, 0);
  await idle();
  assert.ok(
    await js(
      '__allFrames.every((f,i)=>f===document.querySelectorAll(".preview-card iframe")[i]&&f.contentWindow===__allWindows[i])',
    ),
  );
  assert.deepEqual(
    await js('__perfFlow.getNodes().map(n=>[n.id,n.position,n.style])'),
    await js('__initialGeometry'),
  );
  rows.push({
    check:
      '1000 mixed logical nodes, rapid reversal/zoom, exact geometry and all 50 iframe windows preserved',
    cache: await budget(),
  });
  for (const width of [1920, 3440, 5120]) {
    win.setContentSize(width, 1080);
    await pause(300);
    await camera(0, 0);
    await idle();
    assert.equal(await js('__viewportFlowStore.getState().width'), width);
    assert.equal(await js('__perfFlow.getNodes().length'), 1000);
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
    rows.push({
      check: 'mixed ultrawide viewport',
      width,
      cache: await budget(),
    });
  }
  win.setContentSize(1920, 1080);
  await camera(0, 0);
  await idle();
  await js('__perfFlow.setNodes(ns=>ns.map(n=>({...n,selected:true})));true;');
  await wait('__perfFlow.getNodes().filter(n=>n.selected).length===1000');
  await pause(600);
  const editors = await js(
    'document.querySelectorAll(".canvas-text-node .ProseMirror").length',
  );
  assert.ok(
    editors <= 1,
    'multi-selection must not instantiate idle text editors for the entire project',
  );
  rows.push({
    check: 'select all preserves logical selection without idle editor fanout',
    editors,
  });
  await js('__perfFlow.setNodes(ns=>ns.map(n=>({...n,selected:false})));true;');
  await cdp('Performance.enable');
  const sample = async (label) => {
    await camera(0, 0);
    await idle();
    await cdp('HeapProfiler.collectGarbage');
    const m = Object.fromEntries(
      (await cdp('Performance.getMetrics')).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
    return {
      label,
      jsHeapBytes: m.JSHeapUsedSize,
      cache: await budget(),
      processes: app
        .getAppMetrics()
        .map(({ pid, type, memory }) => ({ pid, type, memory })),
    };
  };
  const memory = [await sample('warm start')];
  assert.ok(
    await js('document.querySelectorAll("img.project-image").length>0'),
  );
  const memoryStarted = Date.now();
  for (let batch = 0; batch < 6; batch++) {
    for (let i = 0; i < 40; i++) {
      const positions = [
        [0, 0],
        [-4500, -6500],
        [-300, -20000],
        [-6000, -22000],
      ];
      await camera(...positions[i % 4], 1, 500);
    }
    memory.push(await sample(`after ${(batch + 1) * 40} zone visits`));
    console.log('MEMORY', JSON.stringify(memory.at(-1)));
  }
  rows.push({
    check: 'sustained zone traversal with bounded cache',
    durationMs: Date.now() - memoryStarted,
    visits: 240,
    samples: memory,
  });
  assert.equal(
    await js(
      '[...document.querySelectorAll(".project-image-placeholder")].some(e=>e.textContent.includes("이미지를 찾을 수 없습니다"))',
    ),
    false,
  );
  await camera(-60000, -60000);
  await js(
    `qaNodeUpdates.body(${JSON.stringify('## 최신 원격 본문\n\n원거리_본문_단독_마커')})`,
  );
  await camera(0, 0);
  await wait(
    'document.querySelector(\'[data-find-document="mixed-0"] .markdown-body\')?.textContent.includes("최신 원격 본문")',
  );
  rows.push({
    check:
      'remote revision replaces warm cached content after a distant update',
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'f',
    code: 'KeyF',
    windowsVirtualKeyCode: 70,
    modifiers: 2,
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'f',
    code: 'KeyF',
    windowsVirtualKeyCode: 70,
    modifiers: 2,
  });
  await wait('!!document.querySelector(".canvas-find input")');
  await cdp('Input.insertText', { text: '원거리_본문_단독_마커' });
  await wait(
    'document.querySelector(".canvas-find [aria-live]")?.textContent==="1 / 1"',
  );
  await js('document.querySelector(\'[title="찾기 닫기 (Esc)"]\').click()');
  await camera(0, 0);
  await idle();
  rows.push({
    check: 'body search hydrates and locates the latest logical document',
    cache: await budget(),
  });
  await js(
    `document.querySelector('[data-find-document="mixed-0"] .document-card__content').click()`,
  );
  await wait(
    '!!document.querySelector(\'[data-find-document="mixed-0"] .tiptap[contenteditable="true"]\')',
  );
  await js(
    `window.__editor=document.querySelector('[data-find-document="mixed-0"] .tiptap[contenteditable="true"]');__editor.focus();__editor.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'한'}));true;`,
  );
  await win.webContents.insertText('한글 초안');
  const caret = await js(
    '({anchor:getSelection().anchorOffset,focus:getSelection().focusOffset})',
  );
  await camera(-60000, -60000);
  await camera(0, 0, 0.2);
  assert.ok(
    await js(
      'document.querySelector(\'[data-find-document="mixed-0"] .tiptap[contenteditable="true"]\')===__editor&&__editor.textContent.includes("한글 초안")',
    ),
  );
  assert.deepEqual(
    await js(
      '({anchor:getSelection().anchorOffset,focus:getSelection().focusOffset})',
    ),
    caret,
  );
  await js(
    `__editor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'한글 초안'}));true;`,
  );
  rows.push({
    check:
      'mixed-scene active IME editor and caret survive distant/overview camera changes',
  });
  await fs.writeFile(
    path.join(out, 'mixed-overview.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'streaming-ui.json'),
    JSON.stringify({ complete: true, rows, errors }, null, 2),
  );
  console.log(
    'PASS streaming integration',
    JSON.stringify(rows.map(({ samples: _samples, ...row }) => row)),
  );
}
run()
  .then(() => {
    clearTimeout(watchdog);
    win?.destroy();
    app.exit(0);
  })
  .catch(async (error) => {
    clearTimeout(watchdog);
    console.error(error);
    if (win && !win.isDestroyed())
      await fs.writeFile(
        path.join(out, 'streaming-failure.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
    win?.destroy();
    app.exit(1);
  });
