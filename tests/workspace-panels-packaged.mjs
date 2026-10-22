import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-panels-packaged-'),
);
const profileId = randomUUID(),
  profile = path.join(
    process.env.APPDATA,
    'Game Canvas',
    'test-users',
    profileId,
  ),
  game = path.join(root, 'game');
await fs.mkdir(game, { recursive: true });
await fs.writeFile(
  path.join(game, 'project.md'),
  '---\nid: project\ntitle: original\nproject_name: original\ncustom: preserve\n---\n# 원본 한글 내용\n',
);
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, 'local-projects.json'),
  JSON.stringify([
    {
      id: 'local:' + game.toLowerCase(),
      root: game,
      name: '프로젝트 홈 패키지 검사',
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
const button = (text) =>
  `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)}))`;
async function clickText(text) {
  await js(`{const button=${button(text)}; button.focus();button.click();}`);
}
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
}
const escape = () => key('Escape', 'Escape', 27);
const original = await fs.readFile(path.join(game, 'project.md'), 'utf8');
try {
  await boot();
  await js(`${button('초대 코드로 참여')}.dataset.qaTrigger='join'`);
  await clickText('초대 코드로 참여');
  await wait(
    '!!document.querySelector(".collaboration-dialog") && document.querySelector(".collaboration-dialog").contains(document.activeElement)',
  );
  // Opening the same production update action behind a dialog reproduces the
  // automatic prompt overlap without a network check or installing an update.
  await js(`${button('앱 업데이트')}.click()`);
  await wait('!!document.querySelector(".update-dialog")');
  assert.ok(
    await js(
      'document.querySelector(".collaboration-dialog").contains(document.activeElement)',
    ),
  );
  await js(
    `{const controls=[...document.querySelectorAll('.collaboration-dialog input,.collaboration-dialog button')].filter(e=>!e.disabled&&e.getClientRects().length);controls.at(-1).focus();}`,
  );
  await key('Tab', 'Tab', 9);
  assert.ok(
    await js(
      'document.querySelector(".collaboration-dialog").contains(document.activeElement)',
    ),
  );
  await escape();
  await wait(
    '!document.querySelector(".collaboration-dialog") && !!document.querySelector(".update-dialog")',
  );
  assert.ok(
    await js(
      'document.querySelector(".update-dialog").contains(document.activeElement)',
    ),
  );
  await escape();
  await wait('!document.querySelector(".update-dialog")');
  assert.equal(await js('document.activeElement.dataset.qaTrigger'), 'join');
  console.log(
    'PASS: real Windows package management dialogs preserve CSS order, Tab containment, one Escape per dialog and home trigger restoration',
  );
  for (let turn = 0; turn < 3; turn++) {
    await js('document.querySelector(".home-project-open").click()');
    await wait('!!document.querySelector("[data-plugin-launcher]")');
    await key('k', 'KeyK', 75, 2);
    await wait('!!document.querySelector(".command-palette")');
    await escape();
    await wait('!document.querySelector(".command-palette")');
    await js('document.querySelector("[data-plugin-launcher]").click()');
    await wait('!!document.querySelector(".builtin-feature-open")');
    await js(
      `Array.from(document.querySelectorAll('.builtin-feature-open')).find(e=>e.textContent.includes('칸반')).click()`,
    );
    await wait(
      '!!document.querySelector(".plugin-control-panel .kanban-controls") || document.querySelector(".plugin-control-panel").textContent.includes("상태 옵션")',
    );
    await js(
      `{const toggle=document.querySelector('[aria-label="칸반 보드 활성화"]');if(!toggle.checked)toggle.click();}`,
    );
    await wait(
      `!!Array.from(document.querySelectorAll('.plugin-control-panel button')).find(b=>b.textContent.includes('상태 옵션')&&!b.disabled)`,
    );
    await js(
      `{const b=[...document.querySelectorAll('.plugin-control-panel button')].find(e=>e.textContent.includes('상태 옵션'));b.focus();b.click();}`,
    );
    await wait('!!document.querySelector(".workflow-manager")');
    await escape();
    await wait('!document.querySelector(".workflow-manager")');
    assert.ok(
      await js(
        'document.querySelector(".plugin-control-panel").contains(document.activeElement)',
      ),
    );
    await js(
      `document.querySelector('[aria-label="플러그인 패널 닫기"]').click()`,
    );
    await js(
      `document.querySelector('[title="프로젝트 홈으로 돌아가기"]').click()`,
    );
    await wait('!!document.querySelector(".home-project-open")');
  }
  assert.equal(
    await fs.readFile(path.join(game, 'project.md'), 'utf8'),
    original,
  );
  console.log(
    'PASS: package home/workspace round trips preserve command/plugin/status modal close and focus without changing project content',
  );
  await stop(true);
  await boot();
  await js(
    `document.querySelector('[title="프로젝트 홈으로 돌아가기"]')?.click()`,
  );
  await wait('!!document.querySelector(".home-project-open")');
  assert.equal(
    await fs.readFile(path.join(game, 'project.md'), 'utf8'),
    original,
  );
  await clickText('초대 코드로 참여');
  await wait('!!document.querySelector(".collaboration-dialog")');
  await escape();
  await wait('!document.querySelector(".collaboration-dialog")');
  console.log(
    'PASS: complete process restart retains the project and management dialog lifecycle',
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
