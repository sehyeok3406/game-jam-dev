import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import {
  taskFileLock,
  isAiFileLocked,
  assertAiMutation,
  changedAiFile,
  assertAiFilesUnlocked,
} from '../src/ai-file-lock.ts';
import {
  relocateResults,
  remapResultChanges,
} from '../src/result-structure.ts';
import { createTaskFiles } from '../src/task-plan.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { sourceMetadata, htmlSourcePath } from '../src/html-source.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';
const md = (id, data = {}) =>
  matter.stringify('body', {
    id,
    title: id,
    type: 'idea',
    status: 'draft',
    sources: [],
    x: 0,
    y: 0,
    width: 340,
    height: 300,
    ...data,
  });
const html = '<html><body>base</body></html>';
const base = 'output/systems/combat/v001/index.html';

test('historical HTML paths cannot restore into a relocated result protected by an active task', () => {
  const legacy = 'output/games/v1/index.html';
  const files = relocateResults(
    { [legacy]: html, 'output/games/v1/assets/game.js': 'base script' },
    [{ from: legacy, to: base }],
  );
  Object.assign(
    files,
    createTaskFiles(
      {
        kind: 'implement',
        inputPaths: [],
        x: 0,
        y: 0,
        htmlResult: { mode: 'update', basePath: base },
      },
      'restore-probe',
      files,
    ),
  );
  const scope = taskFileLock(files, '.ai/tasks/restore-probe.md');
  const changes = remapResultChanges(files, {
    [legacy]: '<html><body>older result</body></html>',
    'output/games/v1/assets/game.js': 'older script',
  });
  assert.ok(changes[base]);
  assert.ok(changes['output/systems/combat/v001/assets/game.js']);
  assert.throws(
    () => assertAiFilesUnlocked(scope, Object.keys(changes)),
    /AI 작업/,
  );
});

test('a workflow freezes its section members, image bytes, both stages, base HTML assets and reserved outputs', () => {
  const files = {
    'ideas/a.md': md('a'),
    'ideas/b.md': md('b'),
    'images/card.md': md('image', {
      type: 'image',
      asset: { path: 'assets/images/shared.png' },
    }),
    'assets/images/shared.png': 'frozen bytes',
    'sections/group.md': md('group', {
      type: 'section',
      members: [
        { id: 'a', path: 'ideas/a.md' },
        { id: 'image', path: 'images/card.md' },
      ],
    }),
    [base]: html,
    [htmlSourcePath(base)]: sourceMetadata(base, html),
  };
  const tasks = createTaskFiles(
    {
      kind: 'organize',
      inputPaths: ['sections/group.md'],
      x: 0,
      y: 0,
      documentResult: { mode: 'new' },
      thenImplement: { htmlResult: { mode: 'new', basePath: base } },
    },
    'workflow',
    files,
  );
  Object.assign(files, tasks);
  const task = '.ai/tasks/workflow.md';
  const scope = taskFileLock(files, task);
  for (const relative of [
    task,
    'sections/group.md',
    'ideas/a.md',
    'images/card.md',
    'assets/images/shared.png',
    base,
    htmlSourcePath(base),
    'output/systems/combat/v001/assets/game.js',
    ...expectedArtifacts(files[task]),
  ])
    assert.equal(isAiFileLocked(scope, relative), true, relative);
  assert.equal(isAiFileLocked(scope, 'IDEAS/A.MD'), true);
  assert.equal(isAiFileLocked(scope, 'ideas/b.md'), false);
  assert.equal(
    isAiFileLocked(scope, 'output/systems/combat/v001-copy/assets/game.js'),
    false,
  );
  const unrelated = {
    ...files,
    'ideas/b.md': md('b', { title: 'edited' }),
    'ideas/new.md': md('new'),
  };
  assert.equal(changedAiFile(files, unrelated, scope), undefined);
  assert.doesNotThrow(() => assertAiMutation(scope, files, unrelated));
  assert.equal(
    changedAiFile(
      files,
      { ...unrelated, 'assets/images/shared.png': 'changed' },
      scope,
    ),
    'assets/images/shared.png',
  );
  assert.throws(
    () =>
      assertAiMutation(scope, files, {
        ...files,
        'output/systems/combat/v001/assets/game.js': 'new bytes',
      }),
    /AI 작업/,
  );
  assert.throws(
    () =>
      assertAiMutation(scope, files, files, 'sections:move-document', {
        documentPath: 'ideas/a.md',
      }),
    /AI 작업/,
  );
});

