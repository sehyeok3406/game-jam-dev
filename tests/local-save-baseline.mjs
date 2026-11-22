import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractAll, extractFile } from '@electron/asar';
import electron from 'electron';
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

const clock = () => performance.timeOrigin + performance.now();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const out = path.resolve('out/local-save-baseline', path.basename(root));
const tracePath = path.join(out, 'trace.json');
const archive = path.resolve('out/Game Jam!-win32-x64/resources/app.asar');
const electronVersion = (
  await fs.readFile(
    path.join(path.dirname(path.dirname(archive)), 'version'),
    'utf8',
  )
).trim();
const appPath = path.join(root, 'instrumented');
const memo = 'ideas/baseline-memo.md';
const ink = '.canvas/drawings/ink.json';
const bursts = 6;
const strokeDistance = 240;
const windows = {};

async function prepare() {
  await fs.mkdir(out, { recursive: true });
  const main = path.join('.vite', 'build', 'main.cjs');
  assert.deepEqual(extractFile(archive, main), await fs.readFile(main));
  const electronDependency = JSON.parse(
    await fs.readFile('node_modules/electron/package.json', 'utf8'),
  );
  assert.equal(electronVersion, electronDependency.version);
  const packagedManifest = JSON.parse(extractFile(archive, 'package.json'));
  extractAll(archive, appPath);
  const bridge = 'baseline-main.cjs';
  await fs.copyFile(
    new URL('./helpers/local-save-baseline-main.cjs', import.meta.url),
    path.join(appPath, bridge),
  );
  await fs.writeFile(
    path.join(appPath, 'package.json'),
    JSON.stringify({ ...packagedManifest, main: bridge }),
  );

  for (const folder of ['ideas', 'sections', 'output/versions', '.canvas'])
    await fs.mkdir(path.join(game, folder), { recursive: true });
  await fs.writeFile(
    path.join(game, '.canvas/canvases.json'),
    JSON.stringify({
      version: 1,
      canvases: [
        { id: 'default', name: '기준 메모' },
        { id: 'ink', name: '기준 그림' },
        { id: 'archive', name: '기준 자료' },
      ],
    }),
  );
  await fs.writeFile(
    path.join(game, 'project.md'),
    '---\nid: project\ncanvas_id: archive\n---\n# Baseline project\n',
  );
  await fs.writeFile(
    path.join(game, 'sections/archive.md'),
    '---\nid: archive\ntype: section\ncanvas_id: archive\n---\n# Baseline section\n',
  );
  await fs.writeFile(
    path.join(game, memo),
    '---\nid: baseline-memo\ntitle: Baseline memo\ntype: idea\nx: 60\ny: 60\nwidth: 440\nheight: 380\n---\nBASELINE MEMO\n',
  );
  await Promise.all(
    Array.from({ length: 120 }, (_, index) =>
      fs.writeFile(
        path.join(game, `ideas/archive-${index}.md`),
        `---\nid: archive-${index}\ntitle: Archive ${index}\ntype: idea\ncanvas_id: archive\nx: ${(index % 10) * 420}\ny: ${Math.floor(index / 10) * 340}\n---\n` +
          '\nExample paragraph for a synthetic project.\n'.repeat(18),
      ),
    ),
  );
  await Promise.all(
    [
      'output/index.html',
      ...[1, 2, 3, 4].map((n) => `output/versions/v${n}.html`),
    ].map((filename) =>
      fs.writeFile(
        path.join(game, filename),
        '<!doctype html><meta charset="utf-8"><title>Baseline result</title><p>Synthetic result</p>',
      ),
    ),
  );
}

async function observe(name, condition) {
  return js(`(() => {
    const measures = window.localSaveBaseline ??= {};
    delete measures[${JSON.stringify(name)}];
    const check = () => {
      if (!(${condition})) return;
      measures[${JSON.stringify(name)}] = performance.timeOrigin + performance.now();
      observer.disconnect();
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    check();
  })()`);
}

async function observed(name) {
  await wait(`!!window.localSaveBaseline?.[${JSON.stringify(name)}]`);
  return js(`window.localSaveBaseline[${JSON.stringify(name)}]`);
}

