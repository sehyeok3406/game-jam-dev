import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  nextPreviewPath,
  isPreviewPath,
  resultLocation,
  previewWindowPath,
} from '../src/preview-output.ts';
import {
  legacyResultMoves,
  relocateResults,
  resultMoves,
} from '../src/result-structure.ts';
import {
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import {
  moveResultFiles,
  resultFileBaseline,
} from '../src/result-file-moves.ts';
import {
  captureProject,
  materialize,
  applyChanges,
  saveHistory,
  restoreHistory,
} from '../src/project-store.ts';
import {
  htmlSourcePath,
  htmlSourceId,
  sourceMetadata,
} from '../src/html-source.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { encodeAsset } from '../src/file-assets.ts';
const html = '<!doctype html><html><body>combat</body></html>';
const md = (id, data = {}) =>
  matter.stringify('refs', {
    id,
    title: id,
    type: 'idea',
    status: 'draft',
    sources: [],
    ...data,
  });
const from = 'output/games/v2-combat/index.html';
const to = 'output/systems/combat/v002/index.html';
const fixture = () => ({
  'project.md': md('project'),
  [from]: html,
  [htmlSourcePath(from)]: sourceMetadata(from, html),
  'docs/spec.md': md('spec', {
    sources: [{ id: htmlSourceId(from), path: from }],
  }),
  '.ai/tasks/old.md': md('task', {
    expected_outputs: [from],
    base_html: from,
    stages: [{ outputs: [from] }],
  }),
});
test('restoring old HTML history keeps the current folder and immutable original history', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'result-restore-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = fixture(),
    updated = { ...before, [from]: html.replace('combat', 'changed') };
  await materialize(root, updated);
  await saveHistory(root, before, updated, {
    id: 'old-run',
    kind: 'ai',
    status: 'completed',
    label: 'old run',
    createdAt: Date.now(),
  });
  const moved = relocateResults(updated, [{ from, to }]);
  await moveResultFiles(root, updated, moved);
  await applyChanges(
    root,
    resultFileBaseline(updated, moved),
    Object.fromEntries(
      Object.keys({ ...updated, ...moved }).map((key) => [
        key,
        moved[key] ?? null,
      ]),
    ),
  );
  await restoreHistory(root, 'old-run', from, 'before');
  assert.equal(await fs.readFile(path.join(root, to), 'utf8'), html);
  await assert.rejects(fs.access(path.join(root, from)), { code: 'ENOENT' });
  assert.equal(
    await fs.readFile(path.join(root, '.history/old-run/after', from), 'utf8'),
    updated[from],
  );
});
test('structured paths validate categories, safe features and versions; reservations are per feature', () => {
  assert.equal(
    nextPreviewPath([], 'combat'),
    'output/inbox/combat/v001/index.html',
  );
  assert.equal(
    nextPreviewPath(['output/inbox/combat/v001/index.html'], 'combat'),
    'output/inbox/combat/v002/index.html',
  );
  assert.equal(
    nextPreviewPath(['output/inbox/combat/v099/index.html'], 'hud'),
    'output/inbox/hud/v001/index.html',
  );
  assert.equal(
    nextPreviewPath([to], undefined, to),
    'output/systems/combat/v003/index.html',
  );
  for (const value of [
    'output/systems/con/v001/index.html',
    'output/foo/combat/v001/index.html',
    'output/systems/../v001/index.html',
    'output/systems/combat/v000/index.html',
    'output/systems/combat/v01/index.html',
    'output/systems/combat/v0001/index.html',
    'output/systems/combat/v9007199254740992/index.html',
  ])
    assert.equal(isPreviewPath(value), false, value);
  assert.notEqual(
    previewWindowPath(to),
    previewWindowPath('output/content/combat/v002/index.html'),
  );
});
test('moves rewrite source identities and nested task references without changing HTML; catalog supports undo and redo', () => {
  const before = fixture();
  const after = reduceCollaboration(before, 'results:move', {
    relativePath: from,
    category: 'systems',
    feature: 'combat',
  }).files;
  checkSnapshot(after);
  assert.equal(after[from], undefined);
  assert.equal(after[to], html);
  assert.equal(matter(after[htmlSourcePath(to)]).data.html_source, to);
  assert.equal(matter(after[htmlSourcePath(to)]).data.id, htmlSourceId(to));
  assert.equal(
    matter(after['docs/spec.md']).data.sources[0].id,
    htmlSourceId(to),
  );
  assert.deepEqual(matter(after['.ai/tasks/old.md']).data.stages[0].outputs, [
    to,
  ]);
  assert.deepEqual(resultMoves(before, after), [{ from, to }]);
  assert.deepEqual(resultMoves(after, before), [{ from: to, to: from }]);
  assert.throws(
    () => relocateResults({ ...before, [to]: html }, [{ from, to }]),
    /사용 중/,
  );
  const organized = relocateResults(before, legacyResultMoves(before));
  assert.equal(
    resultLocation(Object.keys(organized).find(isPreviewPath)).category,
    'inbox',
  );
  assert.deepEqual(legacyResultMoves(organized), []);
});
test('physical migration keeps nested assets and window settings, and reverses both folder and legacy single-file moves', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'result-structure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await materialize(root, fixture());
  const owned = path.dirname(path.join(root, from));
  await fs.mkdir(path.join(owned, 'assets/nested'), { recursive: true });
  await fs.writeFile(path.join(owned, 'assets/nested/game.js'), 'combat()');
  await fs.writeFile(
    path.join(owned, 'assets/nested/image.png'),
    Buffer.from([0, 1, 255]),
  );
  await materialize(root, { [previewWindowPath(from)]: '{"x":123}' });
  const before = await captureProject(root);
  const after = relocateResults(before, [{ from, to }]);
  await moveResultFiles(root, before, after);
  await applyChanges(
    root,
    await captureProject(root),
    Object.fromEntries(
      Object.keys({ ...before, ...after }).map((key) => [
        key,
        after[key] ?? null,
      ]),
    ),
  );
  assert.deepEqual(await captureProject(root), after);
  assert.equal(
    await fs.readFile(
      path.join(path.dirname(path.join(root, to)), 'assets/nested/game.js'),
      'utf8',
    ),
    'combat()',
  );
  assert.equal(
    await fs.readFile(path.join(root, previewWindowPath(to)), 'utf8'),
    '{"x":123}',
  );
  await moveResultFiles(root, after, before);
  await applyChanges(
    root,
    resultFileBaseline(after, before),
    Object.fromEntries(
      Object.keys({ ...before, ...after }).map((key) => [
        key,
        before[key] ?? null,
      ]),
    ),
  );
  assert.ok(await fs.stat(owned));
  const single = 'output/versions/v3-old.html';
  await materialize(root, { [single]: html });
  const snapshot = await captureProject(root);
  const migrated = relocateResults(snapshot, legacyResultMoves(snapshot));
  const destination = legacyResultMoves(snapshot).find(
    (move) => move.from === single,
  ).to;
  await moveResultFiles(root, snapshot, migrated);
  assert.ok((await fs.stat(path.join(root, destination))).isFile());
  await moveResultFiles(root, migrated, snapshot);
  assert.ok((await fs.stat(path.join(root, single))).isFile());
});
test('all filesystem targets are checked before moving any folder', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'result-conflict-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = fixture(),
    after = relocateResults(before, [{ from, to }]);
  await materialize(root, before);
  await materialize(root, {
    [previewWindowPath(from)]: '{}',
    [previewWindowPath(to)]: 'external',
  });
  await assert.rejects(moveResultFiles(root, before, after), /이미/);
  assert.equal(await fs.readFile(path.join(root, from), 'utf8'), html);
  const legacy = 'output/versions/v3-old.html',
    destination = 'output/content/stage/v003/index.html';
  await materialize(root, { [legacy]: html });
  const original = await captureProject(root),
    moved = relocateResults(original, [{ from: legacy, to: destination }]);
  await fs.mkdir(path.dirname(path.join(root, destination)), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(path.dirname(path.join(root, destination)), 'external.keep'),
    'external',
  );
  await assert.rejects(moveResultFiles(root, original, moved), /이미/);
  assert.equal(await fs.readFile(path.join(root, legacy), 'utf8'), html);
});
test('shared moves synchronize binary support files, enforce permissions, undo and survive restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'result-shared-'));
  let server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'fixture',
  });
  const url = `http://127.0.0.1:${server.port}`;
  const files = fixture();
  const asset = 'output/games/v2-combat/assets/game.js';
  files[asset] = encodeAsset(asset, Buffer.from('combat()'));
  const created = await CollaborationClient.create(
    url,
    'fixture',
    'owner',
    'test',
    files,
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'viewer',
  );
  const viewer = new CollaborationClient(joined.credentials, () => {});
  viewer.accept(joined.result);
  t.after(async () => {
    owner.stop();
    viewer.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.equal(owner.state.structuredResults, true);
  const task = await owner.command('tasks:create', {
    kind: 'implement',
    inputPaths: ['project.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'update', basePath: from },
  });
  await owner.beginAi(task.relativePath);
  const updatedHtml = html.replace('combat', 'updated');
  await owner.finishAi('completed', { [from]: updatedHtml });
  const oldRun = (await owner.history()).find(
    (entry) => entry.kind === 'ai' && entry.status === 'completed',
  );
  await owner.setRole(viewer.state.memberId, 'viewer');
  await viewer.refresh();
  await assert.rejects(
    viewer.command('results:move', {
      relativePath: from,
      category: 'systems',
      feature: 'combat',
    }),
    /뷰어/,
  );
  await owner.command('results:move', {
    relativePath: from,
    category: 'systems',
    feature: 'combat',
    revision: owner.revisions[from],
  });
  const history = owner.lastCommandHistoryId;
  await viewer.refresh();
  assert.equal(viewer.files[to], updatedHtml);
  assert.equal(
    viewer.files['output/systems/combat/v002/assets/game.js'],
    files[asset],
  );
  const port = server.port;
  await server.close();
  server = await createCollaborationServer({
    dataDirectory: root,
    port,
    creationKey: 'fixture',
  });
  await owner.refresh();
  assert.equal(owner.files[to], updatedHtml);
  await owner.changeHistory(history, 'undo');
  await viewer.refresh();
  assert.equal(viewer.files[from], updatedHtml);
  await owner.changeHistory(history, 'redo');
  await owner.restore(oldRun.id, from, 'before');
  assert.equal(owner.files[to], html);
  assert.equal(owner.files[from], undefined);
  owner.state.structuredResults = false;
  await assert.rejects(
    owner.command('results:organize', {}),
    /서버를 함께 업데이트/,
  );
});
