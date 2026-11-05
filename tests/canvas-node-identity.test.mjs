import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retainUnchangedRecords } from '../src/core/editing/record-identity.ts';
import {
  CanvasNodeModels,
  reuseCanvasNode,
  StaleCanvasNodeError,
} from '../src/ui/canvas/node-model.ts';

const node = (id, extra = {}) => ({
  id,
  type: 'document',
  position: { x: 10, y: 20 },
  style: { width: 400, height: 300 },
  data: {
    kind: 'document',
    document: { id, title: id, body: 'body', sources: [] },
    propertyVisibility: {},
    ...extra,
  },
});

test('expired asynchronous saves reject instead of acknowledging and clearing an unsaved draft', async () => {
  const models = new CanvasNodeModels();
  let active = true,
    writes = 0,
    dirty = true;
  const old = models.prepare(
    [
      node('draft', {
        onSave: async () => {
          writes++;
        },
      }),
    ],
    () => active,
  )[0];
  active = false;
  await assert.rejects(async () => {
    await old.data.onSave();
    dirty = false;
  }, StaleCanvasNodeError);
  assert.equal(dirty, true);
  assert.equal(writes, 0);
});

test('expired views still unregister their own editor and gesture without touching the next owner', () => {
  const models = new CanvasNodeModels(),
    oldEditors = new Map(),
    newEditors = new Map();
  let oldGesture = true,
    newGesture = true;
  const old = models.prepare(
    [
      node('same-id', {
        registerEditor: (id, fn) =>
          fn ? oldEditors.set(id, fn) : oldEditors.delete(id),
        onGesture: (active) => {
          oldGesture = active;
        },
      }),
    ],
    () => true,
  )[0];
  old.data.registerEditor('same-id', () => {});
  const next = models.prepare(
    [
      node('same-id', {
        registerEditor: (id, fn) =>
          fn ? newEditors.set(id, fn) : newEditors.delete(id),
        onGesture: (active) => {
          newGesture = active;
        },
      }),
    ],
    () => true,
  )[0];
  next.data.registerEditor('same-id', () => {});
  old.data.registerEditor('same-id', null);
  old.data.onGesture(false);
  assert.equal(oldEditors.size, 0);
  assert.equal(newEditors.size, 1);
  assert.equal(oldGesture, false);
  assert.equal(newGesture, true);
});

test('DTO reads retain equal records, changed records and reordered/deleted lists correctly without JSON serialization', () => {
  const original = [
    { id: 'a', items: [{ nested: [1, 2, { text: 'a' }] }] },
    { id: 'b', text: 'body' },
  ];
  assert.equal(
    retainUnchangedRecords(original, structuredClone(original)),
    original,
  );
  const next = structuredClone(original);
  next[0].items[0].nested[2].text = 'updated';
  const shared = retainUnchangedRecords(original, next);
  assert.equal(shared[0], next[0]);
  assert.equal(shared[1], original[1]);
  assert.equal(original[0].items[0].nested[2].text, 'a');
  assert.deepEqual(
    retainUnchangedRecords(original, [
      structuredClone(original[1]),
      structuredClone(original[0]),
    ]),
    [original[1], original[0]],
  );
  assert.equal(
    retainUnchangedRecords(original, [structuredClone(original[1])])[0],
    original[1],
  );
  const trap = { id: 'trap', points: [[1, 2, 0.5]] };
  Object.defineProperty(trap, 'toJSON', {
    value: () => {
      throw Error('DTO serialization is forbidden');
    },
  });
  assert.equal(
    retainUnchangedRecords([trap], [{ id: 'trap', points: [[1, 2, 0.5]] }])[0],
    trap,
  );
});

test('DTO identity comparison never treats distinct mutable non-DTO containers as equal', () => {
  const before = [{ id: 'map', value: new Map() }];
  const next = [{ id: 'map', value: new Map([['new', true]]) }];
  assert.equal(retainUnchangedRecords(before, next)[0], next[0]);
});