async function expectSaved(relative, matches) {
  const absolute = path.join(game, relative);
  for (let attempt = 0; attempt < 100; attempt++) {
    const raw = await fs.readFile(absolute, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (raw !== null && matches(raw)) return;
    await delay(30);
  }
  throw Error(`Original file was not saved: ${relative}`);
}

function selectTab(label) {
  return js(
    `[...document.querySelectorAll('[role=tab]')].find(tab => tab.textContent.includes(${JSON.stringify(label)})).click()`,
  );
}

function pointer(type, x, y) {
  return send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
}

async function drawStroke(index) {
  const startX = 410;
  const startY = 280 + index * 48;
  await pointer('mousePressed', startX, startY);
  for (let i = 1; i <= 8; i++) {
    await delay(55);
    await pointer(
      'mouseMoved',
      startX + (i * strokeDistance) / 8,
      startY + i * 2,
    );
  }
  const release = clock();
  await pointer('mouseReleased', startX + strokeDistance, startY + 16);
  return release;
}

async function measure() {
  await boot(
    true,
    {
      ...process.env,
      GC_BASELINE_PROJECT: game,
      GC_BASELINE_PROFILE: profile,
      GC_BASELINE_TRACE: tracePath,
      NODE_PATH: path.resolve('node_modules'),
    },
    { executable: electron, appArgs: [appPath] },
  );
  await wait(
    `!!document.querySelector('.react-flow__node[data-id="baseline-memo"]')`,
  );
  const center = await js(`(() => {
    const box = document.querySelector('.react-flow__node[data-id="baseline-memo"]').getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    ...center,
    deltaX: 0,
    deltaY: -950,
  });
  await js(
    `document.querySelector('[data-id="baseline-memo"] .file-node-surface')?.click()`,
  );
  await wait(`!!document.querySelector('.document-card__content')`);
  await delay(650);

  await js(`document.querySelector('.document-card__content').click()`);
  await wait(`!!document.querySelector('.tiptap[contenteditable="true"]')`);
  await js(`document.querySelector('.tiptap[contenteditable="true"]').focus()`);
  await observe(
    'memo',
    `document.querySelector('.tiptap')?.textContent.includes('LOCAL-CHANGE')`,
  );
  const memoStart = clock();
  await send('Input.insertText', { text: ' LOCAL-CHANGE' });
  const memoVisible = await observed('memo');
  await delay(Math.max(0, 1900 - (clock() - memoStart)));
  windows.memo = {
    start: memoStart,
    end: clock(),
    actions: [{ start: memoStart, visible: memoVisible }],
    originalPath: memo,
  };

  await key('s', 'KeyS', 83, 2);
  await expectSaved(memo, (raw) => raw.includes('LOCAL-CHANGE'));
  await key('Enter', 'Enter', 13, 2);
  await wait(`!document.querySelector('.tiptap[contenteditable="true"]')`);
  await selectTab('기준 그림');
  await wait(
    `document.querySelectorAll('.react-flow__node-document').length === 0`,
  );
  await key('p', 'KeyP', 80, 8);
  await wait(`!!document.querySelector('.drawing-input-layer--pen')`);
  await drawStroke(0);
  await wait(`document.querySelectorAll('.canvas-drawing-node').length === 1`);
  await key('s', 'KeyS', 83, 2);
  await expectSaved(ink, (raw) => JSON.parse(raw).objects.length === 1);
  await delay(700);

  const strokes = [];
  const burstStart = clock();
  for (let i = 1; i <= bursts; i++) {
    await observe(
      'ink',
      `document.querySelectorAll('.canvas-drawing-node').length === ${i + 1}`,
    );
    await wait(`!!document.querySelector('.drawing-input-layer--pen')`);
    const start = await drawStroke(i);
    strokes.push({ start, visible: await observed('ink') });
  }
  await delay(850);
  windows.pen = {
    start: burstStart,
    end: clock(),
    actions: strokes,
    originalPath: ink,
  };

  await observe(
    'undo',
    `document.querySelectorAll('.canvas-drawing-node').length === ${bursts}`,
  );
  const undoStart = clock();
  await key('z', 'KeyZ', 90, 2);
  const undoVisible = await observed('undo');
  await delay(750);
  windows.undo = {
    start: undoStart,
    end: clock(),
    actions: [{ start: undoStart, visible: undoVisible }],
    originalPath: ink,
  };

  await key('s', 'KeyS', 83, 2);
  await expectSaved(ink, (raw) => JSON.parse(raw).objects.length === bursts);
  await selectTab('기준 메모');
  await wait(`!!document.querySelector('.document-card__content')`);
  await delay(650);
  await observe(
    'external',
    'document.body.textContent.includes("EXTERNAL-CHANGE")',
  );
  const raw = await fs.readFile(path.join(game, memo), 'utf8');
  const externalStart = clock();
  await fs.writeFile(path.join(game, memo), raw + '\n\nEXTERNAL-CHANGE\n');
  const externalCommit = clock();
  const externalVisible = await observed('external');
  await delay(750);
  windows.external = {
    start: externalStart,
    end: clock(),
    actions: [
      { start: externalStart, visible: externalVisible, externalCommit },
    ],
  };
}

function collect(events, window) {
  const scoped = events.filter(
    (event) => event.start >= window.start && event.start < window.end,
  );
  const successful = scoped.filter((event) => event.ok);
  const count = (predicate) => successful.filter(predicate).length;
  const channel = (name) => count((event) => event.channel === name);
  const history = (filename) =>
    /^\.(?:history|gamejam\/local\/history)\//.test(filename);
  const read = (predicate) =>
    count(
      (event) =>
        event.scope === 'project' &&
        event.method === 'readFile' &&
        !history(event.path) &&
        predicate(event.path),
    );
  const write = (scope, predicate) =>
    count(
      (event) =>
        event.scope === scope &&
        event.method === 'writeFile' &&
        predicate(event.path),
    );
  const commits = successful
    .filter(
      (event) =>
        event.scope === 'project' &&
        event.method === 'rename' &&
        event.destination === window.originalPath,
    )
    .map((event) => event.end);
  const markdownReadsByCaller = {};
  for (const event of successful) {
    if (
      event.scope === 'project' &&
      event.method === 'readFile' &&
      !history(event.path) &&
      event.path.endsWith('.md')
    ) {
      const caller = event.caller ?? '(watch or background)';
      markdownReadsByCaller[caller] = (markdownReadsByCaller[caller] ?? 0) + 1;
    }
  }
  const ms = (value) => Math.round(value * 10) / 10;
  return {
    lists: {
      markdown: channel('documents:list'),
      sections: channel('sections:list'),
      html: channel('preview:list'),
      drawings: channel('drawings:changes') + channel('drawings:list'),
    },
    reads: {
      memo: read((name) => name === memo),
      otherMarkdown: read((name) => name !== memo && name.endsWith('.md')),
      drawings: read(
        (name) => name.includes('/drawings/') && name.endsWith('.json'),
      ),
      html: read((name) => name.endsWith('.html')),
    },
    writes: {
      draft: write('profile', (name) => name.startsWith('editor-drafts/')),
      queue: write('profile', (name) =>
        name.startsWith('document-save-queue/'),
      ),
      original: commits.length,
      historySnapshots: write(
        'project',
        (name) => history(name) && /\/(?:before|after)\//.test(name),
      ),
      historyIndex: write(
        'project',
        (name) => history(name) && name.includes('/entry.json'),
      ),
      authorship: write('project', (name) => /authorship\.json/.test(name)),
    },
    markdownReadsByCaller,
    displayMs: window.actions.map(({ start, visible }) => ms(visible - start)),
    commitMs: window.actions.map(({ start, externalCommit }, index) => {
      const until = window.actions[index + 1]?.start ?? window.end;
      const commit =
        externalCommit ?? commits.find((time) => time >= start && time < until);
      return commit === undefined ? null : ms(commit - start);
    }),
  };
}

try {
  await prepare();
  await measure();
  await stop(true);
  const trace = JSON.parse(await fs.readFile(tracePath, 'utf8'));
  const git = (...args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      windowsHide: true,
    }).trimEnd();
  const commit = git('rev-parse', 'HEAD');
  const sourceChanges = git('status', '--short', '--', 'src')
    .split(/\r?\n/)
    .filter(Boolean);
  const archiveSha256 = createHash('sha256')
    .update(await fs.readFile(archive))
    .digest('hex');
  const result = {
    commit,
    sourceChanges,
    archiveSha256,
    electronVersion,
    fixtures: {
      markdown: 122,
      sections: 1,
      html: 5,
      warmupStrokes: 1,
      measuredStrokes: bursts,
    },
    scenarios: Object.fromEntries(
      Object.entries(windows).map(([name, range]) => [
        name,
        collect(trace, range),
      ]),
    ),
    windows,
  };
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(out, JSON.stringify(result.scenarios, null, 2));
} catch (error) {
  if (js)
    console.error(
      await js(
        `({canvas: [...document.querySelectorAll('[role=tab]')].map(tab => tab.textContent), body: document.body.innerText.slice(-600), editing: !!document.querySelector('.tiptap'), drawings: document.querySelectorAll('.canvas-drawing-node').length})`,
      ).catch(() => null),
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
