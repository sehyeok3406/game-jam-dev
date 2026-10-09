import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import { noteDragBounds } from '../src/note-placement.ts';
import {
  completionDismissed,
  dismissCompletion,
  dismissRunPanel,
  runPanelDismissed,
} from '../src/ai-completion-notices.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';

test('note drawing normalizes every direction and rounds canvas coordinates, including small notes', () => {
  for (const [start, end] of [
    [
      { x: 10, y: 20 },
      { x: 410, y: 320 },
    ],
    [
      { x: 410, y: 320 },
      { x: 10, y: 20 },
    ],
    [
      { x: 10, y: 320 },
      { x: 410, y: 20 },
    ],
    [
      { x: 410, y: 20 },
      { x: 10, y: 320 },
    ],
  ])
    assert.deepEqual(noteDragBounds(start, end), {
      x: 10,
      y: 20,
      width: 400,
      height: 300,
    });
  assert.deepEqual(
    noteDragBounds({ x: 1.25, y: -1.25 }, { x: 81.25, y: 43.75 }),
    { x: 1, y: -1, width: 80, height: 45 },
  );
});

test('explicit note creation stores drawn geometry even when occupied, while ordinary notes retain automatic placement', () => {
  const files = {
    'ideas/old.md': matter.stringify('body', {
      id: 'old',
      title: 'old',
      type: 'idea',
      x: 100,
      y: 100,
      width: 340,
      height: 300,
    }),
  };
  const before = structuredClone(files);
  const bounds = { x: 100, y: 100, width: 80, height: 45 };
  const drawn = reduceCollaboration(files, 'documents:create-idea', bounds);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(bounds).map((key) => [key, drawn.result[key]]),
    ),
    bounds,
  );
  assert.deepEqual(
    matter(drawn.files[drawn.result.relativePath]).data.width,
    80,
  );
  assert.equal(drawn.files['ideas/old.md'], files['ideas/old.md']);
  assert.deepEqual(files, before);
  const regular = reduceCollaboration(files, 'documents:create-idea', {
    x: 100,
    y: 100,
  }).result;
  assert.equal(regular.width, 340);
  assert.equal(regular.height, 300);
  assert(regular.y >= 400);
  for (const invalid of [
    { width: -1, height: 200 },
    { width: NaN, height: 200 },
    { width: Infinity, height: 200 },
    { width: 200, height: undefined },
    { width: 0, height: 200 },
  ])
    assert.throws(() =>
      reduceCollaboration(files, 'documents:create-idea', {
        ...bounds,
        ...invalid,
      }),
    );
  assert.deepEqual(files, before);
});

test('dismissed AI completions survive rereads, remain scoped to their project and do not hide new tasks', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  dismissCompletion(storage, 'project-a', 'run-1');
  assert(completionDismissed(storage, 'project-a', 'run-1'));
  assert(!completionDismissed(storage, 'project-b', 'run-1'));
  assert(!completionDismissed(storage, 'project-a', 'run-2'));
  dismissCompletion(storage, 'project-a', 'run-1');
  assert.equal(JSON.parse([...values.values()][0]).length, 1);
  for (let i = 0; i < 220; i++)
    dismissCompletion(storage, 'project-a', 'new-' + i);
  assert.equal(JSON.parse([...values.values()][0]).length, 200);
  assert(completionDismissed(storage, 'project-a', 'new-219'));
  assert(!completionDismissed(storage, 'project-a', 'run-1'));
  values.set('game-canvas-dismissed-ai:project-b', '{bad json');
  assert(!completionDismissed(storage, 'project-b', 'run-1'));
});

test('closing an AI run panel also dismisses its completion, while completion-only close preserves the panel', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  dismissCompletion(storage, 'project-a', 'run-1');
  assert(!runPanelDismissed(storage, 'project-a', 'run-1'));
  dismissRunPanel(storage, 'project-a', 'run-1');
  assert(runPanelDismissed(storage, 'project-a', 'run-1'));
  assert(completionDismissed(storage, 'project-a', 'run-1'));
  assert(!runPanelDismissed(storage, 'project-a', 'run-2'));
  assert(!runPanelDismissed(storage, 'project-b', 'run-1'));
  const unavailable = {
    getItem() {
      throw Error('unavailable');
    },
    setItem() {
      throw Error('unavailable');
    },
  };
  assert.doesNotThrow(() => dismissRunPanel(unavailable, 'project-a', 'run-1'));
  assert(!runPanelDismissed(unavailable, 'project-a', 'run-1'));
});
