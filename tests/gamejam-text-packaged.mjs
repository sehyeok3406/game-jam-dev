import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import { createTextObject } from '../src/text-document.ts';
import { applyDrawing } from '../src/drawing-model.ts';
import { textMaterialPath } from '../src/canvas-text-materials.ts';
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
  pause,
} from './helpers/packaged-canvas.mjs';
const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const a = createTextObject(100, 500),
  b = createTextObject(600, 500);
a.geometry.document = JSON.stringify({
  type: 'doc',
  content: [
    p('패키지 텍스트 재료'),
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [p('보석 수집')] }],
    },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [{ type: 'listItem', content: [p('출구 열기')] }],
    },
  ],
});
b.geometry.document = JSON.stringify({
  type: 'doc',
  content: [p('선택하지 않은 자료')],
});
const files = applyDrawing(
  {},
  { canvasId: 'default', action: 'create', objects: [a, b] },
);
await fs.mkdir(path.join(game, '.canvas/drawings'), { recursive: true });
await fs.writeFile(
  path.join(game, '.canvas/drawings/default.json'),
  files['.canvas/drawings/default.json'],
);
const ref = textMaterialPath({ ...a, canvasId: 'default' });
const refB = textMaterialPath({ ...b, canvasId: 'default' });
const click = (selector) =>
  js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const button = (selector, label) =>
  js(
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`,
  );
const center = async (id) =>
  js(
    `(()=>{const r=document.querySelector('.react-flow__node[data-id="drawing:${id}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+15}})()`,
  );
const tap = async (point) => {
  await mouse('mousePressed', point.x, point.y);
  await mouse('mouseReleased', point.x, point.y);
};
const capture = async (name) => {
  await fs.mkdir('out/gamejam-text-packaged', { recursive: true });
  const r = await send('Page.captureScreenshot');
  await fs.writeFile(
    `out/gamejam-text-packaged/${name}.png`,
    Buffer.from(r.data, 'base64'),
  );
};
try {
  await boot();
  await wait('document.querySelectorAll(".canvas-text-node").length===2');
  await click('button[title^="캔버스 전체 보기"]');
  for (let i = 0; i < 5; i++) await pause();
  await tap(await center(a.id));
  await click('[aria-label="gamejam!"]');
  await wait('!!document.querySelector("#ai-select-on-canvas")');
  assert.ok(
    await js(
      `document.querySelector('.ai-input-scope').textContent.includes('텍스트 1개')`,
    ),
    'preselected text is a material',
  );
  assert.ok(
    await js(
      `[...document.querySelectorAll('.canvas-material-picker label')].some(e=>e.textContent.includes('패키지 텍스트 재료')&&e.querySelector('input').checked)`,
    ),
  );
  await click('#ai-select-on-canvas');
  await wait('!!document.querySelector(".material-selection-bar")');
  assert.equal(
    await js('!!document.querySelector(".ai-request-dialog")'),
    false,
  );
  await tap(await center(b.id));
  await wait(
    'document.querySelector(".material-selection-bar").textContent.includes("선택 완료 · 2개")',
  );
  await tap(await center(b.id));
  await wait(
    'document.querySelector(".material-selection-bar").textContent.includes("선택 완료 · 1개")',
  );
  await button('.material-selection-bar button', '선택 완료');
  await wait('!!document.querySelector(".ai-request-dialog")');
  await capture('text-material-selected');
  // Create, but never execute, a real task through the packaged IPC/backend.
  const task = await js(
    `window.gameCanvas.createTask({kind:'implement',inputPaths:[${JSON.stringify(ref)}],canvasId:'default',x:1050,y:500,htmlResult:{mode:'new'},instructions:'선택한 텍스트로 게임 만들기',resultName:'텍스트 게임'})`,
  );
  const raw = await fs.readFile(path.join(game, task.relativePath), 'utf8');
  const data = matter(raw).data;
  assert.equal(data.inputs.length, 1);
  const source = data.inputs[0];
  assert.ok(source.startsWith('docs/text-sources/'));
  const saved = await fs.readFile(path.join(game, source), 'utf8');
  assert.match(saved, /- 보석 수집/);
  assert.match(saved, /3\. 출구 열기/);
  assert.ok(!saved.includes('선택하지 않은 자료'));
  assert.deepEqual(data.gamejam_request.request.inputPaths, [ref]);
  assert.ok(
    !(await js('window.gameCanvas.listDocuments()')).some((d) =>
      d.relativePath.startsWith('docs/text-sources/'),
    ),
    'snapshots do not create canvas cards',
  );
  await js(
    `(async()=>{const w=await window.gameCanvas.getWorkspace();return window.gameCanvas.applyDrawingCommand({canvasId:'default',scope:w.saveScope,requestId:crypto.randomUUID(),action:'patch',patches:[{id:${JSON.stringify(a.id)},generation:${JSON.stringify(a.generation)},expectedGeometry:${JSON.stringify(a.geometry)},geometry:${JSON.stringify({ ...a.geometry, document: JSON.stringify({ type: 'doc', content: [p('나중에 수정한 텍스트')] }) })}}]})})()`,
  );
  assert.equal(await fs.readFile(path.join(game, source), 'utf8'), saved);
  // Mixing file and text follows the same captured-source path.
  const mixed = await js(
    `window.gameCanvas.createTask({kind:'implement',inputPaths:['project.md',${JSON.stringify(refB)}],canvasId:'default',x:1050,y:900,htmlResult:{mode:'new'},resultName:'혼합 재료'})`,
  );
  const mixedData = matter(
    await fs.readFile(path.join(game, mixed.relativePath), 'utf8'),
  ).data;
  assert.ok(mixedData.inputs.includes('project.md'));
  assert.equal(mixedData.inputs.length, 2);
  await stop(true);
  await boot();
  assert.equal(await fs.readFile(path.join(game, source), 'utf8'), saved);
  const docs = await js('window.gameCanvas.listDocuments()');
  assert.ok(docs.some((d) => d.relativePath === task.relativePath));
  await fs.writeFile(
    'out/gamejam-text-packaged/result.json',
    JSON.stringify(
      {
        passed: true,
        task: task.relativePath,
        inputs: data.inputs,
        mixedInputs: mixedData.inputs,
        sourceMarkdown: matter(saved).content,
        originalSelection: data.gamejam_request.request.inputPaths,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: packaged preselection/list/canvas text materials, list preservation, real IPC text-only and mixed tasks, immutable snapshots, hidden source cards and restart persistence. No AI execution.',
  );
} catch (error) {
  if (js) await capture('failure').catch(() => {});
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
