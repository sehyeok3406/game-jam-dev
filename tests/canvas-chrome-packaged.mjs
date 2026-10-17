import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const packageDir = path.resolve(
  process.env.GAMEJAM_PACKAGE_DIR ?? 'out/Game Jam!-win32-x64',
);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-chrome-'));
const profileRoot = path.resolve(
  process.env.APPDATA,
  'Game Canvas',
  'test-users',
);
const profileId = randomUUID();
const profile = path.join(profileRoot, profileId);
const server = net.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(temp, 'project.md'),
  '---\nid: chrome-test\ntitle: UI 패키지 검증\ntype: idea\nstatus: draft\n---\n# 캔버스 UI 검증\n',
);
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + temp.toLowerCase(),
      root: temp,
      name: 'UI 패키지 검증',
      kind: 'local',
      lastOpenedAt: Date.now(),
    },
  ]),
);
const child = spawn(
  path.join(packageDir, 'Game Canvas.exe'),
  [
    `--game-canvas-test-profile=${profileId}`,
    `--remote-debugging-port=${port}`,
  ],
  { windowsHide: true, stdio: 'ignore' },
);
const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
try {
  let target;
  for (let n = 0; n < 200; n++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      ).find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (target) break;
    } catch {}
    await pause();
  }
  assert.ok(target, 'Packaged renderer did not load');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const requests = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(String(data)),
      p = requests.get(m.id);
    if (p) {
      requests.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      requests.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params }));
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
    for (let n = 0; n < 200; n++) {
      if (await js(expression)) return;
      await pause();
    }
    throw Error('Packaged timeout: ' + expression);
  };
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await fs.mkdir('out/canvas-chrome-packaged', { recursive: true });
  const capture = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(
      `out/canvas-chrome-packaged/${name}.png`,
      Buffer.from(result.data, 'base64'),
    );
  };
  await wait('!!document.querySelector(".home-project-open")');
  assert.match(
    await js('document.querySelector(".home-app-version").textContent'),
    /0\.32\.0/,
  );
  assert.ok(
    await js(
      '!![...document.querySelectorAll(".home-sidebar-bottom button")].find(b=>b.textContent.includes("협업 서버 열기"))',
    ),
  );
  assert.ok(
    await js(
      '!!document.querySelector(".home-sidebar-bottom .lucide-trash-2")',
    ),
  );
  await capture('home');
  await click('.home-heading .button-primary');
  await wait('document.querySelector(".home-add-dialog").open');
  assert.equal(
    await js(
      'document.querySelectorAll(".home-add-dialog .home-entry-actions button").length',
    ),
    3,
  );
  await capture('project-add');
  await click('[aria-label="프로젝트 추가 닫기"]');
  await click('.home-project-open');
  await wait('!!document.querySelector(".document-card")');
  for (const [width, height] of [
    [980, 640],
    [1280, 720],
    [1920, 1080],
  ]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(200);
    for (const theme of ['light', 'dark']) {
      await js(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await click('[aria-label="AI 작업 패널"]');
      await wait('!!document.querySelector(".canvas-dock")');
      assert.ok(
        await js(
          `(()=>{const a=document.querySelector('.canvas-shell').getBoundingClientRect(),b=document.querySelector('.canvas-dock').getBoundingClientRect();return a.right<=b.left+1&&a.width>500;})()`,
        ),
      );
      for (const selector of [
        '.header-undo button',
        '.canvas-utility [aria-label="축소"]',
        '.canvas-utility [aria-label="확대"]',
        '.canvas-utility [aria-label="캔버스 전체 맞춤"]',
      ]) {
        assert.ok(
          await js(
            `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>=30&&r.height>=30&&(hit===e||e.contains(hit));})()`,
          ),
          selector,
        );
      }
      await capture(`canvas-${width}-${theme}`);
      await click('[aria-label="작업 패널 닫기"]');
    }
  }
  for (const factor of [1.25, 1.5]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 980,
      height: 640,
      deviceScaleFactor: factor,
      mobile: false,
    });
    await click('[aria-label="AI 작업 패널"]');
    await wait('!!document.querySelector(".canvas-dock")');
    assert.ok(
      await js(
        '(()=>{const c=document.querySelector(".canvas-shell").getBoundingClientRect(),p=document.querySelector(".canvas-dock").getBoundingClientRect();return c.right<=p.left+1})()',
      ),
    );
    await capture('scale-' + factor);
    await click('[aria-label="작업 패널 닫기"]');
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(200);
  await click('[aria-label="도형 삽입"]');
  await js(
    'document.querySelector(".drawing-tool-menu__items button").click()',
  );
  await wait('!!document.querySelector(".canvas-dock .drawing-inspector")');
  await capture('properties');
  await click('.ui-tools-toggle');
  await wait('!!document.querySelector(".canvas-workspace--focus")');
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector(".bottom-toolbar")).display',
    ),
    'none',
  );
  await click('.ui-tools-toggle');
  await wait('!!document.querySelector(".canvas-dock")');
  await click('[aria-label="협업 패널"]');
  await wait('!!document.querySelector(".canvas-collaboration")');
  await click('[aria-label="작업 패널 닫기"]');
  const source = await js('window.gameCanvas.listDocuments().then(ds=>ds[0])');
  await js(
    `window.gameCanvas.saveDocument({relativePath:${JSON.stringify(source.relativePath)},title:'UI 패키지 검증',body:'패널 재배치 후 저장 검증'})`,
  );
  assert.match(
    await fs.readFile(path.join(temp, source.relativePath), 'utf8'),
    /패널 재배치 후 저장 검증/,
  );
  const report = {
    version: '0.32.0',
    viewportEmulation: true,
    sizes: [
      [980, 640],
      [1280, 720],
      [1920, 1080],
    ],
    themes: ['light', 'dark'],
    simulatedDeviceScaleFactors: [1.25, 1.5],
    reservedControls: true,
    homeEntryChoices: 3,
    serverInSidebar: true,
    properties: true,
    focusRestore: true,
    realIpcSave: true,
  };
  await fs.writeFile(
    'out/canvas-chrome-packaged/verification.json',
    JSON.stringify(report, null, 2),
  );
  console.log(
    'PASS: final Windows package home, minimum window controls, light/dark, properties, focus restore, collaboration and real IPC save',
  );
} finally {
  ws?.close();
  if (child.exitCode === null) {
    const done = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await done;
  }
  assert.equal(path.dirname(profile), profileRoot);
  assert.ok(
    path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
  await fs.rm(temp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
