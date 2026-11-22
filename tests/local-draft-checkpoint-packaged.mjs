import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  boot,
  game,
  js,
  key,
  profile,
  root,
  send,
  stop,
  wait,
} from './helpers/packaged-canvas.mjs';

const drafts = path.join(profile, 'editor-drafts');
const note = path.join(game, 'ideas/legacy.md');
const noteSelector = '[data-id="legacy-memo"]';
const memoKey = `game-canvas-draft:${game}:legacy-memo`;
const drawingPath = path.join(game, '.canvas/drawings/default.json');
const noDrawing = async () => {
  assert.deepEqual(await js('window.gameCanvas.listDrawings()'), []);
  await assert.rejects(fs.stat(drawingPath), { code: 'ENOENT' });
};
const filename = (key) =>
  path.join(drafts, createHash('sha256').update(key).digest('hex') + '.json');
const readDraft = (key) => fs.readFile(filename(key), 'utf8').then(JSON.parse);
const readFromApp = (key) =>
  js(`window.gameCanvas.getEditorDraft(${JSON.stringify(key)})`);

function startPointer(type, x, y) {
  return send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: type === 'mousePressed' ? 1 : 0,
  });
}

async function holdPen(seconds) {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await key('p', 'KeyP', 80, 8);
  await wait('!!document.querySelector(".drawing-input-layer--pen")');
  const target = `(() => {
    for (let y = 360; y <= 620; y += 55)
      for (let x = 560; x <= 840; x += 55)
        if (document.elementFromPoint(x, y)?.classList.contains('drawing-input-layer--pen')) return { x, y };
    return null;
  })()`;
  await wait(`!!${target}`);
  const { x, y } = await js(target);
  const start = performance.now();
  await startPointer('mousePressed', x, y);
  const until = start + seconds * 1000;
  let step = 0;
  while (performance.now() < until) {
    await startPointer('mouseMoved', x + 10 + step * 4, y + 10 + step++ * 2);
    if (step === 1)
      await wait(
        '!!document.querySelector(".drawing-input-layer__preview path")',
      );
    await delay(Math.min(630, Math.max(0, until - performance.now())));
  }
  await wait('!!document.querySelector(".drawing-input-layer__preview path")');
  return start;
}

const button = (label) =>
  `[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(label)} && el.getClientRects().length)`;
async function click(label) {
  const target = button(label);
  await wait(`!!(${target})`);
  await js(`(${target}).click()`);
}

async function prepareMemo() {
  await fs.mkdir(path.dirname(note), { recursive: true });
  await fs.writeFile(
    note,
    '---\nid: legacy-memo\ntitle: Legacy memo\ntype: idea\nx: 80\ny: 80\nwidth: 360\nheight: 240\n---\nOriginal memo\n',
  );
}

async function openMemo() {
  await wait(
    `!!document.querySelector('${noteSelector} :is(.file-node-surface, .document-card__content)')`,
  );
  await js(
    `document.querySelector('${noteSelector} .file-node-surface')?.click()`,
  );
  await wait(
    `!!document.querySelector('${noteSelector} :is(.document-card__content, .tiptap[contenteditable="true"])')`,
  );
  await js(
    `document.querySelector('${noteSelector} .document-card__content')?.click()`,
  );
  await wait(
    `!!document.querySelector('${noteSelector} .tiptap[contenteditable="true"]')`,
  );
}

async function exercisePenAndLegacyDrafts() {
  await prepareMemo();
  await fs.writeFile(
    filename(memoKey),
    JSON.stringify({
      title: 'Legacy memo',
      body: 'Older draft text',
      sequence: 1,
    }),
  );

  await boot();
  const scope = await js(
    'window.gameCanvas.getWorkspace().then(workspace => workspace.saveScope)',
  );
  const drawingKey = `drawing:${scope}`;
  await holdPen(28.5);
  await assert.rejects(fs.stat(filename(drawingKey)), { code: 'ENOENT' });
  await noDrawing();
  await stop();

  await boot();
  assert.equal(await readFromApp(drawingKey), null);
  await noDrawing();
  const start = await holdPen(27.5);
  await assert.rejects(fs.stat(filename(drawingKey)), { code: 'ENOENT' });
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(drawingKey)}).then(Boolean)`,
  );
  const observedAfter = Math.round(performance.now() - start);
  assert.ok(
    observedAfter >= 29_950,
    `Checkpoint appeared too early: ${observedAfter}ms`,
  );
  const checkpoint = await readDraft(drawingKey);
  const [recorded] = JSON.parse(checkpoint.body);
  assert.equal(recorded.objects[0].kind, 'stroke');
  assert.ok(recorded.objects[0].geometry.points.length > 20);
  await startPointer('mouseMoved', 950, 650);
  await noDrawing();
  await stop();

  await boot();
  assert.deepEqual(await readFromApp(drawingKey), checkpoint);
  await click('초안 복구');
  const strokeId = recorded.objects[0].id;
  await wait(
    `window.gameCanvas.listDrawings().then(drawings => drawings.some(item => item.id === ${JSON.stringify(strokeId)}))`,
  );
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(drawingKey)}).then(draft => !draft)`,
  );
  await key('s', 'KeyS', 83, 2);
  await wait(
    `window.gameCanvas.listHistory().then(entries => entries.some(entry => entry.label === '편집 내용 저장'))`,
  );
  const [restored] = JSON.parse(await fs.readFile(drawingPath, 'utf8')).objects;
  assert.deepEqual(restored.geometry, recorded.objects[0].geometry);

  await openMemo();
  await click('보관된 초안 불러오기');
  await wait(
    `document.querySelector('${noteSelector} .tiptap')?.textContent.includes('Older draft text')`,
  );
  await key('s', 'KeyS', 83, 2);
  await wait(
    'window.gameCanvas.getDocument("ideas/legacy.md").then(doc => doc?.body.includes("Older draft text"))',
  );
  await stop();

  const copy = { ...restored, id: randomUUID(), generation: randomUUID() };
  const legacyCommand = {
    scope,
    canvasId: 'default',
    action: 'create',
    objects: [copy],
  };
  const legacyDraft = {
    title: '그림 복구',
    body: JSON.stringify([legacyCommand]),
    sequence: 1,
  };
  await fs.writeFile(filename(drawingKey), JSON.stringify(legacyDraft));
  await boot();
  await click('초안 복구');
  await wait(
    `window.gameCanvas.listDrawings().then(drawings => drawings.some(item => item.id === ${JSON.stringify(copy.id)}))`,
  );
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(drawingKey)}).then(draft => !draft)`,
  );
  await stop(true);

  await fs.writeFile(filename(drawingKey), JSON.stringify(legacyDraft));
  await boot();
  await click('초안 버리기');
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(drawingKey)}).then(draft => !draft)`,
  );
  await stop();
  await boot();
  assert.equal(await readFromApp(drawingKey), null);
  assert.equal(await js(`!!(${button('초안 복구')})`), false);
  console.log(
    `PASS: Windows package lost only uncheckpointed ink, recovered a stroke captured at ${observedAfter}ms and older Markdown/ink, and kept discarded ink cleared after restart`,
  );
}

