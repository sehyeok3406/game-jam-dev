import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanvasViewportStore,
  canvasSpatialItems,
} from '../src/ui/canvas/viewport-store.ts';

const node = (id, x, extra = {}) => ({
  id,
  internals: { positionAbsolute: { x, y: 0 } },
  measured: { width: 100, height: 100 },
  data: { kind: 'document', sectionHidden: false },
  ...extra,
});

function clock() {
  let id = 0,
    time = 0;
  const frames = new Map(),
    timers = new Map(),
    captured = [];
  return {
    frames,
    timers,
    captured,
    frame: (fn) => {
      captured.push(fn);
      frames.set(++id, fn);
      return id;
    },
    cancelFrame: (key) => frames.delete(key),
    delay: (fn, ms) => {
      timers.set(++id, { fn, due: time + ms });
      return id;
    },
    cancelDelay: (key) => timers.delete(key),
    now: () => time,
    flush: () => {
      const pending = [...frames.values()];
      frames.clear();
      time += 16;
      pending.forEach((fn) => fn(time));
    },
    advance: (ms) => {
      time += ms;
      for (const [key, t] of timers)
        if (t.due <= time) {
          timers.delete(key);
          t.fn();
        }
    },
  };
}

test('geometry projection uses absolute section coordinates, measured/collapsed dimensions and no bodies', () => {
  const data = { kind: 'document', sectionHidden: false };
  Object.defineProperty(data, 'document', {
    get() {
      throw Error('must not read document');
    },
  });
  const values = [
    ...canvasSpatialItems([
      node('child', 1200, {
        parentId: 'section',
        position: { x: 10, y: 20 },
        data,
      }),
      node('collapsed', 200, {
        measured: { width: 500, height: 38 },
        style: { width: 500, height: 600 },
      }),
      node('hidden', 0, { hidden: true }),
      node('section-hidden', 0, {
        data: { kind: 'document', sectionHidden: true },
      }),
      node('unmeasured', 0, {
        measured: {},
        style: { width: 420, height: 330 },
      }),
    ]),
  ];
  assert.deepEqual(
    values.map((v) => [v.id, v.x, v.width, v.height]),
    [
      ['child', 1200, 100, 100],
      ['collapsed', 200, 500, 38],
      ['unmeasured', 0, 420, 330],
    ],
  );
});

test('sole selection is cached with geometry; multi-selection releases idle detail while live protection remains', () => {
  const timer = clock();
  let current = true;
  const store = new CanvasViewportStore(() => current);
  let values = [
    node('a', 0, { selected: true }),
    node('b', 10000, { selected: false }),
  ];
  const stop = store.connect(
    () => ({
      camera: { x: 0, y: 0, zoom: 1, width: 500, height: 500 },
      nodes: values,
    }),
    timer,
  );
  timer.flush();
  assert.equal(store.isSoleSelected('a'), true);
  const release = store.protect('a');
  timer.flush();
  let notifications = 0;
  store.subscribePreparation(() => notifications++);
  values = values.map((n) => ({ ...n, selected: true }));
  store.geometryChanged();
  timer.flush();
  assert.equal(store.isSoleSelected('a'), false);
  assert.equal(store.isSoleSelected('b'), false);
  assert.equal(
    store.contentMode('a'),
    2,
    'a live editor remains detailed after multi-selection',
  );
  assert.ok(
    notifications > 0,
    'selection change notifies even when protection keeps the preparation target equal',
  );
  release();
  values = values.map((n) => ({ ...n, selected: n.id === 'b' }));
  store.geometryChanged();
  timer.flush();
  assert.equal(store.isSoleSelected('b'), true);
  assert.equal(store.contentMode('b'), 2);
  current = false;
  assert.equal(store.isSoleSelected('b'), false);
  stop();
});

test('coalesces camera inputs, never iterates geometry during camera-only frames, notifies only membership changes', () => {
  const timer = clock(),
    store = new CanvasViewportStore();
  let camera = { x: 0, y: 0, zoom: 1, width: 500, height: 500 };
  let scans = 0,
    notices = 0;
  const nodes = {
    *[Symbol.iterator]() {
      scans++;
      yield node('a', 100);
      yield node('b', 5000);
    },
  };
  store.subscribe(() => notices++);
  const disconnect = store.connect(() => ({ camera, nodes }), timer);
  timer.flush();
  const initial = store.getSnapshot();
  for (let i = 0; i < 100; i++) {
    camera = { ...camera, x: i / 100 };
    store.schedule();
  }
  assert.equal(timer.frames.size, 1);
  timer.flush();
  assert.equal(scans, 1);
  assert.equal(notices, 1);
  assert.equal(store.getSnapshot(), initial);
  camera = { ...camera, x: -5000 };
  store.schedule();
  timer.flush();
  assert.deepEqual([...store.getSnapshot().visible], ['b']);
  assert.equal(scans, 1);
  timer.advance(751);
  timer.flush();
  assert.deepEqual([...store.getSnapshot().retain], ['b']);
  disconnect();
  assert.equal(timer.frames.size + timer.timers.size, 0);
});

