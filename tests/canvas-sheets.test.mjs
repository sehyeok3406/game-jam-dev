import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { CANVAS_SHEETS_PATH, readCanvasSheets } from '../src/canvas-sheets.ts';
import {
  checkSnapshot,
  reduceCollaboration,
  snapshotDocuments,
  snapshotSections,
} from '../src/collaboration-model.ts';
import { layoutNewDocuments } from '../src/new-document-layout.ts';
import { captureProject, materialize } from '../src/project-store.ts';
import { describePreview, htmlSourcePath } from '../src/html-source.ts';
import { taskFileLock, assertAiMutation } from '../src/ai-file-lock.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const md = (id, canvas, extra = {}) =>
  matter.stringify(`\n${id} 원본 내용\n`, {
    id,
    title: id,
    type: 'idea',
    status: 'draft',
    x: 0,
    y: 0,
    width: 340,
    height: 300,
    sources: [],
    ...(canvas ? { canvas_id: canvas } : {}),
    ...extra,
  });
const html = 'output/systems/combat/v001/index.html';
const initial = () => ({
  'project.md': md('project'),
  'ideas/a.md': md('a'),
  'ideas/b.md': md('b'),
  [html]: '<!doctype html><html><body>combat</body></html>',
});
const change = (files, input) =>
  reduceCollaboration(files, 'canvases:change', {
    expected: files[CANVAS_SHEETS_PATH] ?? null,
    ...input,
  }).files;
const add = (files, id = 'combat') =>
  change(files, { action: 'add', id, name: '전투' });

test('legacy projects retain paths/content/layout; registry snapshot survives disk capture and malformed membership is rejected', async (t) => {
  const before = initial();
  assert.equal(readCanvasSheets().canvases[0].id, 'default');
  assert.ok(
    snapshotDocuments(before).every((doc) => doc.canvasId === 'default'),
  );
  const next = add(before);
  for (const key of Object.keys(before)) assert.equal(next[key], before[key]);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-canvas-sheets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await materialize(root, next);
  assert.deepEqual(await captureProject(root), next);
  assert.throws(
    () => checkSnapshot({ ...next, 'ideas/a.md': md('a', 'missing') }),
    /캔버스/,
  );
  assert.throws(
    () =>
      readCanvasSheets(
        JSON.stringify({
          version: 1,
          canvases: [
            { id: 'x', name: 'a' },
            { id: 'x', name: 'b' },
          ],
        }),
      ),
    /ID/,
  );
  assert.throws(
    () =>
      change(next, {
        action: 'rename',
        id: 'combat',
        name: 'x',
        expected: null,
      }),
    /팀원/,
  );
  assert.throws(
    () =>
      change(next, {
        action: 'reorder',
        id: 'combat',
        order: ['combat', 'combat'],
      }),
    /순서/,
  );
});

test('section moves are atomic, child moves detach, cross-canvas section attachment fails, and canvas deletion preserves every file', () => {
  let files = add(initial());
  const section = reduceCollaboration(files, 'sections:create', {
    canvasId: 'default',
    title: 'group',
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    members: [
      { id: 'a', path: 'ideas/a.md' },
      { id: 'b', path: 'ideas/b.md' },
    ],
  });
  files = section.files;
  const originalBodies = Object.fromEntries(
    Object.entries(files)
      .filter(([key]) => key.endsWith('.md'))
      .map(([key, raw]) => [key, matter(raw).content]),
  );
  files = change(files, {
    action: 'move',
    id: 'default',
    targetId: 'combat',
    paths: [section.result.relativePath, html],
  });
  for (const doc of snapshotDocuments(files).filter((doc) =>
    ['a', 'b'].includes(doc.id),
  ))
    assert.equal(doc.canvasId, 'combat');
  assert.equal(snapshotSections(files)[0].canvasId, 'combat');
  assert.equal(describePreview(files, html).canvasId, 'combat');
  assert.equal(files[html], initial()[html]);
  files = change(files, {
    action: 'move',
    id: 'combat',
    targetId: 'default',
    paths: ['ideas/a.md'],
  });
  assert.deepEqual(snapshotSections(files)[0].members, [
    { id: 'b', path: 'ideas/b.md' },
  ]);
  assert.throws(
    () =>
      reduceCollaboration(files, 'sections:move-document', {
        documentPath: 'ideas/a.md',
        targetSectionId: section.result.id,
        x: 1,
        y: 1,
        width: 340,
        height: 300,
      }),
    /다른 캔버스/,
  );
  files = change(files, {
    action: 'delete',
    id: 'default',
    targetId: 'combat',
  });
  for (const [key, body] of Object.entries(originalBodies))
    assert.equal(matter(files[key]).content, body);
  assert.equal(readCanvasSheets(files[CANVAS_SHEETS_PATH]).canvases.length, 1);
  assert.ok(snapshotDocuments(files).every((doc) => doc.canvasId === 'combat'));
  assert.throws(
    () => change(files, { action: 'delete', id: 'combat', targetId: 'combat' }),
    /다른 캔버스|마지막/,
  );
  checkSnapshot(files);
});

