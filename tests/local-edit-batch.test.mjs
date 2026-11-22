import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { LocalEditBatch } from '../src/application/editing/local-edit-batch.ts';
import { localHistoryInverse } from '../src/application/editing/edit-history-service.ts';
import { readDrawingFile, sparseDrawingEdit } from '../src/drawing-model.ts';
import { DEFAULT_PEN_STYLE, strokeGeometry } from '../src/drawing-geometry.ts';
import { EditJournal } from '../src/edit-journal.ts';

const drawing = '.canvas/drawings/default.json';
const note = 'ideas/memo.md';
const pen = () => ({
  canvasId: 'default',
  action: 'create',
  requestId: randomUUID(),
  objects: [
    {
      id: randomUUID(),
      generation: randomUUID(),
      kind: 'stroke',
      layer: 'annotation',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
      style: { ...DEFAULT_PEN_STYLE },
      ...strokeGeometry(
        [
          [10, 10, 0.5],
          [40, 60, 0.5],
        ],
        'pen',
        true,
      ),
    },
  ],
});

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1 });
  const disk = { [note]: 'original' };
  const published = [];
  const writes = [];
  const errors = [];
  const journal = new EditJournal();
  let pendingNote;
  let draft = null;
  let failHistory = false;
  const historyAttempts = [];
  let tail = Promise.resolve();
  const serial = (work) => (tail = tail.then(work, work));
  const batch = new LocalEditBatch({
    repository: {
      captureCanvas: async () => ({ ...disk }),
    },
    preparePublication: async (before, after, entry) => ({
      apply: async () => {
        const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
        const changes = Object.fromEntries(
          [...paths]
            .filter((path) => before[path] !== after[path])
            .map((path) => [path, after[path] ?? null]),
        );
        for (const path of Object.keys(changes))
          assert.equal(before[path], disk[path]);
        for (const [path, value] of Object.entries(changes)) {
          if (value === null) delete disk[path];
          else disk[path] = value;
        }
        writes.push(changes);
      },
      finish: async () => {
        historyAttempts.push(entry.id);
        if (failHistory) throw Error('history disk failure');
        published.push({ before, after, entry });
      },
    }),
    serial,
    planDocuments: async () => {
      const value = pendingNote;
      return {
        before: value ? { [note]: disk[note] } : {},
        after: value ? { [note]: value } : {},
        accept: async () => {
          if (pendingNote === value) pendingNote = undefined;
          return [];
        },
        fail: async () => {},
      };
    },
    checkpointDocuments: async () => {},
    pendingDocuments: () => !!pendingNote,
    assertWritable() {},
    readDraft: async () => draft,
    writeDraft: async (next) => {
      draft = next;
    },
    drawingEdit: sparseDrawingEdit,
    invertDrawing: (current, edit, direction) =>
      localHistoryInverse(current, edit.before, edit.after, direction),
    pushEdit: (edit, drawingOnly) =>
      journal.push(
        { id: randomUUID(), label: 'edit', memory: { ...edit, drawingOnly } },
        !drawingOnly,
      ),
    drawingPersistence: () => {},
    published: () => {},
    failed: (error) => errors.push(error),
    id: randomUUID,
  });
  t.after(() => batch.dispose());
  return {
    batch,
    disk,
    writes,
    published,
    journal,
    errors,
    historyAttempts,
    serial,
    editNote(value) {
      pendingNote = value;
      batch.touch();
    },
    getDraft: () => draft,
    stopHistory: (fail) => {
      failHistory = fail;
    },
    async tick(ms) {
      t.mock.timers.tick(ms);
      await tail;
      await setImmediate();
    },
    async change(direction) {
      const item = journal.peek(direction);
      await batch.changeDrawing(item.memory, direction);
      journal.finish(direction, item.id);
    },
  };
}

test('project-wide idle time resets on edits and commits changed Markdown and ink in one version', async (t) => {
  const f = fixture(t);
  await f.batch.draw(pen());
  await f.tick(30_000);
  assert.ok(f.getDraft());
  await f.tick(70_000);
  f.editNote('latest text');
  await f.tick(119_999);
  assert.equal(f.writes.length, 0);
  await f.tick(1);
  assert.equal(f.published.length, 1);
  assert.deepEqual(Object.keys(f.writes[0]).sort(), [drawing, note]);
  assert.equal(f.disk[note], 'latest text');
  assert.equal(f.getDraft(), null);
  assert.deepEqual(f.errors, []);
});

test('three strokes stay individually undoable across a batched save and the undone stroke is not written', async (t) => {
  const f = fixture(t);
  const commands = [pen(), pen(), pen()];
  for (const command of commands) await f.batch.draw(command);
  const [, second, third] = commands.map((c) => c.objects[0].id);
  assert.equal(f.disk[drawing], undefined);
  await f.change('undo');
  await f.batch.flush();
  assert.equal(f.published.length, 1);
  assert.equal(readDrawingFile(f.disk[drawing], 'default').objects.length, 2);
  assert.ok(
    !readDrawingFile(f.disk[drawing], 'default').objects.some(
      (o) => o.id === third,
    ),
  );
  await f.change('undo');
  assert.ok(
    !readDrawingFile(f.batch.overlay(f.disk)[drawing], 'default').objects.some(
      (o) => o.id === second,
    ),
  );
  await f.change('redo');
  await f.change('redo');
  assert.equal(
    readDrawingFile(f.batch.overlay(f.disk)[drawing], 'default').objects.length,
    3,
  );
  assert.equal(readDrawingFile(f.disk[drawing], 'default').objects.length, 2);
});

test('an interrupted history write retries the same publication before acknowledging drafts', async (t) => {
  const f = fixture(t);
  await f.batch.draw(pen());
  f.stopHistory(true);
  await assert.rejects(f.batch.flush(), /history disk failure/);
  assert.ok(f.getDraft());
  f.stopHistory(false);
  await f.batch.flush();
  assert.equal(f.writes.length, 1);
  assert.equal(f.historyAttempts[0], f.historyAttempts[1]);
  assert.equal(f.published.length, 1);
  assert.equal(f.getDraft(), null);
});

test('an edit arriving during publication is applied to the next batch in the mutation queue', async (t) => {
  const f = fixture(t);
  await f.batch.draw(pen());
  const first = f.serial(() => f.batch.flush());
  const second = f.serial(() => f.batch.draw(pen()));
  await Promise.all([first, second]);
  assert.equal(readDrawingFile(f.disk[drawing], 'default').objects.length, 1);
  assert.equal(
    readDrawingFile(f.batch.overlay(f.disk)[drawing], 'default').objects.length,
    2,
  );
  await f.batch.flush();
  assert.equal(f.published.length, 2);
  assert.equal(readDrawingFile(f.disk[drawing], 'default').objects.length, 2);
});
