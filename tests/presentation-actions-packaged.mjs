import assert from 'node:assert/strict';
import matter from 'gray-matter';
import { presentationUiScenarios } from './presentation-ui-scenarios.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { locationLinkHref } from '../src/core/projects/location-links.ts';
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
async function boot(href) {
  const debugPort = await port();
  child = spawn(
    path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe'),
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${debugPort}`,
      ...(href ? [href] : []),
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
  const running = () =>
    child && child.exitCode === null && child.signalCode === null;
  if (graceful && running()) {
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
  if (running()) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  child = null;
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
const imagePath = 'assets/images/wide.png';
const imageDocument = path.join(game, 'docs', 'picture.md');
const imageBody = `![불러온 이미지](../${imagePath})\n\n## 이미지 용도\n\n게임 에셋\n\n## 설명\n\n초기 설명\n\n원본 이미지: \`${imagePath}\`\n`;
const recoveredDescription = '복원한 이미지 설명 초안';
const wideImage =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAECAYAAAC6Jt6KAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAUSURBVBhXY2AgB8hN+P+fWEx7DQBvzVgtcyg/0wAAAABJRU5ErkJggg==';
const tallImage =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAMCAYAAABFohwTAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAUSURBVBhXY2DABuQm/P8Pw0NHAABTrlgt0bibAQAAAABJRU5ErkJggg==';
if (fileNodesOnly) {
  const fixtures = [
    ['picture', imagePath, '스프라이트', 1100, wideImage],
    ['portrait', 'assets/images/tall.png', '세로형', 1320, tallImage],
  ];
  await fs.mkdir(path.join(game, 'assets', 'images'), { recursive: true });
  for (const [id, asset, title, x, bytes] of fixtures) {
    const png = Buffer.from(bytes, 'base64');
    await fs.writeFile(path.join(game, asset), png);
    await fs.writeFile(
      path.join(game, 'docs', id + '.md'),
      matter.stringify(imageBody.replaceAll(imagePath, asset), {
        id,
        title,
        type: 'image',
        x,
        y: 740,
        width: 180,
        height: 160,
        asset: {
          path: asset,
          purpose: 'asset',
          originalName: path.basename(asset),
          mime: 'image/png',
          bytes: png.length,
        },
      }),
    );
  }
  const neighbor = 'same-section';
  await fs.writeFile(
    path.join(game, 'docs', neighbor + '.md'),
    matter.stringify('같은 섹션의 접힌 문서', {
      id: neighbor,
      title: '같은 섹션',
      type: 'idea',
      x: 565,
      y: 365,
      width: 340,
      height: 300,
    }),
  );
  const section = matter(sectionRaw);
  const sections = path.join(game, 'sections');
  await fs.writeFile(
    path.join(sections, 'presentation.md'),
    matter.stringify(section.content, {
      ...section.data,
      members: [
        ...section.data.members,
        { id: neighbor, path: `docs/${neighbor}.md` },
      ],
    }),
  );
  await fs.writeFile(
    path.join(sections, 'second.md'),
    matter.stringify('', {
      id: 'presentation-second',
      title: '다른 섹션',
      type: 'section',
      x: 622,
      y: 390,
      width: 500,
      height: 380,
      members: [{ id: 'b', path: 'docs/b.md' }],
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

async function checkExpandedOrder() {
  const a = '[data-id="a"]',
    b = '[data-id="b"]';
  const query = (selector) =>
    `document.querySelector(${JSON.stringify(selector)})`;
  const intersection = (other) =>
    `(()=>{const a=${query(a)}.getBoundingClientRect(),b=${query(other)}.getBoundingClientRect();const l=Math.max(a.left,b.left),r=Math.min(a.right,b.right),t=Math.max(a.top,b.top),d=Math.min(a.bottom,b.bottom);return r-l>8&&d-t>8?{x:(l+r)/2,y:(t+d)/2}:null;})()`;
  const hit = (point) =>
    `(()=>{const p=${point};return p&&document.elementFromPoint(p.x,p.y)?.closest('.react-flow__node')?.dataset.id;})()`;
  const otherSection = intersection(b);
  const sameSection = intersection('[data-id="same-section"]');
  const handle = a + ' .window-resize-handle.bottom.right';
  await wait(`!!${query(a + ' .file-node-surface')}`);
  await js(`${query(a + ' .file-node-surface')}.click()`);
  await wait(`!!${query(handle)}`);
  const { point, distance } = await js(
    `(()=>{const h=${query(handle)}.getBoundingClientRect(),a=${query(a)}.getBoundingClientRect(),b=${query(b)}.getBoundingClientRect();return {point:{x:Math.round(h.x+h.width/2),y:Math.round(h.y+h.height/2)},distance:Math.ceil(b.left-a.right+b.width/4)};})()`,
  );
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  const end = { x: point.x + distance, y: point.y };
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    ...end,
    button: 'left',
    buttons: 1,
  });
  await wait(`${hit(otherSection)}==='a'&&${hit(sameSection)}==='a'`);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...end,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await wait(
    `window.gameCanvas.getDocument('docs/a.md').then(doc=>doc.width>500)`,
  );
  await wait(`${hit(otherSection)}==='a'&&${hit(sameSection)}==='a'`);

  const preview = '.react-flow__node-preview';
  const layer = (selector) =>
    `Number(getComputedStyle(${query(selector)}).zIndex)`;
  await js(`${query(preview + ' .file-node-surface')}.click()`);
  await wait(`${layer(preview)}>${layer(a)}`);
  await js(`${query(a + ' .document-card__header')}.click()`);
  await wait(`${layer(a)}>${layer(preview)}`);
  await js(`${query(preview + ' button[aria-label="접기"]')}.click()`);

  await js(`${query(b + ' .file-node-surface')}.click()`);
  await wait(`${hit(otherSection)}==='b'`);
  await js(`${query(a + ' .document-card__header')}.click()`);
  await wait(`${hit(otherSection)}==='a'`);
  await js(
    `{const p=${otherSection};document.elementFromPoint(p.x,p.y).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,altKey:true,clientX:p.x,clientY:p.y}));}`,
  );
  await wait(
    `document.querySelector('.drawing-overlap-menu [role=menuitem]')?.textContent.startsWith('보존할 a')`,
  );
  await key('Escape');
  await js(`${query(a + ' button[aria-label="접기"]')}.click()`);
  await wait(`!!${query(a + ' .file-node-surface')}`);
  await js(`${query(b + ' button[aria-label="접기"]')}.click()`);
  await wait(`!!${query(b + ' .file-node-surface')}`);
  await js(`${query(a + ' .file-node-surface')}.click()`);
  await wait(`!!${query(a + ' .file-node-expanded')}`);
}

async function canvasPointer(type, point, modifiers = 0) {
  await send('Input.dispatchMouseEvent', {
    type,
    ...point,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    modifiers,
  });
}

async function clickAt(point, modifiers = 0) {
  await canvasPointer('mousePressed', point, modifiers);
  await canvasPointer('mouseReleased', point, modifiers);
}

async function dragTo(start, end) {
  await canvasPointer('mousePressed', start);
  await canvasPointer('mouseMoved', {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  });
  await canvasPointer('mouseMoved', end);
  await canvasPointer('mouseReleased', end);
}

const nodeQuery = (id) => `document.querySelector('[data-id="${id}"]')`;
const center = (selector) =>
  js(
    `(()=>{const r=${selector}.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );

async function clearCanvasSelection() {
  const blank = await js(
    `(()=>{const r=document.querySelector('.react-flow').getBoundingClientRect();for(let y=r.top+80;y<r.bottom-90;y+=60)for(let x=r.left+120;x<r.right-180;x+=70)if(document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'))return {x,y};})()`,
  );
  assert.ok(blank, 'a blank point in the canvas');
  await clickAt(blank);
  await wait(`!document.querySelector('.react-flow__node.selected')`);
}

async function zoomAt(id, zoom) {
  const scale = `new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a`;
  await js(
    `(()=>{const r=document.querySelector('[data-id="${id}"]').getBoundingClientRect();document.querySelector('.react-flow__pane').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,deltaY:Math.log2(${zoom}/(${scale}))/-0.002}));})()`,
  );
  await wait(`Math.abs((${scale})-${zoom})<0.001`);
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function checkImageBounds(id, axis, gap = 15) {
  const node = nodeQuery(id);
  const image = `${node}.querySelector('.asset-node-fitted img')`;
  await js(`${node}.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, button: 2, clientX: 240, clientY: 200,
  }))`);
  await wait(`${node}.classList.contains('selected')`);
  await key('Escape');
  await js(`[...document.querySelectorAll('.canvas-zoom-menu button')]
    .find(button => button.textContent.trim() === '선택 항목 맞춤').click()`);
  await pause();
  for (const zoom of [0.57, 1]) {
    await zoomAt(id, zoom);
    await wait(`!!${image}?.naturalWidth`);
    await clearCanvasSelection();
    const margin = await js(`(() => {
      const r = ${image}.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const points = ${
        axis === 'x'
          ? `[{x:r.left-${gap}, y}, {x:r.right+${gap}, y}]`
          : `[{x, y:r.top-${gap}}, {x, y:r.bottom+${gap}}]`
      };
      return points.find(({x,y}) => document.elementFromPoint(x,y)?.classList.contains('react-flow__pane'));
    })()`);
    assert.ok(
      margin,
      `${id} has an exposed canvas point in the former margin at ${zoom}`,
    );
    await clickAt(margin);
    await wait(`!${node}.classList.contains('selected')`);
    const inside = await center(image);
    const target = await js(`(() => {
      const element = document.elementFromPoint(${inside.x}, ${inside.y});
      return {
        id: element?.closest('[data-id]')?.dataset.id,
        tag: element?.className,
        window: {width: innerWidth, height: innerHeight},
      };
    })()`);
    assert.equal(target.id, id, JSON.stringify({ zoom, inside, target }));
    await clickAt(inside, 8);
    await wait(`${node}.querySelectorAll('.window-resize-handle').length===4`);
    assert.equal(
      await js(
        `(()=>{const r=${image}.getBoundingClientRect(),n=${node}.getBoundingClientRect();return ['left','right','top','bottom'].every(side=>Math.abs(r[side]-n[side])<=1)&&[...${node}.querySelectorAll('.window-resize-handle')].every(handle=>{const b=handle.getBoundingClientRect(),x=handle.classList.contains('left')?r.left:r.right,y=handle.classList.contains('top')?r.top:r.bottom;return Math.abs(x-b.x-b.width/2)<=1&&Math.abs(y-b.y-b.height/2)<=1;});})()`,
      ),
      true,
      `${id} bounds and handles at ${zoom}`,
    );
  }
  await zoomAt(id, 0.57);
}

async function resizeImage(id, dx, dy) {
  const node = nodeQuery(id);
  await wait(`!!${node}.querySelector('.window-resize-handle')`);
  const handle = await js(`(() => {
    for (const element of ${node}.querySelectorAll('.window-resize-handle')) {
      const r = element.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2);
      const y = Math.round(r.y + r.height / 2);
      if (document.elementFromPoint(x, y) === element) return {
        x, y, left: element.classList.contains('left'), top: element.classList.contains('top'),
      };
    }
  })()`);
  assert.ok(handle, `${id} has a visible resize handle`);
  const start = { x: handle.x, y: handle.y };
  const end = {
    x: start.x + (handle.left ? -dx : dx),
    y: start.y + (handle.top ? -dy : dy),
  };
  const width = await js(`parseFloat(${node}.style.width)`);
  await canvasPointer('mousePressed', start);
  await canvasPointer('mouseMoved', end);
  const during = await js(`parseFloat(${node}.style.width)`);
  await canvasPointer('mouseReleased', end);
  assert.ok(
    during > width,
    `${id} resized during the gesture from ${width} to ${during}`,
  );
}

async function importTestImage(name, base64, x, y) {
  const [image] = await js(
    `(async()=>{const workspace=await window.gameCanvas.getWorkspace();return window.gameCanvas.importFiles({
      x:${x},y:${y},imagePurpose:'asset',scope:workspace.saveScope,contextId:workspace.clipboardContextId,
      files:[{name:${JSON.stringify(name)},bytes:Uint8Array.from(atob(${JSON.stringify(base64)}),value=>value.charCodeAt(0))}],
    });})()`,
  );
  return image;
}

async function checkImageOperations(square) {
  await resizeImage(square.id, 25, 25);
  await wait(
    `window.gameCanvas.getDocument(${JSON.stringify(square.relativePath)}).then(doc=>doc.width>360&&doc.height>320)`,
  );
  await js(
    `document.querySelector('button[aria-label="캔버스 전체 맞춤"]').click()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  await clearCanvasSelection();
  for (const id of ['picture', 'portrait'])
    await clickAt(await center(nodeQuery(id)), 8);
  await wait(
    `document.querySelectorAll('.react-flow__node.selected').length===2`,
  );
  await resizeImage('picture', 24, 8);
  await wait(
    `Promise.all(['picture','portrait'].map(id=>window.gameCanvas.getDocument('docs/'+id+'.md'))).then(([a,b])=>a.width>180&&b.height>160)`,
  );
  assert.equal(
    await js(
      `(()=>{const a=${nodeQuery('picture')}.getBoundingClientRect(),b=${nodeQuery('portrait')}.getBoundingClientRect();return Math.abs(a.width-3*a.height)<=1&&Math.abs(b.height-3*b.width)<=1;})()`,
    ),
    true,
  );
  await js(
    `document.querySelector('button[title^="실행 취소"]:not(:disabled)').click()`,
  );
  await wait(
    `Promise.all(['picture','portrait'].map(id=>window.gameCanvas.getDocument('docs/'+id+'.md'))).then(docs=>docs.every(doc=>doc.width===180&&doc.height===160))`,
  );
  await clearCanvasSelection();
  for (const id of ['picture', 'portrait'])
    await clickAt(await center(nodeQuery(id)), 8);
  await wait(`!!document.querySelector('.selection-arrange-menu summary')`);
  await js(
    `document.querySelector('.selection-arrange-menu summary').click();[...document.querySelectorAll('.selection-arrange-menu button')].find(button=>button.textContent.trim()==='위쪽 맞춤').click();`,
  );
  await wait(
    `Math.abs(${nodeQuery('picture')}.getBoundingClientRect().top-${nodeQuery('portrait')}.getBoundingClientRect().top)<=1`,
  );
  await clearCanvasSelection();
  const section = nodeQuery('section:presentation-second');
  const target = await js(
    `(()=>{const r=${section}.getBoundingClientRect();return {x:r.right-28,y:r.bottom-25};})()`,
  );
  await dragTo(await center(nodeQuery('picture')), target);
  await wait(
    `!!document.querySelector('[data-ui-id=membership] .button-primary')`,
  );
  await js(
    `document.querySelector('[data-ui-id=membership] .button-primary').click()`,
  );
  await wait(`!document.querySelector('[data-ui-id=membership]')`);
  const savedSection = matter(
    await fs.readFile(path.join(game, 'sections/second.md'), 'utf8'),
  );
  assert.ok(
    savedSection.data.members.some((member) => member.id === 'picture'),
  );
  const saved = await call('getDocument', 'docs/picture.md');
  assert.deepEqual([saved.width, saved.height], [180, 160]);
  console.log(
    'PASS: single and mixed image resize, undo, visual alignment and section movement save through document layouts',
  );
}

async function checkSharedImage() {
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'image-layout-server'),
    port: 0,
    creationKey: 'image-layout',
  });
  try {
    const pendingPng = await js(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 21;
      canvas.height = 7;
      canvas.getContext('2d').fillRect(0, 0, 10, 7);
      const data = canvas.toDataURL();
      const decode = Image.prototype.decode;
      Image.prototype.decode = function () {
        if (this.src !== data) return decode.call(this);
        Image.prototype.decode = decode;
        return decode.call(this).then(() => new Promise(resolve => {
          window.releaseTestImageDecode = resolve;
        }));
      };
      return data.split(',')[1];
    })()`);
    const pending = await importTestImage(
      '지연 이미지.png',
      pendingPng,
      520,
      160,
    );
    const pendingNode = nodeQuery(pending.id);
    await wait(`!!${pendingNode}?.querySelector('.asset-node-surface')`);
    await js(
      `${pendingNode}.querySelector('.asset-node-surface').focus({preventScroll:true})`,
    );
    await wait('typeof window.releaseTestImageDecode === "function"');
    const serverUrl = `http://127.0.0.1:${server.port}`;
    const sharedPath = 'docs/picture.md';
    const original = matter(await fs.readFile(imageDocument, 'utf8'));
    const owner = await CollaborationClient.create(
      serverUrl,
      'image-layout',
      '레이아웃 관리자',
      '공동 이미지 검사',
      {
        'project.md': '# 공동 이미지 검사\n',
        [sharedPath]: matter.stringify(original.content, {
          ...original.data,
          x: 240,
          y: 240,
        }),
        [imagePath]: `data:image/png;base64,${wideImage}`,
        'docs/지연 이미지.md': matter.stringify('공동 프로젝트 이미지', {
          id: pending.id,
          title: pending.title,
          type: 'image',
          x: 520,
          y: 160,
          width: 360,
          height: 320,
          asset: {
            ...pending.asset,
            bytes: Buffer.from(tallImage, 'base64').length,
          },
        }),
        [pending.asset.path]: `data:image/png;base64,${tallImage}`,
      },
    );
    await call('joinCollaboration', {
      serverUrl,
      code: owner.result.code,
      nickname: '레이아웃 검증 참여자',
    });
    const tallBounds = `(() => {
      const node = ${pendingNode};
      return node?.querySelector('.asset-node-fitted img')?.naturalWidth === 4 &&
        Math.abs(parseFloat(node.style.width) * 3 - parseFloat(node.style.height)) < 0.1;
    })()`;
    await wait(tallBounds);
    await js(
      'window.releaseTestImageDecode(); delete window.releaseTestImageDecode;',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    await wait(tallBounds);
    console.log(
      'PASS: a delayed local image decode cannot replace the shared project image bounds',
    );
    const href = locationLinkHref({
      version: 1,
      projectId: owner.credentials.projectId,
      target: { kind: 'document', id: 'picture' },
    });
    await stop(true);
    await boot(href);
    const picture = nodeQuery('picture');
    await wait(`!!${picture}?.querySelector('.asset-node-fitted img')`);
    await wait(`${picture}.classList.contains('selected')`);
    await pause();
    await resizeImage('picture', 30, 10);
    await wait(
      `window.gameCanvas.getDocument('${sharedPath}').then(doc=>doc.width>180)`,
    );
    await pause();
    const beforeMove = await call('getDocument', sharedPath);
    const point = await center(picture);
    await dragTo(point, { x: point.x + 45, y: point.y + 22 });
    await wait(
      `window.gameCanvas.getDocument('${sharedPath}').then(doc=>doc.x>${beforeMove.x})`,
    );
    const { x, y, width, height } = await call('getDocument', sharedPath);
    const ownerClient = new CollaborationClient(owner.credentials, () => {});
    try {
      await ownerClient.refresh();
      const saved = matter(ownerClient.files[sharedPath]).data;
      assert.deepEqual(
        [saved.x, saved.y, saved.width, saved.height],
        [x, y, width, height],
      );
    } finally {
      ownerClient.stop();
    }
    await stop(true);
    await boot(href);
    await wait(`!!${picture}?.querySelector('.asset-node-fitted img')`);
    const restored = await call('getDocument', sharedPath);
    assert.deepEqual(
      [restored.x, restored.y, restored.width, restored.height],
      [x, y, width, height],
    );
    assert.equal(
      await js(
        `Math.abs(parseFloat(${picture}.style.width)-3*parseFloat(${picture}.style.height))<0.1`,
      ),
      true,
    );
    console.log(
      'PASS: shared image drag and resize survive restart and reconnect',
    );
  } finally {
    await stop();
    await server.close();
  }
}

async function checkFileNodes() {
  const selector = '[data-id="b"]';
  const compact = `${selector} .file-node-surface`;
  const query = (value) => `document.querySelector(${JSON.stringify(value)})`;
  const pointerAt = async (surface, modifiers = 0, drag = false) => {
    const visiblePoint = `(() => {
      const target = ${query(surface)}, r = target.getBoundingClientRect();
      const pane = target.classList.contains('react-flow__pane');
      const fractions = pane ? [0.1, 0.25, 0.5, 0.75, 0.9] : [0.5, 0.25, 0.75];
      for (const dy of fractions) for (const dx of fractions) {
        const x = Math.round(r.x + r.width * dx), y = Math.round(r.y + r.height * dy);
        const hit = document.elementFromPoint(x, y);
        if (pane ? target === hit : target.contains(hit)) return { x, y };
      }
      return null;
    })()`;
    await wait(visiblePoint);
    const point = await js(visiblePoint);
    const mouse = (type, x = point.x) =>
      send('Input.dispatchMouseEvent', {
        type,
        x,
        y: point.y,
        modifiers,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1,
      });
    await mouse('mousePressed');
    if (drag) {
      await mouse('mouseMoved', point.x + 25);
      await mouse('mouseMoved');
    }
    await mouse('mouseReleased');
  };
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

  await js(`${query('button[aria-label="캔버스 전체 맞춤"]')}.click()`);
  await pointerAt('.react-flow__pane');
  await wait(`!${query(selector)}.classList.contains('selected')`);
  await pointerAt(compact);
  await wait(`!!${query(selector + '.selected .file-node-surface')}`);
  await pointerAt(compact, 8); // Shift toggles selection without opening.
  await wait(`!${query(selector)}.classList.contains('selected')`);
  await pointerAt(compact);
  await wait(`!!${query(selector + '.selected .file-node-surface')}`);
  await pointerAt(compact);
  await wait(`!!${query(selector + ' .file-node-expanded')}`);
  await js(`${query(selector + ' button[aria-label="접기"]')}.click()`);
  await wait(`!!${query(compact)}`);

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
  assert.equal(
    await js(`getComputedStyle(${query(compact + ' strong')}).fontSize`),
    '13px',
  );
  await js(`{
    const values = [['MD 제목 글씨 크기', 23], ['MD 본문 글씨 크기', 21], ['HTML 제목 글씨 크기', 17]];
    for (const [label, value] of values) {
      const input = [...document.querySelectorAll('.file-node-settings input[type=range]')].find(element => element.getAttribute('aria-label') === label);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }`);
  await wait(`getComputedStyle(document.querySelector('.file-node-settings .file-node-surface--md strong')).fontSize === '23px' &&
    getComputedStyle(document.querySelector('.file-node-settings .file-node-summary')).fontSize === '21px' &&
    getComputedStyle(document.querySelector('.file-node-settings .file-node-surface--html strong')).fontSize === '17px'`);
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
  await wait('!document.querySelector(".file-node-settings")');
  await wait(`getComputedStyle(${query(compact + ' strong')}).fontSize === '23px' &&
    getComputedStyle(${query(compact + ' .file-node-summary')}).fontSize === '21px' &&
    getComputedStyle(${query(html + ' strong')}).fontSize === '17px'`);
  for (const [relative, raw] of originals)
    assert.equal(await fs.readFile(path.join(game, relative), 'utf8'), raw);
  const image = '[data-id="picture"] .asset-node-surface';
  const originalAsset = await fs.readFile(path.join(game, imagePath));
  await js(
    `document.querySelector('button[aria-label="캔버스 전체 맞춤"]').click()`,
  );
  for (const [surface, width, height] of [
    ['[data-id=portrait] .asset-node-surface', 4, 12],
    [image, 12, 4],
  ]) {
    await js(`${query(surface)}.focus({preventScroll:true})`);
    const img = query(surface + ' img');
    await wait(
      `${img}?.naturalWidth===${width}&&${img}.naturalHeight===${height}&&${query(surface)}.classList.contains('asset-node-fitted')`,
    );
    assert.equal(await js(`${query(surface)}.textContent`), '');
    assert.equal(
      await js(
        `(()=>{const root=document.documentElement,theme=root.dataset.theme;try{return ['light','dark'].every(value=>{root.dataset.theme=value;return getComputedStyle(${img}).backgroundColor==='rgba(0, 0, 0, 0)';});}finally{root.dataset.theme=theme;}})()`,
      ),
      true,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  await js(
    `(()=>{const surface=${query(image)},r=surface.getBoundingClientRect();surface.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`,
  );
  await wait(
    `[...document.querySelectorAll('[role=menuitem]')].some(b=>b.textContent==='에셋 경로 복사')`,
  );
  await wait(
    `[...document.querySelectorAll('[role=menuitem]')].some(b=>b.textContent==='원본 파일 보기')`,
  );
  await key('Escape');
  await pointerAt('.react-flow__pane');
  await wait(`!${query('[data-id="picture"]')}.classList.contains('selected')`);
  await pointerAt(image);
  await wait(`!!${query('[data-id="picture"].selected .asset-node-surface')}`);
  await pointerAt(image, 0, true);
  await pause();
  await wait(`!!${query('[data-id="picture"].selected:not(.dragging) .asset-node-surface')}`);
  await pointerAt(image);
  const editor = '[data-id="picture"] .tiptap';
  await wait(`!!${query(editor)}`);
  assert.equal(await js(`${query(editor)}.innerText`), '초기 설명');
  const imagePreview = '[data-id="picture"] .asset-description-preview img';
  await wait(`${query(imagePreview)}?.naturalWidth===12`);
  assert.equal(
    await js(
      `(()=>{const card=getComputedStyle(document.querySelector('[data-id=picture]')),p=${query(imagePreview)}.getBoundingClientRect(),e=${query(editor)}.getBoundingClientRect();return card.width==='320px'&&card.height==='300px'&&p.height>10&&p.bottom<=e.top;})()`,
    ),
    true,
  );
  await wait(`!!document.querySelector('button[aria-label="집중 편집"]')`);
  await js(`document.querySelector('button[aria-label="집중 편집"]').click()`);
  await wait(
    `document.querySelector('.editor-focus-dialog .asset-description-preview img')?.naturalWidth===12`,
  );
  assert.equal(
    await js(
      `document.querySelector('.editor-focus-dialog .asset-description-preview').getBoundingClientRect().bottom <= document.querySelector('.editor-focus-dialog .tiptap').getBoundingClientRect().top`,
    ),
    true,
  );
  await js(
    `document.querySelector('button[aria-label="집중 편집 닫기"]').click()`,
  );
  await wait(`!!${query(editor)}`);
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
  assert.deepEqual([written.data.width, written.data.height], [180, 160]);
  assert.deepEqual(
    await fs.readFile(path.join(game, imagePath)),
    originalAsset,
  );
  await wait(
    `getComputedStyle(document.querySelector('[data-id=picture]')).width==='180px'&&getComputedStyle(document.querySelector('[data-id=picture]')).height==='60px'`,
  );
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
  await wait(`!!${query('[data-id="a"] .file-node-surface')}`);
  await js(
    `document.querySelector('button[aria-label="캔버스 전체 맞춤"]').click()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  await checkExpandedOrder();
  await checkImageBounds('picture', 'y');
  await checkImageBounds('portrait', 'x');
  const squareImage = await js(`(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    canvas.getContext('2d').fillRect(8, 8, 16, 16);
    return canvas.toDataURL().split(',')[1];
  })()`);
  const square = await importTestImage('정사각형.png', squareImage, 1470, 400);
  await js(
    `document.querySelector('button[aria-label="캔버스 전체 맞춤"]').click()`,
  );
  await wait(
    `!!document.querySelector('[data-id="${square.id}"] .asset-node-fitted img')`,
  );
  await checkImageBounds(square.id, 'x', 8);
  console.log(
    'PASS: wide, tall and newly imported square image bounds and selection handles match at 57% and 100%',
  );
  await checkImageOperations(square);
  const workspace = await call('getWorkspace');
  await call(
    'setEditorDraft',
    `game-canvas-draft:${workspace.root}:picture`,
    {
      title: '스프라이트',
      body: imageBody.replace('초기 설명', recoveredDescription),
    },
    1,
  );
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
    const portraitPath = path.join(game, 'assets/images/tall.png');
    const portraitBytes = await fs.readFile(portraitPath);
    await fs.unlink(portraitPath);
    await boot();
    await enterWorkspace();
    await wait(
      `document.querySelector('[data-id="b"]:has(.file-node-surface)')?.style.width==='420px'`,
    );
    await wait(`getComputedStyle(document.querySelector('[data-id="b"] .file-node-title strong')).fontSize === '23px' &&
      getComputedStyle(document.querySelector('[data-id="b"] .file-node-summary')).fontSize === '21px' &&
      getComputedStyle(document.querySelector('.file-node-surface--html .file-node-title strong')).fontSize === '17px'`);
    await wait(
      '!!document.querySelector(\'[data-id="a"] .file-node-expanded\')',
    );
    await js(
      `document.querySelector('button[aria-label="캔버스 전체 맞춤"]').click()`,
    );
    const draftCard = `document.querySelector('[data-id=picture] .document-card__content')`;
    await wait(`!!${draftCard}`);
    await js(`${draftCard}.click()`);
    await wait(
      `[...document.querySelectorAll('[data-id=picture] button')].some(button=>button.textContent==='보관된 초안 불러오기')`,
    );
    await js(
      `[...document.querySelectorAll('[data-id=picture] button')].find(button=>button.textContent==='보관된 초안 불러오기').click()`,
    );
    await wait(
      `document.querySelector('[data-id=picture] .tiptap')?.innerText===${JSON.stringify(recoveredDescription)}&&document.querySelector('[data-id=picture] .asset-description-preview img')?.naturalWidth===12`,
    );
    await js(
      `[...document.querySelectorAll('[data-id=picture] button')].find(button=>button.textContent==='완료').click()`,
    );
    await wait(
      `!!document.querySelector('[data-id=picture] .asset-node-surface')`,
    );
    const retry = `${nodeQuery('portrait')}.querySelector('.project-image-placeholder button')`;
    await wait(`!!${retry}`);
    await fs.writeFile(portraitPath, portraitBytes);
    await js(`${retry}?.click()`);
    await wait(
      `!!${nodeQuery('portrait')}.querySelector('.asset-node-fitted img')`,
    );
    await wait(`document.querySelector('[data-id="a"] .markdown-body') &&
      getComputedStyle(document.querySelector('[data-id="a"] .markdown-body')).fontSize === '21px' &&
      getComputedStyle(document.querySelector('[data-id="a"] .canvas-file-header__title')).fontSize === '23px'`);
    await js(`document.querySelector('.file-node-surface--html').focus()`);
    await key('Enter');
    await wait(`document.querySelector('.preview-card.file-node-expanded .canvas-file-header__title') &&
      getComputedStyle(document.querySelector('.preview-card.file-node-expanded .canvas-file-header__title')).fontSize === '17px'`);
    console.log(
      'PASS: independent MD and HTML fonts render in previews, saved cards and reopened Windows sessions',
    );
    console.log(
      'PASS: Windows package restores the collapsed state and image draft, and retries a missing image',
    );
    await checkSharedImage();
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
  console.error(error);
  console.error(
    'Presentation UI failure state:',
    await js(
      `({notice:document.querySelector('.status-toast')?.textContent,dialog:document.querySelector('[aria-modal=true]')?.textContent,disabled:document.querySelector('[data-ui-id=membership] .button-primary')?.disabled,undoDisabled:document.querySelector('button[title^="실행 취소"]')?.disabled,selected:[...document.querySelectorAll('.react-flow__node.selected')].map(node=>node.dataset.id),nodes:${fileNodesOnly}?[...document.querySelectorAll('.react-flow__node')].map(node=>({id:node.dataset.id,bounds:node.getBoundingClientRect().toJSON(),layer:getComputedStyle(node).zIndex,text:node.innerText.slice(0,100)})):undefined})`,
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
  const cleanup = { recursive: true, force: true, maxRetries: 10 };
  await fs.rm(root, cleanup);
  await fs.rm(profile, cleanup);
}
