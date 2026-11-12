import assert from 'node:assert/strict';
import matter from 'gray-matter';
import { sectionUiScenarios } from './section-ui-scenarios.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-sections-packaged-'),
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
    if (m.method === 'Runtime.exceptionThrown')
      console.error(
        'Renderer exception:',
        m.params.exceptionDetails.exception?.description ??
          m.params.exceptionDetails.text,
      );
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
  await send('Runtime.enable');
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
const call = (method, ...args) =>
  js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
const pointer = (type, point) =>
  send('Input.dispatchMouseEvent', {
    type:
      type === 'mouseDown'
        ? 'mousePressed'
        : type === 'mouseUp'
          ? 'mouseReleased'
          : 'mouseMoved',
    ...point,
    button: 'left',
    buttons: type === 'mouseUp' ? 0 : 1,
    clickCount: 1,
  });
await fs.mkdir(path.join(game, 'docs'));
await fs.mkdir(path.join(game, 'output'));
await fs.writeFile(
  path.join(game, 'output/index.html'),
  '<!doctype html><html lang="ko"><body>보존할 HTML</body></html>',
);
for (const [name, x, y] of [
  ['a', 200, 300],
  ['b', 650, 420],
])
  await fs.writeFile(
    path.join(game, 'docs', name + '.md'),
    `---\nid: ${name}\ntitle: 보존할 ${name}\ntype: idea\nx: ${x}\ny: ${y}\nwidth: 340\nheight: 300\ncustom: preserve\n---\n한글 원본 ${name} [[project]]\n`,
  );
