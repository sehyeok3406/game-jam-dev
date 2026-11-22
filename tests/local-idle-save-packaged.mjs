import assert from 'node:assert/strict';
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

const note = 'ideas/idle-memo.md';
const selector = '[data-id="idle-memo"]';
const drawingFile = path.join(game, '.canvas/drawings/default.json');
const api = (name, ...args) =>
  js(`window.gameCanvas[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
const projectId = (directory) => 'local:' + directory.toLowerCase();
const pen = () => key('p', 'KeyP', 80, 8);
const original = () => fs.readFile(path.join(game, note), 'utf8');
const diskObjects = () =>
  fs
    .readFile(drawingFile, 'utf8')
    .then(JSON.parse)
    .then((file) => file.objects);
const currentCount = (n) =>
  wait(`window.gameCanvas.listDrawings().then(items => items.length === ${n})`);
const historyBatches = async () =>
  (await api('listHistory')).filter(
    (entry) => entry.label === '편집 내용 저장',
  );

async function fixture() {
  await fs.mkdir(path.join(game, 'ideas'), { recursive: true });
  await fs.writeFile(
    path.join(game, note),
    '---\nid: idle-memo\ntitle: Idle memo\ntype: idea\nx: 80\ny: 100\nwidth: 360\nheight: 230\n---\nBASE MEMO\n',
  );
}

async function stroke(index) {
  const x = 620;
  const y = 320 + index * 44;
  for (const [type, offset] of [
    ['mousePressed', 0],
    ['mouseMoved', 50],
    ['mouseMoved', 95],
    ['mouseReleased', 135],
  ])
    await send('Input.dispatchMouseEvent', {
      type,
      x: x + offset,
      y: y + offset / 10,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
}

async function openMemo() {
  await wait(
    `!!document.querySelector('${selector} :is(.file-node-surface, .document-card__content)')`,
  );
  await js(`document.querySelector('${selector} .file-node-surface')?.click()`);
  await wait(
    `!!document.querySelector('${selector} :is(.document-card__content, .tiptap)')`,
  );
  await js(
    `document.querySelector('${selector} .document-card__content')?.click()`,
  );
  await wait(
    `document.activeElement === document.querySelector('${selector} .tiptap[contenteditable="true"]')`,
  );
}

async function typeMemo(text) {
  await send('Input.insertText', { text });
  await wait(
    `window.gameCanvas.getDocumentSaveStates().then(states => states.some(state => state.documentId === 'idle-memo' && state.phase === 'queued' && state.latest.body.includes(${JSON.stringify(text)})))`,
  );
}

async function expectBatches(count) {
  await wait(
    `window.gameCanvas.listHistory().then(entries => entries.filter(entry => entry.label === '편집 내용 저장').length === ${count})`,
  );
  return historyBatches();
}

async function manualAndUndo() {
  await boot();
  await openMemo();
  await typeMemo(' BATCHED WITHOUT BLUR SAVE');
  await key('Enter', 'Enter', 13, 2);
  await wait(
    `!document.querySelector('${selector} .tiptap[contenteditable="true"]')`,
  );
  assert.equal((await original()).includes('BATCHED WITHOUT BLUR SAVE'), false);

  await pen();
  await wait('!!document.querySelector(".drawing-input-layer--pen")');
  for (let i = 0; i < 3; i++) {
    await stroke(i);
    await currentCount(i + 1);
  }
  const ids = (await api('listDrawings')).map((object) => object.id);
  await assert.rejects(fs.stat(drawingFile), { code: 'ENOENT' });
  assert.deepEqual(await historyBatches(), []);
  await key('z', 'KeyZ', 90, 2);
  await currentCount(2);
  await assert.rejects(fs.stat(drawingFile), { code: 'ENOENT' });
  await key('s', 'KeyS', 83, 2);
  const [batch] = await expectBatches(1);
  assert.deepEqual(batch.files.map((item) => item.relativePath).sort(), [
    '.canvas/drawings/default.json',
    note,
  ]);
  assert.ok((await original()).includes('BATCHED WITHOUT BLUR SAVE'));
  assert.deepEqual(
    (await diskObjects()).map((o) => o.id),
    ids.slice(0, 2),
  );

  await key('z', 'KeyZ', 90, 10);
  await currentCount(3);
  assert.equal((await diskObjects()).length, 2);
  await key('z', 'KeyZ', 90, 2);
  await currentCount(2);
  await key('z', 'KeyZ', 90, 2);
  await currentCount(1);
  await key('z', 'KeyZ', 90, 10);
  await currentCount(2);
  await key('z', 'KeyZ', 90, 10);
  await currentCount(3);
  assert.equal((await diskObjects()).length, 2);
  await key('Escape', 'Escape', 27);
  await openMemo();
  await typeMemo(' LAST TYPING BEFORE QUIT');
  assert.equal((await original()).includes('LAST TYPING BEFORE QUIT'), false);
  await stop(true);
  assert.equal((await diskObjects()).length, 3);
  assert.ok((await original()).includes('LAST TYPING BEFORE QUIT'));
  console.log(
    'PASS: Ctrl+S saved Markdown and two strokes in one version, Undo/Redo stayed per stroke, and closing saved the pending stroke',
  );
}

async function autoIdle() {
  await boot();
  await pen();
  await wait('!!document.querySelector(".drawing-input-layer--pen")');
  const start = performance.now();
  await stroke(0);
  await currentCount(1);
  await delay(35_000);
  await wait(`!!document.querySelector('button[aria-label="확대"]')`);
  await js(`document.querySelector('button[aria-label="확대"]').click()`);
  await delay(Math.max(0, 117_000 - (performance.now() - start)));
  await assert.rejects(fs.stat(drawingFile), { code: 'ENOENT' });
  await expectBatches(1);
  assert.equal((await diskObjects()).length, 1);
  const elapsed = Math.round(performance.now() - start);
  assert.ok(
    elapsed >= 119_800 && elapsed < 130_000,
    `Original saved after ${elapsed}ms`,
  );
  console.log(
    `PASS: packaged autosave published at ${elapsed}ms despite a viewport-only change`,
  );
}

async function projectSwitch() {
  await boot();
  await openMemo();
  await typeMemo(' SAVE BEFORE PROJECT SWITCH');
  await key('Enter', 'Enter', 13, 2);
  await wait(
    `!document.querySelector('${selector} .tiptap[contenteditable="true"]')`,
  );
  await pen();
  await wait('!!document.querySelector(".drawing-input-layer--pen")');
  await stroke(0);
  await currentCount(1);
  assert.equal(
    (await original()).includes('SAVE BEFORE PROJECT SWITCH'),
    false,
  );
  const next = await api('createProject', {
    mode: 'local',
    parent: root,
    name: 'Other project',
  });
  assert.ok((await original()).includes('SAVE BEFORE PROJECT SWITCH'));
  assert.equal((await diskObjects()).length, 1);
  assert.equal((await api('getWorkspace')).root, next.root);
  assert.equal(next.root, path.join(root, 'Other project'));
  assert.deepEqual(await api('listDrawings'), []);
  await api('openProject', projectId(game));
  assert.equal((await api('getUndoState')).undo, null);
  console.log(
    'PASS: opening another project flushed the previous original and left the target project intact',
  );
}

async function recovery() {
  await boot();
  await pen();
  await wait('!!document.querySelector(".drawing-input-layer--pen")');
  await stroke(0);
  await currentCount(1);
  const [visible] = await api('listDrawings');
  const draftKey = `game-canvas-drawing-batch:${game}`;
  await delay(25_000);
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(draftKey)}).then(Boolean)`,
  );
  await assert.rejects(fs.stat(drawingFile), { code: 'ENOENT' });
  await stop();

  await boot();
  const recover = `[...document.querySelectorAll('.drawing-save-alert button')].find(button => button.textContent.trim() === '초안 복구' && button.getClientRects().length)`;
  await wait(`!!(${recover})`);
  await js(`(${recover}).click()`);
  await currentCount(1);
  assert.deepEqual(await api('listDrawings'), [visible]);
  await assert.rejects(fs.stat(drawingFile), { code: 'ENOENT' });
  await key('s', 'KeyS', 83, 2);
  await expectBatches(1);
  await wait(
    `window.gameCanvas.getEditorDraft(${JSON.stringify(draftKey)}).then(draft => !draft)`,
  );
  console.log(
    'PASS: a completed in-memory stroke recovered after a crash from its 30-second checkpoint',
  );
}

