import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  root,
  profile,
  game,
  boot,
  stop,
  wait,
  js,
  send,
  mouse,
  key,
  pause,
} from './helpers/packaged-canvas.mjs';

const output = path.resolve('out/card-appearance-packaged');
const body = '# 핵심 플레이\n\n첫 번째 문단입니다.\n\n두 번째 문단입니다.\n';
await fs.mkdir(output, { recursive: true });
await fs.mkdir(path.join(game, 'docs'), { recursive: true });
await fs.rm(path.join(game, 'project.md'));
await fs.mkdir(path.join(game, 'output'), { recursive: true });
await fs.writeFile(
  path.join(game, 'docs/overview.md'),
  matter.stringify(body, {
    id: 'appearance-overview',
    title: '핵심 플레이',
    type: 'overview',
    status: 'draft',
    background_color: 'purple',
    custom: 'preserve',
    x: 50,
    y: 100,
    width: 450,
    height: 300,
  }),
);
await fs.writeFile(
  path.join(game, 'docs/question.md'),
  matter.stringify('# 모호한 점\n\n원본 질문입니다.\n', {
    id: 'appearance-question',
    title: '모호한 점',
    type: 'question',
    status: 'draft',
    background_color: 'pink',
    x: 550,
    y: 100,
    width: 450,
    height: 300,
  }),
);
const html =
  '<!doctype html><html><body style="background:#193522;color:white"><h1>게임 콘텐츠</h1></body></html>';
await fs.writeFile(path.join(game, 'output/index.html'), html);
const doc = '[data-find-document="appearance-overview"]';
const capture = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(
    path.join(output, name + '.png'),
    Buffer.from(data, 'base64'),
  );
};
const click = async (selector) => {
  const p = await js(
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await mouse('mousePressed', p.x, p.y);
  await mouse('mouseReleased', p.x, p.y);
};
const documentRecord = () =>
  js(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="appearance-overview"))',
  );
try {
  await boot();
  await wait(
    'document.querySelectorAll(".document-card").length===2&&!!document.querySelector(".preview-card")',
  );
  assert.equal(
    await js(
      `document.querySelector('${doc} .document-card__title').textContent.trim()`,
    ),
    '핵심 플레이',
  );
  assert.equal(
    await js(`document.querySelectorAll('${doc} .markdown-body h1').length`),
    0,
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".document-card:not(.type-ai-task) .card-actions").length',
    ),
    0,
  );
  const neutral = await js(
    `getComputedStyle(document.querySelector('${doc}')).backgroundColor`,
  );
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector("[data-find-document=appearance-question]")).backgroundColor',
    ),
    neutral,
  );
  assert.equal((await documentRecord()).backgroundColor, 'purple');
  await click('[aria-label="캔버스 전체 맞춤"]');
  await pause();
  await js(
    `document.querySelector('${doc} header').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:400,clientY:200}))`,
  );
  await wait('!!document.querySelector(".card-color-unavailable button")');
  assert.equal(
    await js(
      'document.querySelector(".card-color-unavailable button").disabled',
    ),
    true,
  );
  const history = await js('window.gameCanvas.listHistory().then(h=>h.length)');
  await js('document.querySelector(".card-color-unavailable button").click()');
  assert.equal((await documentRecord()).backgroundColor, 'purple');
  assert.equal(
    await js('window.gameCanvas.listHistory().then(h=>h.length)'),
    history,
  );
  await key('Escape', 'Escape', 27);
  await click(`${doc} [title="문서 상세 정보"]`);
  await wait('!!document.querySelector(".canvas-dock .object-inspector")');
  assert.match(
    await js(
      'document.querySelector(".canvas-dock .file-properties-editor").textContent',
    ),
    /문서 유형개요문서 단계초안/,
  );
  assert.equal(
    await js(
      'document.querySelectorAll(".canvas-dock__header > button").length',
    ),
    1,
  );
  await capture('properties');
  await click('.inspector-back-button');
  await wait('!document.querySelector(".canvas-dock .object-inspector")');
  await key('Escape', 'Escape', 27);
  await wait('!document.querySelector(".canvas-dock")');
  await click(`${doc} .document-card__title`);
  await wait(
    'document.activeElement?.getAttribute("aria-label")==="문서 제목"',
  );
  await key('a', 'KeyA', 65, 2);
  await send('Input.insertText', { text: '수정한 이름' });
  await key('s', 'KeyS', 83, 2);
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="appearance-overview")?.title==="수정한 이름")',
  );
  await wait(
    'window.gameCanvas.listDocuments().then(ds=>ds.find(d=>d.id==="appearance-overview")?.relativePath==="docs/수정한 이름.md")',
  );
  await wait(
    `(()=>{const input=document.querySelector('${doc} header input');return input&&input.value==='수정한 이름'&&!input.readOnly})()`,
  );
  await key('Escape', 'Escape', 27);
  await wait(
    `!!document.querySelector('${doc} .document-card__title') && !document.querySelector('${doc} header input')`,
  );
  await stop(true);
  const saved = matter(
    await fs.readFile(path.join(game, 'docs/수정한 이름.md'), 'utf8'),
  );
  assert.equal(saved.data.title, '수정한 이름');
  assert.equal(saved.data.background_color, 'purple');
  assert.equal(saved.data.custom, 'preserve');
  assert.equal(saved.content.trim(), body.trim());
  assert.equal(
    await fs.readFile(path.join(game, 'output/index.html'), 'utf8'),
    html,
  );
  await boot();
  await wait(
    `document.querySelector('${doc} .document-card__title')?.textContent.trim()==='수정한 이름'`,
  );
  assert.equal((await documentRecord()).backgroundColor, 'purple');
  assert.equal(
    await js(`document.querySelector('${doc} .markdown-body h1')?.textContent`),
    '핵심 플레이',
  );
  assert.equal(
    await js(
      'document.querySelectorAll("[data-find-document=appearance-question] .markdown-body h1").length',
    ),
    0,
  );
  await capture('restarted');
  console.log(
    'PASS: Windows package shared headers/properties, duplicate H1 reading, disabled colors/history, native title save, original Markdown/custom fields/colors/HTML and full process restart.',
  );
} catch (error) {
  if (js) await capture('failure').catch(() => {});
  throw error;
} finally {
  await stop();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(path.basename(root).startsWith('gamejam-resize-packaged-'));
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
