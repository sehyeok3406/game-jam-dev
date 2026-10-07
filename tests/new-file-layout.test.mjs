import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { verticalLayouts, NEW_FILE_GAP } from '../src/canvas-placement.ts';
import { layoutNewDocuments } from '../src/new-document-layout.ts';
import {
  readNewFileIndicators,
  updateNewFileIndicators,
} from '../src/new-file-indicators.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const md = (id, data = {}) =>
  matter.stringify('body', {
    id,
    title: id,
    type: 'system',
    status: 'draft',
    sources: [],
    x: 120,
    y: 120,
    width: 340,
    height: 300,
    ...data,
  });
const assertColumn = (cards) =>
  cards.forEach((card, index) => {
    assert.equal(card.x, cards[0].x);
    if (index)
      assert.ok(
        card.y >= cards[index - 1].y + cards[index - 1].height + NEW_FILE_GAP,
      );
  });

test('vertical placement honors variable heights and moves past existing cards without moving them', () => {
  const occupied = [
    { x: 120, y: 120, width: 340, height: 300 },
    { x: 120, y: 520, width: 720, height: 520 },
  ];
  const initial = structuredClone(occupied);
  const layouts = verticalLayouts(
    [
      { width: 340, height: 300 },
      { width: 340, height: 650 },
      { width: 720, height: 520 },
    ],
    occupied,
    { x: 120, y: 120 },
  );
  assertColumn(layouts);
  assert.equal(layouts[0].y, 1080);
  assert.deepEqual(occupied, initial);
});

test('AI output coordinates are replaced with a persisted column while updates keep user geometry and content', () => {
  const before = {
    'ideas/input.md': md('input'),
    'docs/existing.md': md('old', {
      x: 750,
      y: 880,
      width: 460,
      height: 610,
      collapsed: true,
    }),
  };
  const normalized = layoutNewDocuments(
    before,
    {
      'docs/overview.md': md('overview'),
      'docs/systems.md': md('systems', { height: 620 }),
      'docs/questions.md': md('questions'),
      'docs/existing.md': md('old', {
        x: 0,
        y: 0,
        width: 340,
        height: 300,
        title: 'updated title',
      }),
      'output/index.html': '<html><body>game</body></html>',
    },
    { x: 120, y: 120 },
  );
  const cards = ['overview', 'systems', 'questions'].map(
    (name) => matter(normalized[`docs/${name}.md`]).data,
  );
  assertColumn(cards);
  assert.ok(cards[0].y >= 460);
  const existing = matter(normalized['docs/existing.md']);
  assert.equal(existing.data.x, 750);
  assert.equal(existing.data.y, 880);
  assert.equal(existing.data.width, 460);
  assert.equal(existing.data.height, 610);
  assert.equal(existing.data.collapsed, true);
  assert.equal(existing.data.title, 'updated title');
  assert.equal(existing.content.trim(), 'body');
  assert.match(normalized['output/index.html'], /game/);
  assert.equal(matter(before['ideas/input.md']).data.y, 120);
});

test('mixed HTML and Markdown imports share one vertical column with room for each preview', () => {
  const next = reduceCollaboration({}, 'files:import-batch', {
    files: [
      { name: 'a.md', content: '# A' },
      { name: 'b.html', content: '<html><body>B</body></html>' },
      { name: 'c.md', content: '# C' },
      { name: 'd.html', content: '<html><body>D</body></html>' },
    ],
    x: 100,
    y: 100,
    imagePurpose: 'asset',
  }).files;
  const cards = Object.entries(next)
    .filter(([key]) => key.endsWith('.md'))
    .map(([, raw]) => matter(raw).data);
  assertColumn(cards);
  assert.deepEqual(
    cards.map((card) => card.height),
    [320, 520, 320, 520],
  );
});

test('repeated manual note creation at the same point makes a column', () => {
  let files = {};
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const next = reduceCollaboration(files, 'documents:create-idea', {
      x: 120,
      y: 120,
    });
    cards.push(next.result);
    files = next.files;
  }
  assertColumn(cards);
});

test('new file glow survives reload, ignores updates and moves, and never returns after acknowledgment', () => {
  const baseline = updateNewFileIndicators(undefined, ['old']);
  assert.deepEqual(baseline.unread, []);
  let state = updateNewFileIndicators(baseline, [
    'old',
    'doc',
    'preview:old-path',
  ]);
  assert.deepEqual(state.unread, ['doc', 'preview:old-path']);
  state = updateNewFileIndicators(
    readNewFileIndicators(JSON.stringify(state)),
    ['old', 'doc', 'preview:new-path'],
    { 'preview:old-path': 'preview:new-path' },
  );
  assert.deepEqual(state.unread, ['doc', 'preview:new-path']);
  state = { ...state, unread: state.unread.filter((id) => id !== 'doc') };
  state = updateNewFileIndicators(state, ['old', 'doc', 'preview:new-path']);
  assert.deepEqual(state.unread, ['preview:new-path']);
  state = updateNewFileIndicators(state, ['old', 'doc']);
  assert.deepEqual(state.unread, []);
  assert.equal(readNewFileIndicators('broken'), undefined);
  assert.equal(readNewFileIndicators('{"known":[{}],"unread":[]}'), undefined);
});

test('collaboration publication assigns identical vertical positions to owner, teammate and reopened server', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'new-result-layout-'));
  let server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'fixture',
  });
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    'fixture',
    'owner',
    'layout',
    { 'ideas/input.md': md('input') },
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    created.credentials.serverUrl,
    created.result.code,
    'teammate',
  );
  const teammate = new CollaborationClient(joined.credentials, () => {});
  teammate.accept(joined.result);
  clients.push(teammate);
  const task = await owner.command('tasks:create', {
    kind: 'organize',
    inputPaths: ['ideas/input.md'],
    x: 120,
    y: 120,
    documentResult: { mode: 'new' },
  });
  const outputs = matter(owner.files[task.relativePath]).data.expected_outputs;
  await owner.beginAi(task.relativePath);
  await owner.finishAi(
    'completed',
    Object.fromEntries(
      outputs.map((relative, index) => [
        relative,
        md(`new-${index}`, {
          sources: [{ id: 'input' }],
          height: index === 1 ? 620 : 300,
        }),
      ]),
    ),
  );
  await teammate.refresh();
  const expected = outputs.map(
    (relative) => matter(owner.files[relative]).data,
  );
  assertColumn(expected);
  assert.ok(expected[0].y >= 460);
  assert.deepEqual(
    outputs.map((relative) => matter(teammate.files[relative]).data),
    expected,
  );
  owner.stop();
  teammate.stop();
  await server.close();
  server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'fixture',
  });
  const reopened = new CollaborationClient(
    { ...created.credentials, serverUrl: `http://127.0.0.1:${server.port}` },
    () => {},
  );
  clients.push(reopened);
  await reopened.refresh();
  assert.deepEqual(
    outputs.map((relative) => matter(reopened.files[relative]).data),
    expected,
  );
});