test('creation/import/AI placement uses only the destination canvas; updates preserve ownership and AI rejects moving its materials', () => {
  let files = add(initial());
  const note = reduceCollaboration(files, 'documents:create-idea', {
    canvasId: 'combat',
    x: 0,
    y: 0,
  });
  files = note.files;
  assert.equal(note.result.y, 0);
  assert.equal(note.result.canvasId, 'combat');
  const imported = reduceCollaboration(files, 'files:import-batch', {
    canvasId: 'combat',
    x: 0,
    y: 0,
    imagePurpose: 'asset',
    files: [
      { name: 'growth.html', content: '<html><body>growth</body></html>' },
    ],
  });
  files = imported.files;
  assert.equal(imported.result[0].canvasId, 'combat');
  const task = reduceCollaboration(files, 'tasks:create', {
    canvasId: 'combat',
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new' },
  });
  files = task.files;
  assert.equal(
    matter(files[task.result.relativePath]).data.canvas_id,
    'combat',
  );
  const lock = taskFileLock(files, task.result.relativePath);
  const moved = change(files, {
    action: 'move',
    id: 'default',
    targetId: 'combat',
    paths: ['ideas/a.md'],
  });
  assert.throws(() => assertAiMutation(lock, files, moved), /AI 작업/);
  const removed = change(files, {
    action: 'delete',
    id: 'combat',
    targetId: 'default',
  });
  assert.throws(() => assertAiMutation(lock, files, removed), /AI 작업/);
  const output = matter(files[task.result.relativePath]).data
    .expected_outputs[0];
  const changes = layoutNewDocuments(
    files,
    {
      [output]: '<html><body>result</body></html>',
      'docs/new.md': md('new', 'forged'),
    },
    { canvasId: 'combat', x: 0, y: 0 },
    true,
  );
  assert.equal(
    describePreview({ ...files, ...changes }, output).canvasId,
    'combat',
  );
  assert.equal(matter(changes['docs/new.md']).data.canvas_id, 'combat');
  assert.ok(matter(changes['docs/new.md']).data.y >= 340);
  const updated = layoutNewDocuments(
    files,
    { 'ideas/a.md': md('a', 'forged') },
    { canvasId: 'combat', x: 0, y: 0 },
  );
  assert.equal(
    matter(updated['ideas/a.md']).data.canvas_id ?? 'default',
    'default',
  );
});