async function aiInputs() {
  const bin = path.join(root, 'mock-bin');
  const cli = path.join(bin, 'node_modules/@anthropic-ai/claude-code/cli.js');
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(
    path.join(bin, 'claude.cmd'),
    '@echo off\r\nexit /b 1\r\n',
  );
  await fs.writeFile(
    cli,
    `
const fs = require('node:fs');
const path = require('node:path');
const matter = require(${JSON.stringify(path.resolve('node_modules/gray-matter'))});
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('0.0.1 idle-save-fixture'); process.exit(0); }
if (args.includes('--help')) { console.log('--restricted --strict-mcp-config --tools --output-format'); process.exit(0); }
if (args[0] === 'auth') process.exit(0);
if (!args.includes('--print')) process.exit(2);
let input = '';
process.stdin.on('data', (chunk) => input += chunk);
process.stdin.on('end', () => {
  if (!fs.readFileSync(${JSON.stringify(note)}, 'utf8').includes('VISIBLE BEFORE AI')) throw Error('AI received stale Markdown');
  const task = input.match(/at (\\.ai\\/tasks\\/[^\\n]+\\.md)\\./)?.[1];
  if (!task) throw Error('Missing task scope');
  for (const file of matter(fs.readFileSync(task, 'utf8')).data.expected_outputs) {
    if (!file.startsWith('output/') || !file.endsWith('.html')) throw Error('Invalid fixture output');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '<!doctype html><meta charset="utf-8"><title>Latest material</title><p>AI received latest local material</p>');
  }
  console.log(JSON.stringify({ type: 'result', is_error: false, result: 'Verified the latest local material' }));
});
`,
  );
  await boot(true, {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
  });
  const status = await api('getAiStatus', 'claude-cli');
  assert.match(status.version, /idle-save-fixture/);
  assert.ok(status.available && status.authenticated);
  const task = await api('createTask', {
    kind: 'implement',
    queueVersion: 1,
    inputPaths: [note],
    htmlResult: { mode: 'new' },
    resultName: 'Latest material',
    x: 980,
    y: 180,
  });
  await openMemo();
  await typeMemo(' VISIBLE BEFORE AI');
  assert.equal((await original()).includes('VISIBLE BEFORE AI'), false);
  const started = await api('startCodexRun', {
    queueVersion: 1,
    providerId: 'claude-cli',
    modelId: null,
    taskPath: task.relativePath,
  });
  assert.ok((await original()).includes('VISIBLE BEFORE AI'));
  await wait(
    `window.gameCanvas.listAiQueue().then(items => items.some(item => item.runId === ${JSON.stringify(started.runId)} && item.status === 'completed'))`,
  );
  console.log(
    'PASS: a packaged mock AI CLI read the latest local Markdown after the run boundary',
  );
}

try {
  await fixture();
  if (process.argv.includes('--idle')) await autoIdle();
  else if (process.argv.includes('--switch')) await projectSwitch();
  else if (process.argv.includes('--recovery')) await recovery();
  else if (process.argv.includes('--ai')) await aiInputs();
  else await manualAndUndo();
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
