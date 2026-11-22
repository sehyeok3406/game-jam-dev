import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

const active = path.join(game, 'ideas/active.md');
const other = path.join(game, 'ideas/other.md');
const input = '[data-id="active"] .tiptap';
const fixture = (id, title, y, body) =>
  `---\nid: ${id}\ntitle: ${title}\ntype: idea\nx: 80\ny: ${y}\nwidth: 360\nheight: 240\n---\n${body}\n`;

try {
  await fs.mkdir(path.dirname(active), { recursive: true });
  await fs.mkdir(path.join(game, 'output'), { recursive: true });
  await fs.writeFile(
    active,
    fixture('active', 'Active memo', 140, 'Original draft base'),
  );
  await fs.writeFile(
    other,
    fixture('other', 'Other memo', 450, 'Other original body'),
  );
  await fs.writeFile(
    path.join(game, 'output/index.html'),
    '<!doctype html><title>Running preview</title><p>Running preview</p>',
  );

  await boot();
  await wait(
    `!!document.querySelector('[data-id="active"] .file-node-surface')`,
  );
  await js(
    `document.querySelector('[data-id="active"] .file-node-surface').click()`,
  );
  await wait(
    `!!document.querySelector('[data-id="active"] .document-card__content')`,
  );

  await js(`document.querySelector('.file-node-surface--html').focus()`);
  await key('Enter', 'Enter', 13);
  await wait(`!!document.querySelector('.preview-card iframe')`);
  await js(
    `document.querySelector('[data-id="active"] .document-card__content').click()`,
  );
  await wait(
    `document.activeElement === document.querySelector(${JSON.stringify(input)})`,
  );
  await js(`window.refreshFixture = {
    editor: document.querySelector(${JSON.stringify(input)}),
    frame: document.querySelector('.preview-card iframe'), changes: [],
  };
  window.gameCanvas.onWorkspaceChanged(change => window.refreshFixture.changes.push(change ?? null));`);

  await fs.writeFile(
    other,
    fixture('other', 'Other memo', 450, 'External change to another memo'),
  );
  await wait(
    `document.querySelector('[data-id="other"]')?.textContent.includes('External change to another memo')`,
  );
  assert.equal(
    await js(`window.refreshFixture.editor === document.activeElement &&
    window.refreshFixture.frame === document.querySelector('.preview-card iframe')`),
    true,
  );
  assert.deepEqual(
    await js(
      'window.refreshFixture.changes.map(change => change?.paths ?? null)',
    ),
    [['ideas/other.md']],
  );

  await send('Input.insertText', { text: ' UNFINISHED-LOCAL-TEXT' });
  await fs.writeFile(
    active,
    fixture('active', 'Active memo', 140, 'EXTERNAL-DRAFT-BASE'),
  );
  await key('s', 'KeyS', 83, 2);
  await wait(`window.gameCanvas.getDocumentSaveStates().then(states =>
    states.some(state => state.documentId === 'active' && state.phase === 'conflict'))`);
  assert.match(
    await js(`document.querySelector(${JSON.stringify(input)}).textContent`),
    /UNFINISHED-LOCAL-TEXT/,
  );
  const onDisk = await fs.readFile(active, 'utf8');
  assert.match(onDisk, /EXTERNAL-DRAFT-BASE/);
  assert.doesNotMatch(onDisk, /UNFINISHED-LOCAL-TEXT/);

  await fs.writeFile(
    other,
    fixture(
      'replacement',
      'Replacement memo',
      450,
      'Different document identity',
    ),
  );
  await wait(
    `!!document.querySelector('[data-id="replacement"]') && !document.querySelector('[data-id="other"]')`,
  );
  console.log(
    'PASS: external Markdown refresh keeps another editor and iframe, detects a draft conflict, and refreshes a replaced document identity',
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
