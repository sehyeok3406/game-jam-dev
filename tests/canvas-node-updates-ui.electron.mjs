import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const variant = process.env.NODE_UPDATE_VARIANT,
  baseline = variant === 'stage1';
app.setPath('userData', path.resolve('out/canvas-stage2/profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
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
    if (
      event.level === 'error' &&
      !event.message.startsWith('ResizeObserver')
    ) {
      errors.push(event.message);
      console.error('Renderer:', event.message);
    }
  });
  const timer = setTimeout(() => {
    console.error('Node update watchdog');
    app.exit(1);
  }, 180000);
  const bounded = (promise, label) => {
    let timeout;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error('Timeout: ' + label)), 15000);
      }),
    ]).finally(() => clearTimeout(timeout));
  };
  const js = (code) =>
    bounded(win.webContents.executeJavaScript(code), code.slice(0, 100));
  async function wait(code) {
    for (let i = 0; i < 160; i++) {
      if (await js(code)) return;
      await pause(75);
    }
    throw Error('Wait timeout: ' + code);
  }
  async function open(kind, count, extra = '') {
    await bounded(
      win.loadURL(
        `${process.env.QA_URL}?kind=${kind}&n=${count}&updates=1${extra}`,
      ),
      'navigation',
    );
    win.show();
    win.focus();
    win.webContents.focus();
    await wait('!!document.querySelector(".home-project-open")');
    await js(`document.querySelector('.home-project-open').click()`);
    await wait(
      `!!window.__perfFlow&&__perfFlow.getNodes().length===${count + (extra.includes('preview-source') ? 1 : 0)}`,
    );
    await wait('document.querySelector(".status-toast")?.hidden===true');
    await js('__perfFlow.setViewport({x:100,y:130,zoom:.7})');
    await pause(150);
  }
  win.webContents.debugger.attach('1.3');
  const cdp = (method, params = {}) =>
    bounded(win.webContents.debugger.sendCommand(method, params), method);
  const rows = [];
  try {
    for (const [kind, count] of [
      ['markdown', 20],
      ['markdown', 300],
      ['strokes', 300],
      ['game-ui', 50],
    ])
      for (let repeat = 1; repeat <= 2; repeat++) {
        console.log('NODE UPDATES', variant, kind, count, repeat);
        await open(kind, count);
        await cdp('Performance.enable');
        await js(
          'window.__perfCounts={};window.__beforeNodeData=__perfFlow.getNodes().map(n=>n.data);true',
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
          '(async()=>{for(let i=0;i<30;i++){qaNodeUpdates.heartbeat();await new Promise(resolve=>setTimeout(resolve,16));}})()',
        );
        await pause(100);
        const row = await js(
          `({kind:${JSON.stringify(kind)},count:${count},repeat:${repeat},variant:${JSON.stringify(variant)},counts:__perfCounts,stableData:__perfFlow.getNodes().filter((n,i)=>n.data===__beforeNodeData[i]).length})`,
        );
        const after = await metric();
        row.scriptMs = (after.ScriptDuration - before.ScriptDuration) * 1000;
        assert.equal(
          row.counts.nodeEffects,
          30,
          'each heartbeat actually rebuilds the projection',
        );
        assert.equal(
          row.stableData,
          count,
          'unchanged nodes keep data identity',
        );
        for (const name of ['document', 'drawing', 'gameUi', 'preview'])
          assert.equal(
            row.counts[name] ?? 0,
            0,
            'heartbeat never renders unchanged content: ' + name,
          );
        rows.push(row);
        await fs.writeFile(
          `out/canvas-stage2/${variant}.json`,
          JSON.stringify({ complete: false, rows }, null, 2),
        );
        console.log(JSON.stringify(row));
      }
    if (!baseline) {
      await open('markdown', 20, '&preview-source=1');
      await js(
        `window.__iframe=document.querySelector('iframe');window.__iframeWindow=__iframe.contentWindow;window.__nodesBefore=__perfFlow.getNodes();window.__perfCounts={};qaNodeUpdates.rename('참고 원본 | 제목: 갱신');true`,
      );
      await wait(
        `document.querySelector('[data-id="perf-0"] .canvas-file-header__title')?.textContent==='참고 원본 | 제목: 갱신'`,
      );
      await wait(
        `document.querySelector('[data-id="perf-1"] .source-list button')?.textContent==='참고 원본 | 제목: 갱신'`,
      );
      assert.deepEqual(
        await js('Object.keys(__perfCounts.documentIds??{})'),
        ['perf-0'],
        'renaming a source only re-renders its own card',
      );
      assert.equal(
        await js(
          '__perfFlow.getNodes().filter(n=>n.id!=="perf-0").every(n=>n.data===__nodesBefore.find(o=>o.id===n.id).data)',
        ),
        true,
        'source title index is outside every node payload',
      );
      await js(
        `window.__nodesBefore=__perfFlow.getNodes();window.__perfCounts={};qaNodeUpdates.renamePreview('HTML 원본 이름 갱신')`,
      );
      await wait(
        `document.querySelector('[data-id="perf-1"] .source-list')?.textContent.includes('HTML 원본 이름 갱신')`,
      );
      assert.equal(
        await js('__perfCounts.document??0'),
        0,
        'HTML source rename does not render Markdown cards',
      );
      assert.equal(
        await js(
          'document.querySelector("iframe")===__iframe&&__iframe.contentWindow===__iframeWindow',
        ),
        true,
        'HTML rename retains iframe and runtime',
      );
      await js(
        `window.__nodesBefore=__perfFlow.getNodes();window.__perfCounts={};qaNodeUpdates.body(${JSON.stringify('## 한 문서만 갱신\n\n새로운 본문')})`,
      );
      await wait(
        `document.querySelector('[data-id="perf-0"] .document-card__content')?.textContent.includes('새로운 본문')`,
      );
      assert.deepEqual(
        await js('Object.keys(__perfCounts.documentIds??{})'),
        ['perf-0'],
        'one body update renders one card',
      );
      await js(`qaNodeUpdates.lock('검사 사용자')`);
      await wait(
        `document.querySelector('[data-id="perf-0"] .document-editing-badge')?.textContent.includes('검사 사용자')`,
      );
      assert.equal(
        await js(`__perfFlow.getNode('perf-0').data.locked`),
        true,
        'new peer lock is applied',
      );
      assert.equal(
        await js(`__perfFlow.getNode('perf-1').data.locked`),
        false,
        'unrelated document remains editable',
      );
      console.log(
        'Node update interactions: body/title/HTML source names, isolated card renders, iframe identity and locks passed.',
      );
    }
    assert.deepEqual(errors, [], 'renderer errors');
    await fs.writeFile(
      `out/canvas-stage2/${variant}.json`,
      JSON.stringify({ complete: true, rows }, null, 2),
    );
    console.log('Node update regression passed:', variant, rows.length);
  } finally {
    clearTimeout(timer);
    win.destroy();
  }
}
run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
