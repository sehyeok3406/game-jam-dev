import assert from 'node:assert/strict';
import matter from 'gray-matter';
import { presentationUiScenarios } from './presentation-ui-scenarios.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-presentation-packaged-'),
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
    `---\nid: ${name}\ntitle: 보존할 ${name}\ntype: idea\nx: ${x}\ny: ${y}\nwidth: 340\nheight: 300\ncustom: preserve\n---\n한글 원본 ${name} ${name === 'a' ? '[문서 B](gamejam://document/b)' : '[[project]]'}\n`,
  );
const sectionRaw =
  '---\nid: presentation-section\ntitle: 원래 섹션\ntype: section\nx: 100\ny: 180\nwidth: 600\nheight: 650\ncustom:\n  nested: preserve\nmembers:\n  - id: a\n    path: docs/a.md\n---\n# 사용자 섹션 본문\n\n한글 설명 [[a]] 보존\n';
await fs.mkdir(path.join(game, 'sections'));
await fs.writeFile(path.join(game, 'sections/presentation.md'), sectionRaw);
const originals = await Promise.all(
  ['project.md', 'docs/a.md', 'docs/b.md'].map(async (relative) => [
    relative,
    await fs.readFile(path.join(game, relative), 'utf8'),
  ]),
);
const fileNodesOnly = process.argv.includes('--file-nodes');
const imagePath = 'assets/images/dot.png';
const imageDocument = path.join(game, 'docs', 'picture.md');
const imageBody = `![불러온 이미지](../${imagePath})\n\n## 이미지 용도\n\n게임 에셋\n\n## 설명\n\n초기 설명\n\n원본 이미지: \`${imagePath}\`\n`;
if (fileNodesOnly) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=',
    'base64',
  );
  await fs.mkdir(path.join(game, 'assets', 'images'), { recursive: true });
  await fs.writeFile(path.join(game, imagePath), png);
  await fs.writeFile(
    imageDocument,
    matter.stringify(imageBody, {
      id: 'picture',
      title: '스프라이트',
      type: 'image',
      x: 1100,
      y: 740,
      width: 300,
      height: 220,
      asset: {
        path: imagePath,
        purpose: 'asset',
        originalName: 'dot.png',
        mime: 'image/png',
        bytes: png.length,
      },
    }),
  );
}
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
          : name === 'Enter'
            ? 13
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

