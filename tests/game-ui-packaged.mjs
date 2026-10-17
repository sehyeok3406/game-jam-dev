import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-ui-packaged-'));
const profileId = randomUUID(),
  profile = path.join(
    process.env.APPDATA,
    'Game Canvas',
    'test-users',
    profileId,
  ),
  game = path.join(root, 'game');
await fs.mkdir(game, { recursive: true });
await fs.writeFile(path.join(game, 'project.md'), '# 게임 UI 패키지 검사\n');
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '게임 UI 패키지 검사',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const n = s.address().port;
  await new Promise((r) => s.close(r));
  return n;
}
const pause = () => new Promise((r) => setTimeout(r, 100));
let child, ws, js, send;
async function boot() {
  const debugPort = await port();
  child = spawn(
    path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${debugPort}`,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let diagnostic = '';
  child.stderr.on(
    'data',
    (d) => (diagnostic = (diagnostic + d.toString()).slice(-1000)),
  );
  let target;
  for (let n = 0; n < 160; n++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) =>
          r.json(),
        )
      ).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (target) break;
    } catch {}
    await pause();
  }
  assert.ok(target, diagnostic || 'Package did not load');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data)),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params }));
    });
  js = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  await wait('!!window.gameCanvas');
  await wait(
    '!!document.querySelector(".home-project-open") || !!document.querySelector("[data-plugin-launcher]")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait(
    `window.gameCanvas.getWorkspace().then(w=>w.root===${JSON.stringify(game)})`,
  );
  await wait('!!document.querySelector("[data-plugin-launcher]")');
}
async function wait(code) {
  for (let n = 0; n < 160; n++) {
    if (await js(code)) return;
    await pause();
  }
  throw Error('Timeout: ' + code);
}
async function stop(graceful = false) {
  if (graceful && child && child.exitCode === null) {
    let timer;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    void js('window.close()').catch(() => undefined);
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Package did not close normally')),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  ws?.close();
  ws = null;
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  await pause();
}
try {
  await boot();
  await js('document.querySelector("[data-plugin-launcher]").click()');
  await wait('!!document.querySelector(".builtin-feature-open")');
  await js(
    `Array.from(document.querySelectorAll('.builtin-feature-open')).find(e=>e.textContent.includes('게임 UI')).click()`,
  );
  await wait('!!document.querySelector(".game-ui-controls")');
  await js(
    `Array.from(document.querySelectorAll('.game-ui-controls button')).find(e=>e.textContent==='게임 화면 틀 추가').click()`,
  );
  await wait('window.gameCanvas.listGameUi().then(f=>f.length===1)');
  const frame = await js('window.gameCanvas.listGameUi().then(f=>f[0])');
  assert.equal(frame.descriptionPath, null);
  assert.equal(frame.viewportWidth, 1920);
  const item = {
    id: randomUUID(),
    generation: randomUUID(),
    kind: 'health',
    name: '체력',
    x: 40,
    y: 50,
    width: 240,
    height: 32,
    shape: 'rounded',
    color: '#64748b',
    text: 'HP',
    value: 60,
    maximum: 100,
    minimum: 20,
    backgroundColor: '#112233',
    backgroundOpacity: 0.35,
    borderColor: '#abcdef',
    borderWidth: 6,
    borderOpacity: 0.8,
    cornerRadius: 18,
    rotation: 45,
    fillDirection: 'left',
    valueFormat: 'percent',
    thresholds: [
      { below: 20, color: '#ef4444' },
      { below: 50, color: '#eab308' },
    ],
    radialStart: 0,
    radialSweep: 270,
    ringWidth: 12,
    count: 1,
    columns: 1,
    gap: 8,
    selectedSlot: null,
    slots: [{ id: randomUUID(), label: '1', quantity: 1, cooldown: 0 }],
    groupId: null,
    locked: false,
  };
  const scope = await js(
    'window.gameCanvas.getWorkspace().then(w=>w.saveScope)',
  );
  const apply = (c) =>
    js(
      `window.gameCanvas.applyGameUiCommand(${JSON.stringify({ ...c, scope, id: frame.id, generation: frame.generation, requestId: randomUUID() })})`,
    );
  await apply({ action: 'add', items: [item] });
  await wait(
    `!!document.querySelector('[data-game-ui-item="${item.id}"] [data-ui-part=progress]')`,
  );
  assert.equal(
    await js(
      `document.querySelector('[data-game-ui-item="${item.id}"] [data-ui-part=progress]').dataset.ratio`,
    ),
    '0.5',
  );
  assert.match(
    await js(
      `document.querySelector('[data-game-ui-item="${item.id}"]').getAttribute('transform')`,
    ),
    /rotate\(45/,
  );
  await js(`document.querySelector('[aria-label="게임 UI 편집"]').click()`);
  await wait('!!document.querySelector(".game-ui-inspector")');
  await js('document.querySelector(".game-ui-layer-list button").click()');
  await wait(`!!document.querySelector('[aria-label="최소 값"]')`);
  assert.equal(
    await js(
      '!!document.querySelector(".game-ui-inspector").closest(".react-flow__viewport")',
    ),
    false,
  );
  const panelWidth = await js(
    'document.querySelector(".game-ui-inspector").getBoundingClientRect().width',
  );
  assert.ok(
    await js(
      '!!document.querySelector(".canvas-dock .canvas-game-ui-host .game-ui-inspector")',
    ),
  );
  assert.ok(
    await js(
      '(()=>{const c=document.querySelector(".canvas-shell").getBoundingClientRect(),p=document.querySelector(".canvas-dock").getBoundingClientRect();return c.right<=p.left+1})()',
    ),
  );
  await js(
    `(()=>{const el=document.querySelector('[aria-label="UI 너비"]');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'invalid');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`,
  );
  await wait(
    `document.querySelector('[aria-label="UI 너비"]').getAttribute('aria-invalid')==='true'`,
  );
  assert.equal(
    (await js('window.gameCanvas.listGameUi().then(f=>f[0].items[0])')).width,
    item.width,
  );
  await js(
    `document.querySelector('[aria-label="UI 너비"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
  );
  await wait(
    `document.querySelector('[aria-label="UI 너비"]').value==='${item.width}'`,
  );
  await js(
    `(()=>{const set=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};set('최소 값','200');set('최대 값','500')})()`,
  );
  await js(
    `document.querySelector('[aria-label="최대 값"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  await wait(
    'window.gameCanvas.listGameUi().then(f=>f[0].items[0].minimum===200&&f[0].items[0].maximum===500&&f[0].items[0].value===200)',
  );
  await js('window.gameCanvas.undo()');
  await wait(
    'window.gameCanvas.listGameUi().then(f=>f[0].items[0].minimum===20&&f[0].items[0].maximum===100&&f[0].items[0].value===60)',
  );
  await apply({ action: 'describe' });
  const descriptionPath = `docs/ui/${frame.id}.md`;
  await js(
    `(async()=>{
      const d=await window.gameCanvas.getDocument(${JSON.stringify(descriptionPath)});
      await window.gameCanvas.saveDocument({
        relativePath:d.relativePath,title:d.title,
        body:d.body.replace('현재 체력과 최대 체력을 표시합니다.','실제 패키지에서 편집한 한글 설명'),
        queueScope:${JSON.stringify(scope)}
      });
    })()`,
  );
  await apply({
    action: 'patch',
    patches: [
      {
        id: item.id,
        generation: item.generation,
        changes: { name: '플레이어 체력', shape: 'ring' },
        expected: { name: item.name, shape: item.shape },
      },
    ],
  });
  const raw = await fs.readFile(path.join(game, descriptionPath), 'utf8');
  assert.match(raw, /플레이어 체력.*실제 패키지에서 편집한 한글 설명/);
  await js('window.gameCanvas.undo()');
  assert.equal(
    (await js('window.gameCanvas.listGameUi().then(f=>f[0].items[0])')).shape,
    'rounded',
  );
  await js('window.gameCanvas.redo()');
  assert.equal(
    (await js('window.gameCanvas.listGameUi().then(f=>f[0].items[0])')).shape,
    'ring',
  );
  await apply({
    action: 'frame',
    changes: { x: 300, y: 400 },
    expected: { x: frame.x, y: frame.y },
  });
  const expected = await js('window.gameCanvas.listGameUi().then(f=>f[0])');
  await fs.mkdir('out/game-ui-packaged', { recursive: true });
  const screenshot = await send('Page.captureScreenshot');
  await fs.writeFile(
    'out/game-ui-packaged/frame.png',
    Buffer.from(screenshot.data, 'base64'),
  );
  await stop(true);
  await boot();
  await js(`document.querySelector('[aria-label="게임 UI 편집"]').click()`);
  await wait('!!document.querySelector(".game-ui-inspector")');
  assert.equal(
    await js(
      'document.querySelector(".game-ui-inspector").getBoundingClientRect().width',
    ),
    panelWidth,
  );
  assert.deepEqual(
    await js('window.gameCanvas.listGameUi().then(f=>f[0])'),
    expected,
  );
  assert.match(
    await js(
      `window.gameCanvas.getDocument(${JSON.stringify(descriptionPath)}).then(d=>d.body)`,
    ),
    /실제 패키지에서 편집한 한글 설명/,
  );
  console.log(
    'PASS: actual Windows package verifies the independent inspector, shared reserved panel layout, invalid drafts/Escape, atomic range/Undo, UI/Markdown persistence, custom descriptions and full process restart.',
  );
} finally {
  await stop();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(
    path
      .resolve(profile)
      .startsWith(
        path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users') +
          path.sep,
      ),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
