import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { locationLinkHref } from '../src/core/projects/location-links.ts';
import { applyDrawing, drawingPath } from '../src/drawing-model.ts';
import { createTextObject, plainTextDocument } from '../src/text-document.ts';
import { encodeAsset } from '../src/file-assets.ts';

assert.equal(process.platform, 'win32');
const temp = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-location-package-'),
);
const executable = path.resolve('out/Game Jam!-win32-x64/Game Canvas.exe');
await fs.access(executable);
const profileId = randomUUID(),
  blockId = randomUUID(),
  hugeId = randomUUID(),
  tinyId = randomUUID(),
  textId = randomUUID();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7S8AAAAASUVORK5CYII=',
  'base64',
);
let files = {
  'project.md': '# 위치 링크 패키지 검사\n',
  'docs/note.md': `---\nid: packaged-note\ntitle: 문단 링크 검증\ntype: idea\nx: 120\ny: 120\nwidth: 480\nheight: 420\n---\n${Array.from({ length: 45 }, (_, i) => `검증 문단 ${i + 1}${i === 35 ? `<!--gamejam:block:${blockId}-->` : ''}`).join('\n\n')}\n`,
  'docs/image.md': `---\nid: packaged-image\ntitle: 큰 이미지\ntype: image\nx: 3000\ny: 2000\nwidth: 90000\nheight: 60000\nasset:\n  path: assets/images/dot.png\n  purpose: asset\n  originalName: dot.png\n  mime: image/png\n  bytes: ${png.length}\n---\n![이미지](assets/images/dot.png)\n`,
  'assets/images/dot.png': encodeAsset('assets/images/dot.png', png),
  'output/index.html':
    '<!doctype html><html><body><h1>공유 HTML</h1></body></html>',
};
const shape = (id, width, height) => ({
  id,
  generation: randomUUID(),
  kind: 'shape',
  transform: { x: 1500, y: -2000, width, height, rotation: 35 },
  geometry: { shape: 'rectangle' },
  style: {
    fill: '#f97316',
    stroke: '#0f172a',
    strokeWidth: 1,
    opacity: 1,
    strokePattern: 'solid',
  },
  layer: 'annotation',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
});
const text = createTextObject(500, 800, 1, textId);
text.geometry.document = plainTextDocument('캔버스 텍스트 링크');
files = applyDrawing(files, {
  canvasId: 'default',
  action: 'create',
  objects: [shape(hugeId, 100000, 90000), shape(tinyId, 1, 1), text],
});
assert.ok(files[drawingPath('default')]);
const server = await createCollaborationServer({
  dataDirectory: path.join(temp, 'server'),
  port: 0,
  creationKey: 'package-links',
});
const serverUrl = `http://127.0.0.1:${server.port}`;
const owner = await CollaborationClient.create(
  serverUrl,
  'package-links',
  '패키지 관리자',
  '위치 링크 패키지 검사',
  files,
);
const projectId = owner.credentials.projectId;
const url = (target) => locationLinkHref({ version: 1, projectId, target });
const registryKey = 'HKCU\\Software\\Classes\\gamejam';
const backup = path.join(temp, 'original-protocol.reg');
let child,
  ws,
  js,
  debugPort,
  registered = false,
  hadProtocol = false;
