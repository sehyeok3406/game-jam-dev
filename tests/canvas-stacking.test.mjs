import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { moveCanvasStack } from '../src/core/canvas/stacking.ts';
import { CANVAS_SHEETS_PATH, readCanvasSheets } from '../src/canvas-sheets.ts';
import { changeCanvasSheets } from '../src/canvas-sheet-commands.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
import { filesystemHistoryPublisher } from '../src/adapters/filesystem/command-publisher.ts';
import { LocalCommandService } from '../src/application/editing/command-service.ts';
import { LocalMutationService } from '../src/application/editing/local-mutation-service.ts';
import { LocalEditHistoryService } from '../src/application/editing/edit-history-service.ts';
import { UserEditRecorder } from '../src/application/editing/user-edit-recorder.ts';
import { EditJournal } from '../src/edit-journal.ts';

test('four stacking moves keep the relative order of a mixed selection', () => {
  const order = [
    'document:a',
    'drawing:b',
    'html:c',
    'document:d',
    'game-ui:e',
  ];
  const selected = new Set(['drawing:b', 'document:d']);
  assert.deepEqual(moveCanvasStack(order, selected, 'forward'), [
    order[0],
    order[2],
    order[1],
    order[4],
    order[3],
  ]);
  assert.deepEqual(moveCanvasStack(order, selected, 'backward'), [
    order[1],
    order[0],
    order[3],
    order[2],
    order[4],
  ]);
  assert.deepEqual(moveCanvasStack(order, selected, 'front'), [
    order[0],
    order[2],
    order[4],
    order[1],
    order[3],
  ]);
  assert.deepEqual(moveCanvasStack(order, selected, 'back'), [
    order[1],
    order[3],
    order[0],
    order[2],
    order[4],
  ]);
  assert.deepEqual(
    moveCanvasStack(order, new Set([order[4]]), 'forward'),
    order,
  );
});

test('stacking uses the sheet revision and survives ordinary sheet changes', () => {
  const original = { 'notes/a.md': 'sample' };
  const stacking = ['html:c', 'document:a', 'drawing:b'];
  const input = { action: 'stack', id: 'default', expected: null, stacking };
  const saved = changeCanvasSheets(original, input);
  assert.equal(saved['notes/a.md'], original['notes/a.md']);
  assert.deepEqual(
    readCanvasSheets(saved[CANVAS_SHEETS_PATH]).canvases[0].stacking,
    stacking,
  );
  assert.throws(() => changeCanvasSheets(saved, input), /변경/);
  assert.throws(
    () =>
      changeCanvasSheets(original, {
        ...input,
        stacking: ['drawing:x', 'drawing:x'],
      }),
    /쌓임/,
  );
  const renamed = changeCanvasSheets(saved, {
    action: 'rename',
    id: 'default',
    expected: saved[CANVAS_SHEETS_PATH],
    name: '작업 캔버스',
  });
  assert.deepEqual(
    readCanvasSheets(renamed[CANVAS_SHEETS_PATH]).canvases[0].stacking,
    stacking,
  );
});

test('local stacking is saved on disk and history changes only the canvas registry', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-stacking-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'project.md'), '# Project\n');
  const repo = filesystemProjectRepository(root);
  const journal = new EditJournal();
  const environment = { id: randomUUID, now: Date.now };
  const recorder = new UserEditRecorder(repo, journal, environment);
  const mutation = new LocalMutationService({
    project: repo,
    assertCurrent() {},
    record: recorder.record.bind(recorder),
    changed() {},
  });
  const commands = new LocalCommandService(repo);
  const input = {
    action: 'stack',
    id: 'default',
    expected: null,
    stacking: ['drawing:figure', 'document:note'],
  };
  await mutation.execute('canvases:change', [input], () =>
    commands.execute('canvases:change', input),
  );
  const reopened = await filesystemProjectRepository(root).capture();
  const raw = reopened[CANVAS_SHEETS_PATH];
  assert.deepEqual(readCanvasSheets(raw).canvases[0].stacking, input.stacking);
  assert.deepEqual(
    (await repo.history())[0].files.map((file) => file.relativePath),
    [CANVAS_SHEETS_PATH],
  );
  const publisher = filesystemHistoryPublisher(root, repo, {
    pauseWatcher: async () => async () => {},
    trashItem: async () =>
      assert.fail('stacking history must not trash project files'),
  });
  const history = new LocalEditHistoryService(
    repo,
    journal,
    publisher,
    environment,
  );
  await history.change('undo');
  assert.deepEqual(await repo.capture(), { 'project.md': '# Project\n' });
  await history.change('redo');
  assert.deepEqual(await repo.capture(), reopened);
});