async function checkFileNodes() {
  const selector = '[data-id="b"]';
  const compact = `${selector} .file-node-surface`;
  const query = (value) => `document.querySelector(${JSON.stringify(value)})`;
  const extraCanvas = 'qa-node-settings';
  const extraLabel = '노드 설정 검사 탭';
  const sheets = await call('getCanvasSheets');
  await call('changeCanvasSheets', {
    action: 'add',
    id: extraCanvas,
    name: extraLabel,
    expected: sheets.raw ?? null,
  });
  const previousNote = await call('createIdea', {
    canvasId: extraCanvas,
    x: 100,
    y: 200,
  });
  await wait(`${query(compact)}?.innerText.includes('한글 원본 b')`);
  assert.equal(await js(`${query(selector)}.style.width`), '340px');
  assert.match(await js(`${query(compact)}.innerText`), /한글 원본 b/);
  await js(`${query(compact)}.focus()`);
  await key('Enter');
  await wait(`!!${query(selector + ' .file-node-expanded')}`);
  await wait('!!document.querySelector("[data-file-edge=reference]")');
  await js(`${query(selector + ' button[aria-label="접기"]')}.click()`);
  await wait(`!!${query(compact)}`);
  await js(
    `document.activeElement.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'g',code:'KeyG',bubbles:true}))`,
  );
  await wait('!!document.querySelector("[data-file-edge=reference]")');
  await js('window.dispatchEvent(new Event("blur"))');
  await wait('!document.querySelector("[data-file-edge=reference]")');
  await key('G', ['shift']);
  await wait('!!document.querySelector("[data-file-edge=reference]")');
  await key('G', ['shift']);
  await wait('!document.querySelector("[data-file-edge=reference]")');

  const html = '.file-node-surface--html';
  await wait(`!!${query(html)}`);
  await js(`${query(html)}.click()`);
  await wait(
    '!!document.querySelector(".preview-card.file-node-expanded iframe")',
  );
  await js(
    `window.fileNodeQaFrame=document.querySelector('.preview-card iframe');document.querySelector('.preview-card button[aria-label="접기"]').click()`,
  );
  await wait(`!!${query(html)}`);
  await js(`${query(html)}.click()`);
  await wait(
    '!!document.querySelector(".preview-card.file-node-expanded iframe")',
  );
  assert.equal(
    await js(
      'window.fileNodeQaFrame===document.querySelector(".preview-card iframe")',
    ),
    true,
  );
  await js(
    `document.querySelector('.preview-card button[aria-label="접기"]').click()`,
  );

  await js(`${query(compact)}.click()`);
  await wait(`!!${query(selector + ' button[aria-label="접기"]')}`);
  await js(`${query(selector + ' button[aria-label="접기"]')}.click()`);
  const handle = `${selector} .window-resize-handle`;
  await wait(`!!${query(handle)}`);
  const point = await js(
    `(()=>{const r=${query(handle)}.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`,
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  const resized = { x: point.x + 24, y: point.y + 12 };
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...resized,
    button: 'left',
    buttons: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...resized,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await wait(`parseFloat(${query(selector)}.style.width)>340`);
  const resizedWidth = await js(`${query(selector)}.style.width`);

  await pause();
  await js(`document.querySelector('summary[aria-label="더보기"]').click()`);
  await wait(`document.querySelector('.canvas-main-menu')?.open`);
  await wait(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='설정 및 도구')`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='설정 및 도구').click()`,
  );
  await wait(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='노드 모양')`,
  );
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='노드 모양').click()`,
  );
  await wait('!!document.querySelector(".file-node-settings")');
  await js(
    `{const input=document.querySelector('[aria-label="기본 너비"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'420');input.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await wait(
    `document.querySelector('.file-node-settings .file-node-surface').parentElement.style.width==='420px'`,
  );
  assert.equal(await js(`${query(selector)}.style.width`), resizedWidth);
  await js(
    `Array.from(document.querySelectorAll('.file-node-settings button')).find(b=>b.textContent.trim()==='저장').click()`,
  );
  await wait(
    `Array.from(document.querySelectorAll('.file-node-settings button')).some(b=>b.textContent.trim()==='전체 노드에 적용'&&!b.disabled)`,
  );
  await js(
    `Array.from(document.querySelectorAll('.file-node-settings button')).find(b=>b.textContent.trim()==='전체 노드에 적용').click()`,
  );
  await wait(`${query(selector)}.style.width==='420px'`);
  await js(
    `document.querySelector('.file-node-settings button[aria-label="닫기"]').click()`,
  );
  for (const [relative, raw] of originals)
    assert.equal(await fs.readFile(path.join(game, relative), 'utf8'), raw);
  const image = '[data-id="picture"] .asset-node-surface';
  await wait(`!!${query(image + ' img')}?.complete`);
  assert.equal(await js(`${query(image)}.textContent`), '');
  await js(
    `${query(image)}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:600,clientY:300}))`,
  );
  await wait(
    `[...document.querySelectorAll('[role=menuitem]')].some(b=>b.textContent==='에셋 경로 복사')`,
  );
  await wait(
    `[...document.querySelectorAll('[role=menuitem]')].some(b=>b.textContent==='원본 파일 보기')`,
  );
  await key('Escape');
  await js(`${query(image)}.click()`);
  const editor = '[data-id="picture"] .tiptap';
  await wait(`!!${query(editor)}`);
  assert.equal(await js(`${query(editor)}.innerText`), '초기 설명');
  await js(
    `{const e=${query(editor)};e.focus();const range=document.createRange();range.selectNodeContents(e);getSelection().removeAllRanges();getSelection().addRange(range);}`,
  );
  await send('Input.insertText', { text: '저장한 이미지 설명' });
  await js(
    `[...document.querySelectorAll('[data-id=picture] button')].find(b=>b.textContent==='완료').click()`,
  );
  await wait(`!!${query(image)}`);
  const written = matter(await fs.readFile(imageDocument, 'utf8'));
  assert.equal(
    written.content.trimStart(),
    imageBody.replace('초기 설명', '저장한 이미지 설명'),
  );
  assert.equal(written.data.asset.path, imagePath);
  await js(`${query(image)}.click()`);
  await wait(`${query(editor)}?.innerText==='저장한 이미지 설명'`);
  await js(
    `[...document.querySelectorAll('[data-id=picture] button')].find(b=>b.textContent==='완료').click()`,
  );
  await wait(`!!${query(image)}`);
  const extraTab = `[...document.querySelectorAll('[role=tab]')].find(item=>item.textContent.includes(${JSON.stringify(extraLabel)}))`;
  await wait(`!!${extraTab}`);
  await js(`${extraTab}.click()`);
  await wait(
    `${query(`[data-id="${previousNote.id}"]:has(.file-node-surface)`)}?.style.width==='420px'`,
  );
  const newNote = await call('createIdea', {
    canvasId: extraCanvas,
    x: 600,
    y: 200,
  });
  await wait(
    `${query(`[data-id="${newNote.id}"]:has(.file-node-surface)`)}?.style.width==='420px'`,
  );
  await js(
    `[...document.querySelectorAll('[role=tab]')].find(item=>!item.textContent.includes(${JSON.stringify(extraLabel)})).click()`,
  );
  const opened = '[data-id="a"] .file-node-surface';
  await wait(`!!${query(opened)}`);
  await js(`${query(opened)}.click()`);
  await wait('!!document.querySelector(\'[data-id="a"] .file-node-expanded\')');
  console.log(
    'PASS: packaged file nodes open and resize, keep the HTML iframe, draw links, edit image descriptions, and apply saved sizing to all tabs and new nodes',
  );
}
try {
  await boot();
  await enterWorkspace();
  if (fileNodesOnly) {
    await checkFileNodes();
    await stop(true);
    await boot();
    await enterWorkspace();
    await wait(
      `document.querySelector('[data-id="b"]:has(.file-node-surface)')?.style.width==='420px'`,
    );
    await wait(
      '!!document.querySelector(\'[data-id="a"] .file-node-expanded\')',
    );
    console.log(
      'PASS: Windows package restores the collapsed state and size after restart',
    );
  } else {
    const result = await presentationUiScenarios({
      js,
      key,
      wait,
      pointer: async (type, point) => {
        await send('Input.dispatchMouseEvent', {
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
      },
      screenshot: async (name) => {
        const shot = await send('Page.captureScreenshot');
        await fs.mkdir('out/presentation-actions-packaged', {
          recursive: true,
        });
        await fs.writeFile(
          `out/presentation-actions-packaged/${name}.png`,
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
    const sectionAfter = matter(
      await fs.readFile(path.join(game, result.sectionPath), 'utf8'),
    );
    assert.equal(sectionAfter.content, matter(sectionRaw).content);
    assert.deepEqual(sectionAfter.data.custom, { nested: 'preserve' });
    assert.equal(sectionAfter.data.title, '한글 새 섹션');
    assert.deepEqual(
      sectionAfter.data.members,
      matter(sectionRaw).data.members,
    );
    await stop(true);
    await boot();
    await enterWorkspace();
    assert.equal((await call('listDocuments')).length, before.length);
    await wait(
      `!!document.querySelector('[data-id="section:${result.sectionId}"] .section-card--collapsed')`,
    );
    assert.equal(
      (await call('listSections')).find((s) => s.id === result.sectionId).title,
      '한글 새 섹션',
    );
    assert.equal((await call('listHistory')).length, historyBefore);
    const sectionsAfter = await call('listSections');
    assert.deepEqual(
      sectionsAfter.map((s) => [s.id, s.members]),
      sectionsBefore.map((s) => [s.id, s.members]),
    );
    assert.ok(
      !(await js(
        '!!document.querySelector("[data-ui-id=section-rename],[data-ui-id=section-action],[data-ui-id=membership],[data-ui-id=section-create]")',
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
      'PASS: real Windows package preserves renamed section body/custom metadata, personal collapse, original document bodies and native history across full restart',
    );
  }
} catch (error) {
  console.error(
    'Presentation UI failure state:',
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