test('geometry invalidation reflects creation, movement, resize, hiding, removal and stationary camera', () => {
  const timer = clock(),
    store = new CanvasViewportStore();
  const camera = { x: 0, y: 0, zoom: 1, width: 500, height: 500 };
  let nodes = [node('a', 1000)];
  store.connect(() => ({ camera, nodes }), timer);
  timer.flush();
  assert.equal(store.getSnapshot().visible.size, 0);
  nodes = [node('a', 450), node('b', 0)];
  store.geometryChanged();
  timer.flush();
  assert.deepEqual([...store.getSnapshot().visible].sort(), ['a', 'b']);
  nodes = [
    node('a', -500, { measured: { width: 600, height: 38 } }),
    node('b', 0, { hidden: true }),
  ];
  store.geometryChanged();
  timer.flush();
  assert.deepEqual([...store.getSnapshot().visible], ['a']);
  nodes = [];
  store.geometryChanged();
  timer.flush();
  assert.equal(store.getSnapshot().retain.size, 0);
});

test('a disconnected visit cancels frames and expiry; even a queued callback cannot update the next visit', () => {
  const timer = clock(),
    store = new CanvasViewportStore();
  const camera = { x: 0, y: 0, zoom: 1, width: 500, height: 500 };
  let oldReads = 0;
  const disconnect = store.connect(() => {
    oldReads++;
    return { camera, nodes: [node('old', 0)] };
  }, timer);
  const stale = timer.captured[0];
  disconnect();
  store.connect(() => ({ camera, nodes: [node('new', 0)] }), timer);
  disconnect();
  stale();
  timer.flush();
  assert.equal(oldReads, 0);
  assert.deepEqual([...store.getSnapshot().visible], ['new']);
});

test('fast movement uses summaries, keeps a focused target detailed and restores quality after quiet without geometry scans', () => {
  const timer = clock(),
    store = new CanvasViewportStore();
  let camera = { x: 0, y: 0, zoom: 1, width: 500, height: 500 },
    scans = 0;
  const nodes = {
    *[Symbol.iterator]() {
      scans++;
      yield node('a', 0, { measured: { width: 420, height: 330 } });
      yield node('focus', 3000);
    },
  };
  store.connect(() => ({ camera, nodes, priorityIds: ['focus'] }), timer);
  timer.flush();
  assert.equal(store.getPreparationSnapshot().targets.get('a').level, 'detail');
  camera = { ...camera, x: -300 };
  timer.advance(16);
  store.schedule();
  timer.flush();
  assert.equal(store.getPreparationSnapshot().fast, true);
  assert.equal(
    store.getPreparationSnapshot().targets.get('a').level,
    'summary',
  );
  assert.equal(
    store.getPreparationSnapshot().targets.get('focus').level,
    'detail',
  );
  assert.equal(store.getPreparationSnapshot().targets.get('focus').priority, 0);
  timer.advance(161);
  timer.flush();
  assert.equal(store.getPreparationSnapshot().fast, false);
  assert.equal(store.getPreparationSnapshot().targets.get('a').level, 'detail');
  assert.equal(scans, 1);
});

test('an expired scope cannot read geometry or dispatch registered preparation before effect cleanup', () => {
  const timer = clock();
  let current = true,
    reads = 0,
    ran = 0;
  const store = new CanvasViewportStore(() => current);
  store.connect(() => {
    reads++;
    return {
      camera: { x: 0, y: 0, zoom: 1, width: 500, height: 500 },
      nodes: [node('a', 0)],
    };
  }, timer);
  timer.flush();
  store.preparations.register('a', 1, {
    prepare: () => {
      ran++;
      return { done: true, value: null };
    },
    commit() {},
  });
  current = false;
  store.geometryChanged();
  timer.flush();
  assert.equal(reads, 1);
  assert.equal(ran, 0);
});