function reg(args) {
  return execFileSync('reg.exe', args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}
try {
  reg(['query', registryKey]);
  hadProtocol = true;
  reg(['export', registryKey, backup, '/y']);
} catch (error) {
  if (hadProtocol) throw error;
}
async function port() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
async function wait(expression) {
  for (let i = 0; i < 200; i++) {
    if (await js(expression)) return;
    await sleep(60);
  }
  throw Error('Package UI timeout: ' + expression);
}
async function attach() {
  let target;
  for (let i = 0; i < 200; i++) {
    try {
      target = (
        await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) =>
          r.json(),
        )
      ).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (target) break;
    } catch {}
    await sleep(70);
  }
  assert.ok(target, 'package debugger ready');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.reject(Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  js = async (expression) => {
    const result = await new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      ws.send(
        JSON.stringify({
          id: next,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  await wait('!!window.gameCanvas?.locationLinks');
}
async function boot(href) {
  debugPort = await port();
  child = spawn(
    executable,
    [
      `--game-canvas-test-profile=${profileId}`,
      `--remote-debugging-port=${debugPort}`,
      ...(href ? [href] : []),
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  await attach();
}
async function stop() {
  if (child?.exitCode === null) {
    const ended = new Promise((resolve) => child.once('exit', resolve));
    void js('window.close()').catch(() => {});
    await Promise.race([ended, sleep(8000)]);
    if (child.exitCode === null) {
      child.kill();
      await ended;
    }
  }
  ws?.close();
  ws = null;
}
async function openTarget(target) {
  const href = url(target);
  // Exercise the external second-instance path, not just renderer API calls.
  const second = spawn(
    executable,
    [`--game-canvas-test-profile=${profileId}`, href],
    { windowsHide: true, stdio: 'ignore' },
  );
  await new Promise((resolve, reject) => {
    second.once('error', reject);
    second.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error('second instance failed ' + code)),
    );
  });
  await wait('!!document.querySelector(".location-link-highlight")');
  if (target.kind !== 'html')
    await wait(
      `document.querySelector('.react-flow__node.selected')?.dataset.id === ${JSON.stringify(target.kind === 'drawing' ? `drawing:${target.id}` : target.id)}`,
    );
}
try {
  await boot();
  await js(
    `window.gameCanvas.joinCollaboration(${JSON.stringify({ serverUrl, code: owner.result.code, nickname: '패키지 참여자' })})`,
  );
  await js('window.gameCanvas.getWorkspace()');
  await stop();
  await boot(url({ kind: 'document', id: 'packaged-note', blockId }));
  await wait('!!document.querySelector(".location-link-highlight")');
  await wait(
    '(document.querySelector("[data-location-block]")?.closest(".document-card__content")?.scrollTop ?? 0)>0',
  );
  assert.equal(
    (await js('window.gameCanvas.getCollaboration()')).projectId,
    projectId,
  );
  const session = await js(
    '(async()=> (await window.gameCanvas.getWorkspace()).session)()',
  );
  const sharedHref = await js(
    `window.gameCanvas.locationLinks.create({kind:'document',id:'packaged-note'},${JSON.stringify(session)})`,
  );
  assert.equal(parseTarget(sharedHref).kind, 'document');
  await sleep(1900);
  await openTarget({ kind: 'drawing', id: hugeId });
  await sleep(450);
  const huge = await js(
    `(()=>{const n=document.querySelector('[data-id="drawing:${hugeId}"]'),r=n?.getBoundingClientRect(),p=n?.closest('.react-flow')?.getBoundingClientRect();return{r:r?.toJSON(),p:p?.toJSON(),zoom:new DOMMatrixReadOnly(document.querySelector('.react-flow__viewport').style.transform).a}})()`,
  );
  assert.ok(
    huge.r.width <= huge.p.width && huge.r.height <= huge.p.height,
    JSON.stringify(huge),
  );
  assert.ok(huge.zoom < 0.15, JSON.stringify(huge));
  await sleep(1900);
  await openTarget({ kind: 'drawing', id: tinyId });
  await sleep(450);
  const tiny = await js(
    '(()=>{const r=document.querySelector(".location-link-highlight")?.getBoundingClientRect();return {width:r?.width,height:r?.height}})()',
  );
  assert.ok(tiny.width >= 32 && tiny.height >= 32);
  await sleep(1900);
  await openTarget({ kind: 'document', id: 'packaged-image' });
  await sleep(450);
  const image = await js(
    '(()=>{const n=document.querySelector("[data-id=packaged-image]"),r=n?.getBoundingClientRect(),p=n?.closest(".react-flow")?.getBoundingClientRect();return {r:r?.toJSON(),p:p?.toJSON()}})()',
  );
  assert.ok(
    image.r.width <= image.p.width && image.r.height <= image.p.height,
    JSON.stringify(image),
  );
  await sleep(1900);
  await openTarget({ kind: 'drawing', id: textId });
  const html = (await js('window.gameCanvas.listPreviews()'))[0];
  await sleep(1900);
  await openTarget({ kind: 'html', id: html.sourceId });
  await sleep(1900);
  const command = `"${executable}" "--game-canvas-test-profile=${profileId}" "%1"`;
  registered = true;
  reg([
    'add',
    registryKey,
    '/ve',
    '/t',
    'REG_SZ',
    '/d',
    'URL:Game Jam location QA',
    '/f',
  ]);
  reg([
    'add',
    registryKey,
    '/v',
    'URL Protocol',
    '/t',
    'REG_SZ',
    '/d',
    '',
    '/f',
  ]);
  reg([
    'add',
    registryKey + '\\shell\\open\\command',
    '/ve',
    '/t',
    'REG_SZ',
    '/d',
    command,
    '/f',
  ]);
  const dispatch = spawn(
    'rundll32.exe',
    [
      'url.dll,FileProtocolHandler',
      url({ kind: 'document', id: 'packaged-note', blockId }),
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  await new Promise((resolve, reject) => {
    dispatch.once('error', reject);
    dispatch.once('exit', resolve);
  });
  await wait('!!document.querySelector(".location-link-highlight")');
  await wait(
    '(document.querySelector("[data-location-block]")?.closest(".document-card__content")?.scrollTop ?? 0)>0',
  );
  await fs.mkdir('out/location-links-packaged', { recursive: true });
  await fs.writeFile(
    'out/location-links-packaged/evidence.json',
    JSON.stringify(
      {
        profileId,
        coldStart: true,
        secondInstance: true,
        windowsProtocolDispatch: true,
        paragraph: true,
        html: true,
        canvasText: true,
        hugeShape: huge,
        tinyHighlight: tiny,
        hugeImage: image,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Windows packaged cold/warm links, actual OS protocol dispatch, paragraphs, HTML/text and huge/tiny/rotated geometry',
  );
} catch (error) {
  if (js)
    console.error(
      'Location package diagnostic',
      JSON.stringify(
        await js(
          '({error:document.querySelector("[aria-labelledby=location-link-error-title]")?.textContent,selected:document.querySelector(".react-flow__node.selected")?.dataset.id})',
        ).catch(() => null),
      ),
    );
  throw error;
} finally {
  await stop();
  if (registered) {
    const current = reg([
      'query',
      registryKey + '\\shell\\open\\command',
      '/ve',
    ]);
    if (!current.includes(profileId)) {
      console.error(
        'Protocol mapping changed during QA; original backup retained at ' +
          backup,
      );
      process.exitCode = 1;
    } else {
      reg(['delete', registryKey, '/f']);
      if (hadProtocol) reg(['import', backup]);
    }
  }
  await server.close();
}
function parseTarget(href) {
  return { kind: new URL(href).searchParams.get('kind') };
}