test('node callback identity is stable while the callback receives the latest closure and return value', async () => {
  const models = new CanvasNodeModels(),
    current = () => true;
  const calls = [];
  const first = node('a', {
    onSave: () => {
      calls.push('before');
      return 'old';
    },
  });
  const previous = models.prepare([first], current)[0];
  const next = models.prepare(
    [
      {
        ...first,
        data: {
          ...first.data,
          propertyVisibility: {},
          onSave: () => {
            calls.push('after');
            return 'new';
          },
        },
      },
    ],
    current,
  )[0];
  assert.equal(next.data, previous.data);
  assert.equal(next.data.onSave, previous.data.onSave);
  assert.equal(previous.data.onSave(), 'new');
  assert.deepEqual(calls, ['after']);
  const asynchronous = models.prepare(
    [{ ...first, data: { ...first.data, onSave: async () => 'async result' } }],
    current,
  )[0];
  assert.equal(asynchronous.data, previous.data);
  assert.equal(await previous.data.onSave(), 'async result');
});

test('one record, permission and property changes invalidate only their owning node and never traverse large payloads', () => {
  const models = new CanvasNodeModels(),
    current = () => true;
  const a = node('a'),
    b = node('b');
  Object.defineProperty(b.data.document, 'toJSON', {
    value: () => {
      throw Error('Node payload serialization is forbidden');
    },
  });
  const initial = models.prepare([a, b], current);
  const update = {
    ...a,
    data: {
      ...a.data,
      document: { ...a.data.document, body: 'changed' },
      locked: true,
      propertyVisibility: { status: true },
    },
  };
  const next = models.prepare([update, b], current);
  assert.notEqual(next[0].data, initial[0].data);
  assert.equal(next[1].data, initial[1].data);
  assert.equal(next[0].data.locked, true);
  assert.deepEqual(next[0].data.propertyVisibility, { status: true });
});

test('React Flow geometry changes retain content and measured identity and unchanged projections retain node identity', () => {
  const models = new CanvasNodeModels(),
    current = () => true;
  const original = node('a');
  const first = models.prepare([original], current)[0];
  const previous = {
    ...first,
    measured: { width: 400, height: 300 },
    selected: true,
  };
  const projected = models.prepare(
    [
      {
        ...original,
        position: { x: 10, y: 20 },
        style: { width: 400, height: 300 },
      },
    ],
    current,
  )[0];
  assert.equal(
    reuseCanvasNode(previous, {
      ...projected,
      measured: previous.measured,
      selected: true,
    }),
    previous,
  );
  const moved = reuseCanvasNode(previous, {
    ...projected,
    measured: previous.measured,
    selected: true,
    position: { x: 90, y: 20 },
  });
  assert.notEqual(moved, previous);
  assert.equal(moved.data, previous.data);
  assert.equal(moved.measured, previous.measured);
  assert.equal(moved.selected, true);
});

test('removed callbacks, deleted nodes, restored generations and expired visits cannot call newer targets', async () => {
  const models = new CanvasNodeModels(),
    current = () => true;
  let writes = 0;
  const a = node('a', { action: () => writes++ });
  const first = models.prepare([a], current)[0];
  models.prepare([node('a')], current);
  await first.data.action();
  assert.equal(writes, 0, 'removed callback is disabled');
  const second = models.prepare([a], current)[0];
  models.prepare([], current);
  models.prepare([a], current);
  await second.data.action();
  assert.equal(writes, 0, 'deleted/re-added ID does not revive old callbacks');
  const drawing = {
    ...a,
    type: 'drawing',
    data: {
      kind: 'drawing',
      object: { generation: 'old' },
      action: () => writes++,
    },
  };
  const oldDrawing = models.prepare([drawing], current)[0];
  models.prepare(
    [
      {
        ...drawing,
        data: { ...drawing.data, object: { generation: 'restored' } },
      },
    ],
    current,
  );
  await oldDrawing.data.action();
  assert.equal(writes, 0, 'restored generation disables old callbacks');
  const oldVisit = models.prepare([a], current)[0];
  models.prepare([a], () => true);
  models.prepare([a], () => true);
  await oldVisit.data.action();
  assert.equal(writes, 0, 'an A → B → A visit never revives callbacks');
  let active = true;
  const live = models.prepare([a], () => active)[0];
  active = false;
  await live.data.action();
  assert.equal(
    writes,
    0,
    'lifetime expiration is checked before the next projection',
  );
});