test('shared canvases synchronize, fence stale/legacy edits, inherit roles, undo atomically, preserve unrelated edits and survive restart', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'game-canvas-sheet-server-'),
  );
  let server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'fixture',
  });
  const url = `http://127.0.0.1:${server.port}`;
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const created = await CollaborationClient.create(
    url,
    'fixture',
    'owner',
    'sheets',
    initial(),
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'editor',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  clients.push(editor);
  assert.equal(editor.state.canvasSheets, true);
  const command = { action: 'add', id: 'combat', name: '전투', expected: null };
  await owner.command('canvases:change', command);
  await assert.rejects(
    editor.command('canvases:change', { ...command, id: 'shop' }),
    /팀원|최신/,
  );
  await editor.refresh();
  await assert.rejects(
    owner.request('command', {
      id: randomUUID(),
      channel: 'documents:create-idea',
      input: { x: 0, y: 0 },
      revisions: owner.revisions,
    }),
    /v0.11.0/,
  );
  await editor.command('canvases:change', {
    action: 'move',
    id: 'default',
    targetId: 'combat',
    paths: ['ideas/a.md', html],
    expected: editor.files[CANVAS_SHEETS_PATH],
  });
  const moveId = editor.lastCommandHistoryId;
  await owner.refresh();
  const parallel = await owner.command('documents:create-idea', {
    canvasId: 'default',
    x: 0,
    y: 0,
  });
  await editor.refresh();
  await editor.changeHistory(moveId, 'undo');
  await owner.refresh();
  assert.equal(
    snapshotDocuments(owner.files).find((doc) => doc.id === 'a').canvasId,
    'default',
  );
  assert.ok(owner.files[parallel.relativePath]);
  await editor.changeHistory(moveId, 'redo');
  await owner.refresh();
  assert.equal(describePreview(owner.files, html).canvasId, 'combat');
  const viewerJoin = await CollaborationClient.join(
    url,
    created.result.code,
    'viewer',
  );
  const viewer = new CollaborationClient(viewerJoin.credentials, () => {});
  viewer.accept(viewerJoin.result);
  clients.push(viewer);
  await owner.setRole(viewer.state.memberId, 'viewer');
  await viewer.refresh();
  await assert.rejects(
    viewer.command('canvases:change', {
      action: 'rename',
      id: 'combat',
      name: 'viewer',
      expected: viewer.files[CANVAS_SHEETS_PATH],
    }),
    /편집|권한/,
  );
  await server.close();
  server = await createCollaborationServer({
    dataDirectory: root,
    port: Number(new URL(url).port),
    creationKey: 'fixture',
  });
  await owner.refresh();
  assert.equal(describePreview(owner.files, html).canvasId, 'combat');
  assert.equal(
    readCanvasSheets(owner.files[CANVAS_SHEETS_PATH]).canvases[1].name,
    '전투',
  );
  editor.state.connected = false;
  await assert.rejects(editor.command('canvases:change', command), /온라인/);
});

test('shared AI freezes destination across unrelated edits and prevents destination deletion while allowing new canvases', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'game-canvas-sheet-ai-'),
  );
  const server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'fixture',
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    'fixture',
    'owner',
    'AI sheets',
    initial(),
  );
  const client = new CollaborationClient(created.credentials, () => {});
  client.accept(created.result);
  t.after(async () => {
    client.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await client.command('canvases:change', {
    action: 'add',
    id: 'combat',
    name: '전투',
    expected: null,
  });
  await client.command('canvases:change', {
    action: 'delete',
    id: 'default',
    targetId: 'combat',
    expected: client.files[CANVAS_SHEETS_PATH],
  });
  const task = await client.command('tasks:create', {
    canvasId: 'combat',
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new' },
  });
  await assert.rejects(
    client.request('ai-start', {
      taskPath: task.relativePath,
      revision: client.state.revision,
    }),
    /v0.11.0/,
  );
  await client.beginAi(task.relativePath);
  await client.command('canvases:change', {
    action: 'add',
    id: 'shop',
    name: '상점',
    expected: client.files[CANVAS_SHEETS_PATH],
  });
  const note = await client.command('documents:create-idea', {
    canvasId: 'shop',
    x: 0,
    y: 0,
  });
  await assert.rejects(
    client.command('canvases:change', {
      action: 'delete',
      id: 'combat',
      targetId: 'shop',
      expected: client.files[CANVAS_SHEETS_PATH],
    }),
    /AI 작업/,
  );
  const output = matter(client.files[task.relativePath]).data
    .expected_outputs[0];
  await client.finishAi('completed', {
    [output]: '<html><body>combined</body></html>',
  });
  assert.equal(describePreview(client.files, output).canvasId, 'combat');
  assert.equal(
    snapshotDocuments(client.files).find(
      (doc) => doc.relativePath === note.relativePath,
    ).canvasId,
    'shop',
  );
  assert.ok(client.files[htmlSourcePath(output)]);
  checkSnapshot(client.files);
});
