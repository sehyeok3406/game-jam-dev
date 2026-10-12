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
await fs.writeFile(path.join(game, 'project.md'), '# 휴지통 패키지 검증');
await fs.mkdir(path.join(game, '.canvas'));
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

  await wait('!!document.querySelector(".home-project-open")');
  assert.equal(
    await js('window.gameCanvas.getUpdateState().then(s=>s.currentVersion)'),
    '0.16.0',
  );
  await js('document.querySelector(".home-project-open").click()');
  await wait('document.querySelectorAll(".workflow-badge").length === 3');
  await wait('!!document.querySelector(".kanban-panel--minimized")');
  assert.equal(
    await js(
      'document.querySelector(".document-header-actions .workflow-badge").nextElementSibling.title',
    ),
    '메모 최소화',
  );
  await js(
    '(()=>{const s=document.querySelector("[data-id=a] .workflow-badge");s.value="in-progress";s.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  await wait(
    '(async()=> (await window.gameCanvas.listDocuments()).find(d=>d.id==="a").workflowStatusId === "in-progress")()',
  );
  await js(
    '[...document.querySelectorAll("button")].find(b=>b.title==="칸반 보드 펼치기").click()',
  );
  await wait('document.querySelectorAll(".kanban-column").length === 3');
  await wait(
    '[...document.querySelectorAll(".kanban-column")].find(c=>c.querySelector("h3").textContent.includes("진행 중")).textContent.includes("개발 문서 A")',
  );
  await js('document.documentElement.dataset.theme="dark"');
  await screenshot('workflow-kanban-dark.png');
  await js(
    '[...document.querySelectorAll(".kanban-header button")].find(b=>b.textContent==="상태 관리").click()',
  );
  await wait('!!document.querySelector(".workflow-manager")');
  await js(
    '(()=>{const r=document.querySelectorAll(".workflow-status-row")[1],color=r.querySelector("input[type=color]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(color,"#a855f7");color.dispatchEvent(new Event("input",{bubbles:true}));color.dispatchEvent(new Event("change",{bubbles:true}));const sel=r.querySelector("select");sel.value="none";sel.dispatchEvent(new Event("change",{bubbles:true}));})()',
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
  assert.equal(settings.value.statuses[1].boardBackground.mode, 'none');
  await js(
    '[...document.querySelectorAll(".kanban-header button")].find(b=>b.textContent==="비활성화").click()',
  );
  await wait('!document.querySelector(".kanban-panel")');
  assert.equal(
    await js('document.querySelectorAll(".workflow-badge").length'),
    3,
  );
  await js(
    '[...document.querySelectorAll("button")].find(b=>b.title==="설정 및 도구")?.click()',
  );
  if (!(await js('!!document.querySelector(".canvas-settings")')))
    await js(
      '[...document.querySelectorAll("button")].find(b=>b.title.includes("설정") && b.title.includes("도구")).click()',
    );
  await wait('!!document.querySelector(".canvas-settings")');
  await js(
    'document.querySelector(".canvas-settings input[type=checkbox]").click()',
  );
  await wait('!!document.querySelector(".kanban-panel")');
  await js(
    '[...document.querySelectorAll("button")].find(b=>b.title==="설정 닫기").click()',
  );
  await js(
    '[...document.querySelectorAll(".kanban-header button")].find(b=>b.textContent==="최소화").click()',
  );
  await wait('!!document.querySelector(".kanban-panel--minimized")');
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
    '!!document.querySelector(".home-project-open") || document.querySelectorAll(".workflow-badge").length === 3',
  );
  await js('document.querySelector(".home-project-open")?.click()');
  await wait('document.querySelectorAll(".workflow-badge").length === 3');
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
    '[...document.querySelectorAll("button")].find(b=>b.title==="칸반 보드 펼치기").click()',
  );
  await js('document.documentElement.dataset.theme="light"');
  await screenshot('workflow-kanban-light.png');
  console.log(
    'PASS: packaged document badge, state edits, kanban linkage, activation/minimize, section geometry/movement and reload persistence',
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