test('server leases allow unrelated active editors, concurrent creates/edits/deletes and undo, while fencing input changes and batch side effects', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-file-lock-'));
  const server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'fixture',
  });
  const url = `http://127.0.0.1:${server.port}`;
  const initial = {
    'ideas/a.md': md('a'),
    'ideas/b.md': md('b'),
    [base]: html,
  };
  const created = await CollaborationClient.create(
    url,
    'fixture',
    'owner',
    'locks',
    initial,
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'editor',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  t.after(async () => {
    owner.stop();
    editor.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const group = await owner.command('sections:create', {
    title: 'group',
    members: [
      { id: 'a', path: 'ideas/a.md' },
      { id: 'b', path: 'ideas/b.md' },
    ],
    x: 0,
    y: 0,
    width: 700,
    height: 400,
  });
  const task = await owner.command('tasks:create', {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new', basePath: base },
  });
  await editor.refresh();
  await editor.lock('ideas/b.md');
  await owner.beginAi(task.relativePath);
  await editor.refresh();
  assert.equal(owner.state.scopedAiLocks, true);
  assert.ok(editor.state.aiRun.fileLock.paths.includes('ideas/a.md'));
  await editor.command('documents:save', {
    relativePath: 'ideas/b.md',
    title: '동시 편집',
    body: 'keep my edit',
  });
  await editor.unlock('ideas/b.md');
  const newNote = await editor.command('documents:create-idea', { x: 0, y: 0 });
  await editor.lock(newNote.relativePath);
  await editor.command('documents:save', {
    relativePath: newNote.relativePath,
    title: '새 메모',
    body: 'created during AI',
  });
  await editor.unlock(newNote.relativePath);
  const deleted = await editor.command('documents:create-idea', { x: 0, y: 0 });
  await editor.command('documents:delete', {
    documentId: deleted.id,
    relativePath: deleted.relativePath,
  });
  const deletion = editor.lastCommandHistoryId;
  await editor.changeHistory(deletion, 'undo');
  await editor.changeHistory(deletion, 'redo');
  for (const [channel, input] of [
    ['documents:delete', { documentId: 'a', relativePath: 'ideas/a.md' }],
    ['documents:set-color', { relativePath: 'ideas/a.md', color: 'pink' }],
    [
      'documents:update-layout',
      { relativePath: 'ideas/a.md', x: 5, y: 5, width: 340, height: 300 },
    ],
    [
      'sections:update-layout',
      {
        relativePath: group.relativePath,
        x: 100,
        y: 100,
        width: 700,
        height: 400,
        moveMembers: true,
      },
    ],
    [
      'sections:delete',
      {
        relativePath: group.relativePath,
        sectionId: group.id,
        deleteMembers: false,
      },
    ],
    [
      'results:move',
      { relativePath: base, category: 'content', feature: 'combat' },
    ],
    [
      'layouts:update',
      {
        updates: [
          {
            kind: 'document',
            relativePath: 'ideas/b.md',
            x: 10,
            y: 10,
            width: 340,
            height: 300,
          },
          {
            kind: 'document',
            relativePath: 'ideas/a.md',
            x: 10,
            y: 10,
            width: 340,
            height: 300,
          },
        ],
      },
    ],
  ])
    await assert.rejects(editor.command(channel, input), /AI 작업/);
  await assert.rejects(editor.lock('ideas/a.md'), /AI 작업/);
  await assert.rejects(
    editor.request('offline-sync', {
      id: randomUUID(),
      changes: { 'ideas/a.md': md('a', { title: 'bypass' }) },
      revisions: editor.revisions,
    }),
    /AI 작업/,
  );
  await editor.refresh();
  assert.equal(
    matter(editor.files['ideas/b.md']).data.x,
    0,
    'Mixed layout must be atomic',
  );
  const output = 'output/systems/combat/v002/index.html';
  await owner.finishAi('completed', {
    [output]: '<html><body>AI output</body></html>',
  });
  await editor.refresh();
  assert.match(editor.files['ideas/b.md'], /keep my edit/);
  assert.match(editor.files[newNote.relativePath], /created during AI/);
  assert.equal(editor.files[deleted.relativePath], undefined);
  assert.match(editor.files[output], /AI output/);
  assert.equal(editor.files[base], html);
  await editor.lock('ideas/a.md');
  await editor.command('documents:save', {
    relativePath: 'ideas/a.md',
    title: 'unlocked',
    body: 'after AI',
  });
  await editor.unlock('ideas/a.md');
});