async function exerciseMarkdownTitle() {
  await prepareMemo();
  await boot();
  await openMemo();
  const input = `document.querySelector('${noteSelector} input.document-card__title')`;
  const changeTitle = async (text) => {
    await js(`${input}.focus(); ${input}.select()`);
    await send('Input.insertText', { text });
    await wait(`${input}.value === ${JSON.stringify(text)}`);
  };
  await changeTitle('First unsaved title');
  await delay(28_500);
  await changeTitle('Latest unsaved title');
  await assert.rejects(fs.stat(filename(memoKey)), { code: 'ENOENT' });
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(memoKey)}).then(Boolean)`,
  );
  assert.equal((await readDraft(memoKey)).title, 'Latest unsaved title');
  assert.match(await fs.readFile(note, 'utf8'), /title: Legacy memo/);
  await stop();
  await boot();
  await openMemo();
  await click('보관된 초안 불러오기');
  await wait(`${input}.value === 'Latest unsaved title'`);
  console.log(
    'PASS: the Windows Markdown editor checkpoint captured the latest pending title and recovered it after a crash',
  );
}

async function exerciseCanvasText() {
  await boot();
  await key('t', 'KeyT', 84);
  await wait(`!!document.querySelector('.app-shell--tool-text')`);
  const point = await js(`(() => {
    for (let y = 250; y < 700; y += 100)
      for (let x = 500; x < 1100; x += 100)
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
    throw Error('No empty canvas point');
  })()`);
  await startPointer('mousePressed', point.x, point.y);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await wait(
    'document.activeElement?.getAttribute("aria-label")==="캔버스 텍스트 내용"',
  );
  await send('Input.insertText', { text: 'Saved text base' });
  await wait(
    `window.gameCanvas.listDrawings().then(items => items[0]?.geometry.document.includes('Saved text base'))`,
  );
  await key('s', 'KeyS', 83, 2);
  await wait(
    `window.gameCanvas.listHistory().then(entries => entries.some(entry => entry.label === '편집 내용 저장'))`,
  );
  const scope = await js(
    'window.gameCanvas.getWorkspace().then(workspace => workspace.saveScope)',
  );
  const [base] = await js('window.gameCanvas.listDrawings()');
  const textKey = `canvas-text:${scope}:${base.id}`;

  const start = performance.now();
  let draft;
  let checkedBefore = false;
  while (performance.now() - start < 35_000 && !draft) {
    await send('Input.insertText', { text: 'x' });
    const elapsed = performance.now() - start;
    if (elapsed >= 28_500 && elapsed <= 29_500 && !checkedBefore) {
      await assert.rejects(fs.stat(filename(textKey)), { code: 'ENOENT' });
      checkedBefore = true;
    }
    if (elapsed >= 30_000)
      draft = await readDraft(textKey).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    if (!draft) await delay(150);
  }
  assert.ok(
    checkedBefore && draft,
    'continuous canvas text must produce a 30-second checkpoint',
  );
  const saved = JSON.parse(draft.body);
  assert.deepEqual(saved.base, base.geometry);
  assert.match(saved.geometry.document, /Saved text basex{20,}/);
  await stop();

  await boot();
  await wait(
    `window.gameCanvas.listDrawings().then(items => items[0]?.geometry.document === ${JSON.stringify(saved.geometry.document)})`,
  );
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(textKey)}).then(draft => !draft)`,
  );
  await delay(700);
  assert.equal(await readFromApp(textKey), null);
  assert.equal(
    await js(
      `document.querySelector('.canvas-text-error')?.textContent ?? null`,
    ),
    null,
  );
  console.log(
    'PASS: the Windows canvas text editor recovered its last checkpoint after a crash during continuous typing',
  );
}

try {
  await fs.mkdir(drafts, { recursive: true });
  if (process.argv.includes('--text')) await exerciseCanvasText();
  else if (process.argv.includes('--markdown')) await exerciseMarkdownTitle();
  else await exercisePenAndLegacyDrafts();
} finally {
  await stop();
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(path.resolve(profile)),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