const originals = await Promise.all(
  ['project.md', 'docs/a.md', 'docs/b.md'].map(async (relative) => [
    relative,
    await fs.readFile(path.join(game, relative), 'utf8'),
  ]),
);
async function key(name, modifiers = []) {
  const code =
      name.length === 1
        ? /\d/.test(name)
          ? 'Digit' + name
          : 'Key' + name.toUpperCase()
        : name,
    value = name.length === 1 ? name.toLowerCase() : name;
  const windowsVirtualKeyCode =
    name.length === 1
      ? name.toUpperCase().charCodeAt(0)
      : name === 'Delete'
        ? 46
        : name === 'Escape'
          ? 27
          : 9;
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key: value,
      code,
      windowsVirtualKeyCode,
      modifiers:
        (modifiers.includes('control') ? 2 : 0) |
        (modifiers.includes('shift') ? 8 : 0),
    });
}
async function enterWorkspace() {
  // Startup can replace the home card between two CDP calls. Observe readiness
  // and click in the same browser task; never silently skip a missing card.
  await wait(
    `(()=>{if(document.querySelector('[data-plugin-launcher]'))return true;const button=document.querySelector('.home-project-open');if(!button||button.disabled)return false;button.click();return true;})()`,
  );
  await wait('!!document.querySelector("[data-plugin-launcher]")');
}
async function sectionMenu(section, label, dialog) {
  const header = `[data-id="section:${section.id}"] .section-card__header`;
  await wait(`!!document.querySelector(${JSON.stringify(header)})`);
  await js(`{
    const node = document.querySelector(${JSON.stringify(header)});
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.x + 24, clientY: rect.y + 12 }));
  }`);
  await wait('!!document.querySelector("[data-ui-id=section-menu]")');
  await js(
    `Array.from(document.querySelectorAll('[data-ui-id=section-menu] button')).find(button => button.textContent.includes(${JSON.stringify(label)})).click()`,
  );
  await wait(`!!document.querySelector('[data-ui-id=${dialog}]')`);
}
async function addChild(parent) {
  await sectionMenu(parent, '하위 섹션 만들기', 'section-create');
  await js(
    "document.querySelector('[data-ui-id=section-create] .button-primary').click()",
  );
  await wait('!document.querySelector("[data-ui-id=section-create]")');
  const child = (await call('listSections')).find(
    (section) => section.parentSectionId === parent.id,
  );
  assert.ok(child);
  assert.equal(child.members.length, 0);
  return child;
}
async function dragToParent(leaf, parent) {
  const root = (await call('listSections')).find(
    (section) => section.id === parent.id,
  );
  const leafHeader = `[data-id="section:${leaf.id}"] .section-card__header`;
  await key('1', ['shift']);
  await pause();
  const geometry = await js(`(() => {
    const header = document.querySelector(${JSON.stringify(leafHeader)});
    const child = header.getBoundingClientRect();
    const root = document.querySelector('[data-id="section:${root.id}"]').getBoundingClientRect();
    const y = child.y + child.height / 2;
    const x = [.57, .36, .7, .2].map(fraction => child.x + child.width * fraction).find(value => {
      const target = document.elementFromPoint(value, y);
      return header.contains(target) && !target.closest('button');
    });
    return { x, y, scale: root.width / ${root.width} };
  })()`);
  assert.ok(
    Number.isFinite(geometry.x),
    'A visible part of the nested section header must receive pointer input',
  );
  const dx = (root.x + 18 - (leaf.x + leaf.width / 2)) * geometry.scale;
  await pointer('mouseDown', {
    x: Math.round(geometry.x),
    y: Math.round(geometry.y),
  });
  for (let step = 1; step <= 14; step++) {
    await pointer('mouseMove', {
      x: Math.round(geometry.x + (dx * step) / 14),
      y: Math.round(geometry.y),
    });
    await new Promise((resolve) => setTimeout(resolve, 23));
  }
  await pointer('mouseUp', {
    x: Math.round(geometry.x + dx),
    y: Math.round(geometry.y),
  });
  await wait('!!document.querySelector("[data-ui-id=membership]")');
  assert.ok(
    await js(
      `document.querySelector('#membership-dialog-description')?.textContent.includes(${JSON.stringify(leaf.title)})`,
    ),
  );
}
try {
  await boot();
  await enterWorkspace();
  const result = process.argv.includes('--nested-only')
    ? await (async () => {
        const doc = (await call('listDocuments')).find(
          (item) => item.id === 'a',
        );
        const section = await call('createSection', {
          title: '상위 섹션',
          members: [{ id: doc.id, path: doc.relativePath }],
          x: 120,
          y: 200,
          width: 620,
          height: 500,
        });
        return { sectionId: section.id, documentId: doc.id };
      })()
    : await sectionUiScenarios({
        js,
        key,
        wait,
        pointer,
        screenshot: async (name) => {
          const shot = await send('Page.captureScreenshot');
          await fs.mkdir('out/section-actions-packaged', { recursive: true });
          await fs.writeFile(
            `out/section-actions-packaged/${name}.png`,
            Buffer.from(shot.data, 'base64'),
          );
        },
      });
  for (const [relative, raw] of originals) {
    const current = matter(
        await fs.readFile(path.join(game, relative), 'utf8'),
      ),
      original = matter(raw);
    assert.equal(current.content, original.content);
    assert.equal(current.data.custom, original.data.custom);
  }
  const before = await call('listDocuments');
  const sectionsBefore = await call('listSections');
  const historyBefore = (await call('listHistory')).length;
  assert.ok(
    sectionsBefore
      .find((s) => s.id === result.sectionId)
      .members.some((m) => m.id === result.documentId),
  );
  const parent = sectionsBefore.find(
    (section) => section.id === result.sectionId,
  );
  const childSection = await addChild(parent);
  const leaf = await addChild(childSection);
  const parentToggle = `[data-id="section:${parent.id}"] .section-card__file button[aria-expanded]`;
  const leafNode = `[data-id="section:${leaf.id}"]`;
  const leafHidden = `document.querySelector(${JSON.stringify(leafNode)})?.classList.contains('section-member-hidden')`;
  await wait(`!!document.querySelector(${JSON.stringify(leafNode)})`);
  await js(`document.querySelector(${JSON.stringify(parentToggle)}).click()`);
  await wait(leafHidden);
  await js(`document.querySelector(${JSON.stringify(parentToggle)}).click()`);
  await wait(`!(${leafHidden})`);
  await dragToParent(leaf, parent);
  await key('Escape');
  await wait('!document.querySelector("[data-ui-id=membership]")');
  assert.equal(
    (await call('listSections')).find((section) => section.id === leaf.id)
      .parentSectionId,
    childSection.id,
  );
  await dragToParent(leaf, parent);
  await js(
    "document.querySelector('[data-ui-id=membership] .button-primary').click()",
  );
  await wait('!document.querySelector("[data-ui-id=membership]")');
  assert.equal(
    (await call('listSections')).find((section) => section.id === leaf.id)
      .parentSectionId,
    parent.id,
  );
  await call('undo');
  await wait(
    `window.gameCanvas.listSections().then(s => s.some(v => v.id === ${JSON.stringify(leaf.id)} && v.parentSectionId === ${JSON.stringify(childSection.id)}))`,
  );
  await wait(
    `document.querySelector('[data-id="section:${childSection.id}"] .section-card__title')?.textContent.includes('하위 1개')`,
  );
  await sectionMenu(childSection, '섹션 해제', 'section-action');
  await js(
    "document.querySelector('[data-ui-id=section-action] .button-primary').click()",
  );
  await wait('!document.querySelector("[data-ui-id=section-action]")');
  assert.equal(
    (await call('listSections')).find((section) => section.id === leaf.id)
      .parentSectionId,
    parent.id,
  );
  await call('undo');
  await wait(
    `window.gameCanvas.listSections().then(s => s.some(v => v.id === ${JSON.stringify(childSection.id)}))`,
  );
  await sectionMenu(childSection, '섹션과 파일 삭제', 'section-action');
  assert.ok(
    await js(
      "document.querySelector('[aria-label=\"삭제 대상\"]')?.textContent.includes('섹션')",
    ),
  );
  await js(
    "document.querySelector('[data-ui-id=section-action] .button-danger').click()",
  );
  await wait('!document.querySelector("[data-ui-id=section-action]")');
  assert.ok(
    !(await call('listSections')).some((section) => section.id === leaf.id),
  );
  await call('undo');
  await wait(
    `window.gameCanvas.listSections().then(s => s.some(v => v.id === ${JSON.stringify(leaf.id)}))`,
  );
  const nestedBefore = await call('listSections');
  const nestedHistory = (await call('listHistory')).length;
  await stop(true);
  await boot();
  await enterWorkspace();
  assert.equal((await call('listDocuments')).length, before.length);
  assert.ok(nestedHistory > historyBefore);
  assert.equal((await call('listHistory')).length, nestedHistory);
  const sectionsAfter = await call('listSections');
  assert.deepEqual(
    sectionsAfter.map((s) => [s.id, s.parentSectionId, s.members]),
    nestedBefore.map((s) => [s.id, s.parentSectionId, s.members]),
  );
  assert.ok(
    !(await js(
      '!!document.querySelector("[data-ui-id=section-action],[data-ui-id=membership],[data-ui-id=section-create]")',
    )),
  );
  assert.ok(
    !(await js('!!document.querySelector("[data-ui-id=delete-many]")')),
  );
  for (const [relative, raw] of originals) {
    const current = matter(
        await fs.readFile(path.join(game, relative), 'utf8'),
      ),
      original = matter(raw);
    assert.equal(current.content, original.content);
    assert.equal(current.data.custom, original.data.custom);
  }
  console.log(
    'PASS: real Windows package preserves original Markdown bodies/custom metadata, section memberships and history across full restart',
  );
} catch (error) {
  console.error(
    'Project entry failure details:',
    await js(
      `(async()=>({title:document.title,body:document.body.innerText.slice(-6000),homeButton:document.querySelector('.home-project-open')?.disabled,workspace:await window.gameCanvas.getWorkspace()}))()`,
    ).catch((reason) => String(reason)),
  );
  console.error(
    'Section UI failure state:',
    await js(
      `({notice:document.querySelector('.status-toast')?.textContent,dialog:document.querySelector('[aria-modal=true]')?.textContent,disabled:document.querySelector('[data-ui-id=membership] .button-primary')?.disabled,undoDisabled:document.querySelector('button[title^="실행 취소"]')?.disabled,selected:[...document.querySelectorAll('.react-flow__node.selected')].map(node=>node.dataset.id)})`,
    ).catch(() => undefined),
  );
  throw error;
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
