import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-packaged-workflow-'),
);
const profileId = randomUUID(),
  profile = path.join(
    process.env.APPDATA,
    'Game Canvas',
    'test-users',
    profileId,
  );
const game = path.join(root, 'game'),
  executable = path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe');
await fs.mkdir(game, { recursive: true });
await fs.mkdir(path.join(game, '.git'));
await fs.writeFile(path.join(game, '.git', 'all.bin'), 'unknown files');
await fs.writeFile(
  path.join(game, 'project.md'),
  '---\nid: project\ntitle: project\ntype: reference\nx: 1040\ny: 80\nwidth: 340\nheight: 300\n---\n# 일반 Markdown 상태 검증',
);
await fs.mkdir(path.join(game, '.canvas'));
await fs.writeFile(
  path.join(game, '.canvas', 'canvases.json'),
  JSON.stringify({
    version: 1,
    canvases: [
      { id: 'default', name: '기본 캔버스' },
      { id: 'second', name: '두 번째 캔버스' },
    ],
  }),
);
await fs.writeFile(
  path.join(game, '.canvas', 'project.json'),
  JSON.stringify({ name: '상태 칸반 패키지 검증' }),
);
await fs.mkdir(path.join(game, 'ideas'), { recursive: true });
await fs.mkdir(path.join(game, 'sections'), { recursive: true });
await fs.writeFile(
  path.join(game, 'ideas/a.md'),
  '---\nid: a\ntitle: 개발 문서 A\ntype: idea\nstatus: draft\nx: 80\ny: 80\nwidth: 340\nheight: 300\n---\n# 개발 문서 A\n본문',
);
await fs.writeFile(
  path.join(game, 'ideas/b.md'),
  '---\nid: b\ntitle: 개발 문서 B\ntype: idea\nx: 500\ny: 160\nwidth: 340\nheight: 300\n---\n본문 B',
);
await fs.writeFile(
  path.join(game, 'sections/section.md'),
  '---\nid: sec\ntitle: 개발 섹션\nx: 0\ny: 0\nwidth: 900\nheight: 620\nmembers:\n  - id: a\n    path: ideas/a.md\n  - id: b\n    path: ideas/b.md\n---\n',
);
await fs.mkdir(path.resolve('out/qa'), { recursive: true });
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '상태 칸반 패키지 검증',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
const listener = net.createServer();
await new Promise((r) => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const child = spawn(
  executable,
  [
    `--game-canvas-test-profile=${profileId}`,
    `--remote-debugging-port=${port}`,
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let ws;
let diagnostic = '';
child.stderr.on(
  'data',
  (b) => (diagnostic = (diagnostic + b.toString()).slice(-4000)),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 160; i++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (r) => r.json(),
      );
      target = pages.find(
        (p) => p.type === 'page' && p.url.includes('index.html'),
      );
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(target, 'Packaged app did not load: ' + diagnostic);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let next = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
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
  const wait = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await js(expression)) return;
      await sleep(80);
    }
    throw Error('Timeout: ' + expression);
  };
  const screenshot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      path.resolve('out/qa/' + name),
      Buffer.from(r.data, 'base64'),
    );
  };

  const rect = (selector) =>
    js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`,
    );
  const mouse = (type, x, y, buttons = 0) =>
    send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  const click = async (selector) => {
    if (
      selector === '[data-plugin-launcher]' &&
      !(await js('document.querySelector(".canvas-main-menu").open'))
    ) {
      await click('.canvas-main-menu > summary');
    }
    const r = await rect(selector),
      x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    await mouse('mousePressed', x, y, 1);
    await mouse('mouseReleased', x, y);
    await sleep(100);
  };
  const openMiniMap = async () => {
    if (!(await js('!!document.querySelector(".react-flow__minimap")'))) {
      await click('[aria-label="미니맵 전환"]');
    }
    await wait('!!document.querySelector(".react-flow__minimap")');
  };
  const drag = async (selector, dx, dy, corner = false) => {
    const r = await rect(selector),
      x = corner ? r.x + r.width - 3 : r.x + r.width / 2,
      y = corner ? r.y + r.height - 3 : r.y + r.height / 2;
    await mouse('mousePressed', x, y, 1);
    for (let step = 1; step <= 8; step++) {
      await mouse('mouseMoved', x + (dx * step) / 8, y + (dy * step) / 8, 1);
      await sleep(30);
    }
    await mouse('mouseReleased', x + dx, y + dy);
    await sleep(250);
  };
  const prefs = () =>
    js(
      `JSON.parse(localStorage.getItem(${JSON.stringify('builtin.kanban.canvas:' + game)}))?.canvases.default`,
    );
  await wait('!!document.querySelector(".home-project-open")');
  assert.equal(
    await js('window.gameCanvas.getUpdateState().then(s=>s.currentVersion)'),
    JSON.parse(await fs.readFile('package.json', 'utf8')).version,
  );
  await js('document.querySelector(".home-project-open").click()');
  await wait(
    'document.querySelectorAll(".document-header-actions .workflow-badge").length === 3',
  );
  await sleep(500); // Initial canvas fit animates after node measurement.
  await js(
    '[...document.querySelectorAll(".bottom-toolbar button")].find(b=>b.title==="선택 도구 (V)").click()',
  );
  assert.equal(
    await js('!!document.querySelector(".kanban-canvas-node")'),
    false,
  );
  assert.equal(
    await js(
      'document.querySelector(".document-header-actions .file-property-badges").nextElementSibling.title',
    ),
    '메모 최소화',
  );
  // Real mouse input proves that the dropdown actually opens; a synthetic change event did not prove this.
  await screenshot('workflow-before-badge.png');
  await click('[data-id="a"] .workflow-badge');
  await screenshot('workflow-after-badge.png');
  await wait('!!document.querySelector(".workflow-status-menu:popover-open")');
  await click(
    '.workflow-status-menu:popover-open [role="option"]:nth-child(2)',
  );
  await wait(
    '(async()=> (await window.gameCanvas.listDocuments()).find(d=>d.id==="a").workflowStatusId === "in-progress")()',
  );
  await click('.canvas-main-menu > summary');
  await click('[data-plugin-launcher]');
  await wait(
    `!!document.querySelector('.plugin-control-panel[aria-label="플러그인 관리"]')`,
  );
  const dock = await rect('.canvas-dock'),
    canvas = await rect('.canvas-shell'),
    firstPanel = await rect('.plugin-control-panel');
  assert.ok(
    canvas.x + canvas.width <= dock.x + 1,
    'Plugin controls reserve a side panel without covering the canvas',
  );
  assert.ok(
    firstPanel.x >= dock.x &&
      firstPanel.x + firstPanel.width <= dock.x + dock.width + 1,
  );
  const panelBox = dock;
  await click('.plugin-control-panel [aria-label="칸반 보드 열기"]');
  await wait('!!document.querySelector(".kanban-controls")');
  assert.deepEqual(
    await rect('.canvas-dock'),
    panelBox,
    'Opening controls preserves geometry',
  );
  await click('[aria-label="플러그인 관리로 뒤로가기"]');
  await wait('!!document.querySelector(".builtin-feature-row")');
  assert.deepEqual(
    await rect('.canvas-dock'),
    panelBox,
    'Back preserves geometry',
  );
  await click('.plugin-control-panel [aria-label="칸반 보드 활성화"]');
  await wait('document.querySelectorAll(".kanban-column").length === 3');
  await wait(
    '[...document.querySelectorAll(".kanban-column")].find(c=>c.querySelector("h3").textContent.includes("진행 중")).textContent.includes("개발 문서 A")',
  );
  await click('.plugin-control-panel [aria-label="칸반 보드 열기"]');
  await click('[aria-label="작업 패널 닫기"]');
  assert.equal(
    await js('!!document.querySelector(".kanban-canvas-node")'),
    true,
    'Close only closes controls',
  );
  await sleep(300);
  const worldBefore = await prefs();
  // Header movement is a canvas-space move, not a fixed overlay move.
  await drag('.kanban-drag-handle strong', -60, 30);
  await wait(
    `JSON.parse(localStorage.getItem(${JSON.stringify('builtin.kanban.canvas:' + game)})).canvases.default.x !== ${worldBefore.x}`,
  );
  const worldMoved = await prefs();
  assert.ok(worldMoved.x < worldBefore.x - 40);
  assert.ok(worldMoved.y > worldBefore.y + 20);
  await click('.kanban-drag-handle strong');
  await wait(
    '!!document.querySelector(".react-flow__node-kanban.selected .react-flow__resize-control.top.left")',
  );
  await drag(
    '.react-flow__node-kanban.selected .react-flow__resize-control.top.left',
    -60,
    -40,
  );
  let worldResized = await prefs();
  assert.ok(
    worldResized.width > worldBefore.width + 30,
    'Canvas board resizes',
  );
  // Canvas zoom scales the board, while plugin controls retain screen-space dimensions.
  await click('[data-plugin-launcher]');
  const stablePanel = await rect('.plugin-control-panel');
  const beforeZoom = await rect('.kanban-canvas-node');
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 80,
    y: 440,
    deltaX: 0,
    deltaY: 180,
    modifiers: 2,
  });
  await sleep(400);
  assert.ok(
    (await rect('.kanban-canvas-node')).width < beforeZoom.width - 20,
    'Canvas zoom scales the board',
  );
  assert.deepEqual(await rect('.plugin-control-panel'), stablePanel);
  await screenshot('workflow-plugin-management.png');
  await click('.plugin-control-panel [aria-label="칸반 보드 열기"]');
  await screenshot('workflow-plugin-kanban-controls.png');
  await js('document.documentElement.dataset.theme="dark"');
  await click('[aria-label="작업 패널 닫기"]');
  await mouse('mousePressed', 16, 250, 1);
  await mouse('mouseReleased', 16, 250);
  await wait('!document.querySelector(".react-flow__node-kanban.selected")');
  const grip = await rect('.kanban-resize-grip');
  assert.ok(
    grip.width >= 24,
    'Grip stays usable when the canvas is zoomed out',
  );
  assert.equal(
    await js(
      `!!document.elementFromPoint(${grip.x + grip.width / 2},${grip.y + grip.height / 2})?.closest('.kanban-resize-grip')`,
    ),
    true,
    'The unselected board exposes a directly usable resize grip',
  );
  const originBeforeResize = await prefs();
  await drag('.kanban-resize-grip', -1000, -1000);
  const minimumSize = await prefs();
  assert.equal(minimumSize.width, 520, 'Resize respects minimum width');
  assert.equal(minimumSize.height, 260, 'Resize respects minimum height');
  const screenBeforeResize = await rect('.kanban-canvas-node');
  const resizeZoom = screenBeforeResize.width / minimumSize.width;
  await drag('.kanban-resize-grip', 90, 70);
  worldResized = await prefs();
  assert.ok(
    Math.abs(worldResized.width - minimumSize.width - 90 / resizeZoom) < 3,
  );
  assert.ok(
    Math.abs(worldResized.height - minimumSize.height - 70 / resizeZoom) < 3,
  );
  assert.equal(
    worldResized.x,
    originBeforeResize.x,
    'Resize never moves the board origin',
  );
  assert.equal(worldResized.y, originBeforeResize.y);
  const screenAfterResize = await rect('.kanban-canvas-node');
  assert.ok(
    Math.abs(screenAfterResize.x - screenBeforeResize.x) < 1,
    'Resize does not pan the canvas',
  );
  assert.ok(Math.abs(screenAfterResize.y - screenBeforeResize.y) < 1);
  await screenshot('kanban-resize-grip-dark.png');
  await screenshot('workflow-kanban-dark.png');
  await click('.kanban-node-actions [aria-label="칸반 컨트롤 열기"]');
  await js(
    '[...document.querySelectorAll(".kanban-controls button")].find(b=>b.textContent.includes("상태 옵션")).click()',
  );
  await wait('!!document.querySelector(".workflow-manager")');
  await js(
    '(()=>{const r=document.querySelectorAll(".workflow-status-row")[1],color=r.querySelector("input[type=color]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(color,"#a855f7");color.dispatchEvent(new Event("input",{bubbles:true}));color.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  await js(
    '[...document.querySelectorAll(".workflow-manager button")].find(b=>b.textContent==="+ 상태 추가").click()',
  );
  await screenshot('workflow-status-manager.png');
  await js(
    '[...document.querySelectorAll(".workflow-manager footer button")].find(b=>b.textContent==="저장").click()',
  );
  await wait('!document.querySelector(".workflow-manager")');
  const settings = await js('window.gameCanvas.getDocumentStatuses()');
  assert.equal(settings.value.statuses.length, 4);
  assert.equal(settings.value.statuses[1].badgeColor, '#A855F7');
  assert.equal(settings.value.statuses[1].boardBackground.mode, 'status');
  await js(
    '[...document.querySelectorAll(".kanban-controls button")].find(b=>b.textContent.trim()==="열 배경 관리").click()',
  );
  await wait('!!document.querySelector(".kanban-appearance-manager")');
  await js(
    '(()=>{const s=document.querySelectorAll(".kanban-appearance-manager select")[1];s.value="none";s.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  await click('[aria-label="완료 열 배경"]');
  for (const key of ['ArrowDown', 'Enter']) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }
  await wait(
    `!!document.querySelector('.kanban-appearance-manager [aria-label="완료 열 배경 HEX 색"]')`,
  );
  await click('[aria-label="완료 열 배경 HEX 색"]');
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    modifiers: 2,
    windowsVirtualKeyCode: 65,
  });
  await send('Input.insertText', { text: '#224466' });
  await js(
    '[...document.querySelectorAll(".kanban-appearance-manager footer button")].find(b=>b.textContent==="저장").click()',
  );
  await wait('!document.querySelector(".kanban-appearance-manager")');
  assert.equal(
    (await js('window.gameCanvas.getKanbanView()')).value.backgrounds[
      'in-progress'
    ].mode,
    'none',
  );
  assert.equal(
    (await js('window.gameCanvas.getKanbanView()')).value.backgrounds.done
      .color,
    '#224466',
  );
  await click('[aria-label="칸반 보드 최소화"]');
  await wait('!!document.querySelector(".kanban-canvas-node--minimized")');
  assert.equal(
    await js('!!document.querySelector(".kanban-resize-grip")'),
    false,
    'Minimized boards have no resize grip',
  );
  const minimized = await prefs();
  assert.equal(
    minimized.height,
    worldResized.height,
    'Minimize preserves expanded size',
  );
  await click('[aria-label="플러그인 관리로 뒤로가기"]');
  await click('.plugin-control-panel [aria-label="칸반 보드 활성화"]');
  await wait('!document.querySelector(".kanban-canvas-node")');
  await click('.plugin-control-panel [aria-label="칸반 보드 활성화"]');
  await wait('!!document.querySelector(".kanban-canvas-node--minimized")');
  assert.deepEqual(
    await prefs(),
    minimized,
    'Reactivation restores canvas geometry and minimized state',
  );
  await click('[aria-label="작업 패널 닫기"]');
  const beforeSection = await js(
    'window.gameCanvas.listSections().then(s=>s[0])',
  );
  const beforeDocs = await js(
    'window.gameCanvas.listDocuments().then(ds=>ds.filter(d=>d.id==="a"||d.id==="b").map(d=>({id:d.id,x:d.x,y:d.y,width:d.width,height:d.height,collapsed:d.collapsed})))',
  );
  await js(
    'document.querySelector(".section-card button[aria-expanded]").click()',
  );
  await wait(
    'document.querySelectorAll(".section-member-hidden").length === 2',
  );
  assert.equal(
    await js('document.querySelector("[data-id=a] article").inert'),
    true,
  );
  assert.equal(
    (await js('window.gameCanvas.listSections().then(s=>s[0])')).height,
    beforeSection.height,
  );
  assert.deepEqual(
    await js(
      'window.gameCanvas.listDocuments().then(ds=>ds.filter(d=>d.id==="a"||d.id==="b").map(d=>({id:d.id,x:d.x,y:d.y,width:d.width,height:d.height,collapsed:d.collapsed})))',
    ),
    beforeDocs,
  );
  await screenshot('workflow-section-collapsed.png');
  await js(
    'document.querySelector(".section-card button[aria-expanded]").click()',
  );
  await wait(
    'document.querySelectorAll(".section-member-hidden").length === 0',
  );
  assert.deepEqual(
    await js(
      'window.gameCanvas.listDocuments().then(ds=>ds.filter(d=>d.id==="a"||d.id==="b").map(d=>({id:d.id,x:d.x,y:d.y,width:d.width,height:d.height,collapsed:d.collapsed})))',
    ),
    beforeDocs,
  );
  await js(
    'document.querySelector(".section-card button[aria-expanded]").click()',
  );
  await wait(
    'document.querySelectorAll(".section-member-hidden").length === 2',
  );
  await js(
    '(async()=>{const s=(await window.gameCanvas.listSections())[0];await window.gameCanvas.updateSectionLayout({...s,relativePath:s.relativePath,x:s.x+100,y:s.y+50,moveMembers:true});})()',
  );
  assert.equal(
    (
      await js(
        'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="a"))',
      )
    ).x,
    beforeDocs.find((d) => d.id === 'a').x + 100,
  );
  await send('Page.reload');
  await wait(
    '!!document.querySelector(".home-project-open") || document.querySelectorAll(".document-header-actions .workflow-badge").length === 3',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait(
    'document.querySelectorAll(".document-header-actions .workflow-badge").length === 3',
  );
  await wait('!!document.querySelector(".kanban-canvas-node--minimized")');
  assert.deepEqual(
    await prefs(),
    minimized,
    'Reload restores canvas board preferences',
  );
  await click('[data-plugin-launcher]');
  assert.deepEqual(
    await rect('.plugin-control-panel'),
    stablePanel,
    'Reload restores plugin panel geometry',
  );
  await click('[aria-label="작업 패널 닫기"]');
  await wait(
    'document.querySelectorAll(".section-member-hidden").length === 2',
  );
  assert.equal(
    await js(
      'window.gameCanvas.getDocumentStatuses().then(s=>s.value.statuses.length)',
    ),
    4,
  );
  assert.equal(
    await js(
      'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="a").workflowStatusId)',
    ),
    'in-progress',
  );
  await js(
    'document.querySelector(".section-card button[aria-expanded]").click()',
  );
  await wait(
    'document.querySelectorAll(".section-member-hidden").length === 0',
  );
  await js(
    '[...document.querySelectorAll("button")].find(b=>b.title==="칸반 펼치기").click()',
  );
  await js('document.documentElement.dataset.theme="light"');
  assert.ok(
    Math.abs(
      (await rect('.kanban-canvas-node')).width / (await prefs()).width -
        (await rect('.kanban-canvas-node')).height / (await prefs()).height,
    ) < 0.01,
    'Expanding restores both saved dimensions',
  );
  await screenshot('workflow-kanban-light.png');
  // A plain Markdown document uses the same physical status selection.
  await js(
    '[...document.querySelectorAll(".kanban-card-title")].find(b=>b.textContent==="project").click()',
  );
  await sleep(400);
  const projectDoc = await js(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.relativePath==="project.md"))',
  );
  await click(`[data-id="${projectDoc.id}"] .workflow-badge`);
  await wait('!!document.querySelector(".workflow-status-menu:popover-open")');
  await click(
    '.workflow-status-menu:popover-open [role="option"]:nth-child(3)',
  );
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.relativePath==="project.md").workflowStatusId==="done")',
  );
  const firstSaved = await prefs();
  await click('.canvas-tabs__item:nth-child(2) [role="tab"]');
  await wait(
    'document.querySelectorAll(".document-header-actions .workflow-badge").length===0',
  );
  assert.equal(
    await js('!!document.querySelector(".kanban-canvas-node")'),
    false,
    'Boards are isolated per canvas',
  );
  await click('[data-plugin-launcher]');
  await click('.plugin-control-panel [aria-label="칸반 보드 열기"]');
  assert.equal(
    await js('!!document.querySelector(".kanban-controls select")'),
    false,
    'Document scope lives on canvas board',
  );
  await click('[aria-label="보드를 표시할 캔버스 선택"]');
  await wait(
    '!!document.querySelector(".canvas-visibility-menu:popover-open")',
  );
  await click(
    '.canvas-visibility-menu:popover-open [aria-label="두 번째 캔버스에 칸반 표시"]',
  );
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
  await wait('!!document.querySelector(".kanban-empty")');
  await js(
    '(()=>{const s=document.querySelector(".kanban-scope-select");s.value="project";s.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  await wait('document.querySelectorAll(".kanban-card").length===3');
  await click('[aria-label="플러그인 관리로 뒤로가기"]');
  await click('.canvas-tabs__item:first-child [role="tab"]');
  await wait(
    'document.querySelectorAll(".document-header-actions .workflow-badge").length===3',
  );
  assert.deepEqual(
    await prefs(),
    firstSaved,
    'Changing another canvas does not alter first board',
  );
  await click('[aria-label="작업 패널 닫기"]');
  // Load a legacy HTML without a management record; status selection must create/update its anchor.
  await fs.mkdir(path.join(game, 'output'), { recursive: true });
  await fs.writeFile(
    path.join(game, 'output', 'index.html'),
    '<!doctype html><html><head><title>상태 검증</title></head><body>HTML 상태 검증</body></html>',
  );
  await wait(
    '!!document.querySelector(".react-flow__node-preview .workflow-badge")',
  );
  await sleep(500);
  await click('.react-flow__node-preview .workflow-badge');
  await wait('!!document.querySelector(".workflow-status-menu:popover-open")');
  await click(
    '.workflow-status-menu:popover-open [role="option"]:nth-child(2)',
  );
  await wait(
    'window.gameCanvas.listPreviews().then(ps=>ps[0].workflowStatusId==="in-progress")',
  );
  await screenshot('workflow-html-status.png');
  await js(
    `localStorage.removeItem(${JSON.stringify('builtin.kanban.canvas:' + game)});localStorage.setItem(${JSON.stringify('builtin.kanban:' + game)},JSON.stringify({enabled:true,minimized:true,scope:'project',x:80,y:100,width:800,height:400}));`,
  );
  await send('Page.reload');
  await wait(
    '!!document.querySelector(".home-project-open") || !!document.querySelector(".react-flow__node-preview")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait(
    `JSON.parse(localStorage.getItem(${JSON.stringify('builtin.kanban.canvas:' + game)}))?.legacyMigrated===true`,
  );
  const migrated = await prefs();
  assert.equal(migrated.scope, 'project');
  assert.equal(migrated.minimized, true);
  assert.equal(migrated.enabled, true);
  assert.equal(migrated.placed, true);
  await wait('!!document.querySelector(".kanban-canvas-node--minimized")');
  // Minimap controls are physically operable and persist through reload.
  await openMiniMap();
  await click('[aria-label="미니맵 설정"]');
  await wait('!!document.querySelector(".minimap-settings")');
  await click('[aria-label="미니맵 투명도"]');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home' });
  for (let i = 0; i < 7; i++) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowRight',
    });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight' });
  }
  await wait(
    'document.querySelector(".react-flow__minimap").style.opacity==="0.65"',
  );
  await screenshot('minimap-transparency-light.png');
  await click('[aria-label="미니맵 화면 밖 음영"]');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home' });
  for (let i = 0; i < 15; i++) {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowRight',
    });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight' });
  }
  await wait(
    'document.querySelector(".react-flow__minimap").style.getPropertyValue("--xy-minimap-mask-background-color-props").includes("0.3")',
  );
  await click('[aria-label="미니맵 설정 닫기"]');
  // All canvases includes newly added canvases, with independent board positions.
  await click('[data-plugin-launcher]');
  await click('.plugin-control-panel [aria-label="칸반 보드 열기"]');
  await click('[aria-label="보드를 표시할 캔버스 선택"]');
  await click(
    '.canvas-visibility-menu:popover-open [aria-label="전체 캔버스에 칸반 표시"]',
  );
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
  await click('[aria-label="작업 패널 닫기"]');
  await js(
    '(async()=>{const s=await window.gameCanvas.getCanvasSheets();await window.gameCanvas.changeCanvasSheets({action:"add",id:"future",name:"새 캔버스",expected:s.raw??null});})()',
  );
  await wait('document.querySelectorAll(".canvas-tabs__item").length===3');
  await click('.canvas-tabs__item:nth-child(3) [role="tab"]');
  await wait('!!document.querySelector(".kanban-canvas-node")');
  await screenshot('kanban-all-canvases.png');
  await click('.canvas-tabs__item:first-child [role="tab"]');
  await wait('!!document.querySelector(".react-flow__node-preview")');
  // An outlier and huge empty section must not influence destination placement.
  for (const [id, x, y] of [
    ['target-one', 100, 100],
    ['target-two', 480, 100],
    ['target-outlier', 30000, 40000],
  ])
    await fs.writeFile(
      path.join(game, 'ideas', id + '.md'),
      `---\nid: ${id}\ntitle: ${id}\ntype: idea\ncanvas_id: second\nx: ${x}\ny: ${y}\nwidth: 340\nheight: 300\n---\nbody`,
    );
  await fs.writeFile(
    path.join(game, 'sections', 'empty.md'),
    '---\nid: empty\ntitle: empty\ncanvas_id: second\nx: -100000\ny: -100000\nwidth: 200000\nheight: 200000\nmembers: []\n---\n',
  );
  await js(
    '(async()=>{const d=(await window.gameCanvas.listDocuments()).find(d=>d.id==="b");await window.gameCanvas.updateDocumentLayout({...d,relativePath:d.relativePath,x:-50000,y:50000});await window.gameCanvas.savePreviewWindow({x:50000,y:50000,width:720,height:520,collapsed:false},"output/index.html");})()',
  );
  await send('Page.reload');
  await wait(
    '!!document.querySelector(".home-project-open")||!!document.querySelector(".react-flow__node-preview")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait('!!document.querySelector(".react-flow__node-preview")');
  await openMiniMap();
  assert.equal(
    await js('document.querySelector(".react-flow__minimap").style.opacity'),
    '0.65',
  );
  const moveToSecond = async (paths) =>
    js(
      `(async()=>{const s=await window.gameCanvas.getCanvasSheets();await window.gameCanvas.changeCanvasSheets({action:"move",id:"default",targetId:"second",paths:${JSON.stringify(paths)},expected:s.raw??null});})()`,
    );
  await moveToSecond(['ideas/b.md']);
  await moveToSecond(['project.md']);
  await moveToSecond(['output/index.html']);
  await wait(
    'window.gameCanvas.getPreviewWindow("output/index.html").then(w=>!!w.placementId&&Math.abs(w.x)<4000&&Math.abs(w.y)<4000)',
  );
  const moved = await js(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="b"))',
  );
  assert.equal(moved.canvasId, 'second');
  assert.ok(Math.abs(moved.x) < 4000 && Math.abs(moved.y) < 4000);
  const movedWindow = await js(
    'window.gameCanvas.getPreviewWindow("output/index.html")',
  );
  await click('.canvas-tabs__item:nth-child(2) [role="tab"]');
  await wait('!!document.querySelector(".react-flow__node-preview")');
  await wait(
    'document.querySelectorAll(".document-header-actions .workflow-badge").length===5',
  );
  const colors = await js(
    '["note","file","html","kanban"].map(k=>{const n=document.querySelector(`[data-minimap-kind="${k}"]`);return {kind:k,fill:n&&getComputedStyle(n).fill,stroke:n&&getComputedStyle(n).stroke,vector:n?.getAttribute("vector-effect")};})',
  );
  assert.ok(
    colors.every(
      (c) => c.fill && c.stroke && c.vector === 'non-scaling-stroke',
    ),
  );
  assert.equal(
    new Set(colors.map((c) => c.fill)).size,
    4,
    'Minimap distinguishes notes/files/HTML/kanban',
  );
  await fs.unlink(path.join(game, 'sections', 'empty.md'));
  await fs.unlink(path.join(game, 'ideas', 'target-outlier.md'));
  await wait(
    'document.querySelectorAll(".document-header-actions .workflow-badge").length===4',
  );
  await js('localStorage.setItem("game-canvas-theme","light")');
  await send('Page.reload');
  await wait(
    '!!document.querySelector(".home-project-open")||!!document.querySelector(".react-flow__node-preview")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait('!!document.querySelector(".react-flow__node-preview")');
  await screenshot('minimap-visibility-light.png');
  await js('localStorage.setItem("game-canvas-theme","dark")');
  await send('Page.reload');
  await wait(
    '!!document.querySelector(".home-project-open")||!!document.querySelector(".react-flow__node-preview")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait('!!document.querySelector(".react-flow__node-preview")');
  await screenshot('minimap-visibility-dark.png');
  await send('Page.reload');
  await wait(
    '!!document.querySelector(".home-project-open")||!!document.querySelector(".react-flow__node-preview")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait('!!document.querySelector(".react-flow__node-preview")');
  assert.deepEqual(
    await js('window.gameCanvas.getPreviewWindow("output/index.html")'),
    movedWindow,
    'HTML window never restores its old canvas coordinates',
  );
  // Properties belong to files; hiding a badge never removes its board card.
  await click('.canvas-tabs__item:nth-child(2) [role="tab"]');
  await wait('!!document.querySelector("[data-id=b]")');
  await js(
    '[...document.querySelectorAll("button")].find(b=>b.title==="칸반 펼치기")?.click()',
  );
  await wait(
    '[...document.querySelectorAll(".kanban-card-title")].some(b=>b.textContent==="개발 문서 B")',
  );
  await js(
    `[...document.querySelectorAll('.kanban-card-title')].find(b=>b.textContent==='개발 문서 B').click()`,
  );
  await sleep(300);
  await js(
    `document.querySelector('[data-id=b] .document-header-actions [title="문서 상세 정보"]').click()`,
  );
  await wait('!!document.querySelector(".file-properties-editor")');
  const beforeProperties = await js(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="b"))',
  );
  await click('[aria-label="상태 속성 적용"]');
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="b").statusPropertyEnabled===false)',
  );
  await wait('!document.querySelector("[data-id=b] .workflow-badge")');
  assert.equal(
    (
      await js(
        'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="b"))',
      )
    ).workflowStatusId,
    beforeProperties.workflowStatusId ?? 'not-started',
  );
  assert.equal(
    await js(
      '[...document.querySelectorAll(".kanban-card-title")].some(b=>b.textContent==="개발 문서 B")',
    ),
    false,
  );
  await click('[aria-label="상태 속성 적용"]');
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="b").statusPropertyEnabled===true)',
  );
  await wait('!!document.querySelector("[data-id=b] .workflow-badge")');
  assert.equal(
    (
      await js(
        'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="b"))',
      )
    ).workflowStatusId,
    beforeProperties.workflowStatusId ?? 'not-started',
  );
  const bytesBeforeHide = await fs.readFile(
    path.join(game, 'ideas/b.md'),
    'utf8',
  );
  await click('[aria-label="상태 우측 상단 표시"]');
  await wait('!document.querySelector("[data-id=b] .workflow-badge")');
  assert.equal(
    await fs.readFile(path.join(game, 'ideas/b.md'), 'utf8'),
    bytesBeforeHide,
    'Personal display changes never rewrite shared files',
  );
  assert.equal(
    await js(
      '[...document.querySelectorAll(".kanban-card-title")].some(b=>b.textContent==="개발 문서 B")',
    ),
    true,
    'Hidden properties remain on the board',
  );
  await click('[aria-label="생성자 우측 상단 표시"]');
  await click('[aria-label="생성일 우측 상단 표시"]');
  await click('[aria-label="마지막 편집자 우측 상단 표시"]');
  await wait('!!document.querySelector("[data-id=b] .file-property-more")');
  await screenshot('file-properties-detail-dark.png');
  const createdFile = await js(
    'window.gameCanvas.createIdea({x:100,y:100,canvasId:"second"})',
  );
  assert.equal(
    createdFile.statusPropertyEnabled,
    false,
    'New files start with optional status unapplied',
  );
  await send('Page.reload');
  await wait(
    '!!document.querySelector(".home-project-open")||!!document.querySelector("[data-id=b]")',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait('!!document.querySelector("[data-id=b] .file-property-badges")');
  assert.equal(
    await js('!!document.querySelector("[data-id=b] .workflow-badge")'),
    false,
    'Property visibility survives reload',
  );
  assert.equal(
    await js(
      '[...document.querySelectorAll(".kanban-card-title")].some(b=>b.textContent==="개발 문서 B")',
    ),
    true,
  );
  await js(
    `document.querySelector('[data-id=b] .document-header-actions [title="문서 상세 정보"]').click()`,
  );
  await wait('!!document.querySelector(".file-properties-editor")');
  assert.equal(
    await js(
      `document.querySelector('[aria-label="생성자 우측 상단 표시"]').checked`,
    ),
    true,
  );
  await screenshot('file-properties-detail-restored.png');
  await js(
    `document.querySelector('.react-flow__node-preview [title="문서 상세 정보"]').click()`,
  );
  await wait('!!document.querySelector(".file-properties-editor")');
  const htmlBeforeProperties = await fs.readFile(
    path.join(game, 'output/index.html'),
    'utf8',
  );
  await click('[aria-label="상태 속성 적용"]');
  await wait(
    'window.gameCanvas.listPreviews().then(ps=>ps[0].statusPropertyEnabled===false)',
  );
  await wait(
    '!document.querySelector(".react-flow__node-preview .workflow-badge")',
  );
  assert.equal(
    await fs.readFile(path.join(game, 'output/index.html'), 'utf8'),
    htmlBeforeProperties,
  );
  await click('[aria-label="상태 속성 적용"]');
  await wait(
    'window.gameCanvas.listPreviews().then(ps=>ps[0].statusPropertyEnabled===true)',
  );
  await wait(
    '!!document.querySelector(".react-flow__node-preview .workflow-badge")',
  );
  await screenshot('file-properties-html-detail.png');
  console.log(
    'PASS: physical property apply/unapply/restore; personal visibility preserves shared bytes and board inclusion; system-property display/overflow; optional new files and reload',
  );
  console.log(
    'PASS: unselected kanban grip resize at canvas zoom, minimum bounds, stable origin/viewport and minimized/reloaded dimensions; physical status dropdowns; plugin back/move/resize; nearby canvas boards; checkbox visibility and future canvases; board-local document scope; physical minimap transparency and persistence; document/HTML destination placement and cached HTML reload; distinct minimap colors and non-scaling outlines',
  );
} finally {
  ws?.close();
  child.kill();
  await new Promise((r) => {
    if (child.exitCode !== null) r();
    else child.once('exit', r);
  });
  // Both targets are exact paths created for this test; verify containment before cleanup.
  assert.ok(
    profile.startsWith(
      path.join(process.env.APPDATA, 'Game Canvas', 'test-users') + path.sep,
    ),
  );
  assert.ok(root.startsWith(os.tmpdir() + path.sep));
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
