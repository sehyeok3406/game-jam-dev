import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanvasContentCache } from '../src/ui/canvas/content-cache.ts';
import { CanvasPreparationScheduler } from '../src/ui/canvas/preparation-scheduler.ts';
import { CanvasViewportStore } from '../src/ui/canvas/viewport-store.ts';

test('cache respects count, estimated byte budget, revision inputs and LRU order', () => {
  const cache = new CanvasContentCache(2, 100);
  cache.put('a', ['source', 'title'], 'a', 30);
  cache.put('b', [1], 'b', 40);
  cache.touch('a');
  cache.put('c', [1], 'c', 40);
  assert.equal(cache.peek('b', [1]), undefined);
  assert.equal(cache.peek('a', ['source', 'title']), 'a');
  assert.equal(cache.peek('a', ['source', 'renamed']), undefined);
  cache.put('c', [2], 'changed', 80);
  assert.equal(cache.peek('a', ['source', 'title']), undefined);
  assert.equal(cache.getStatus().estimatedBytes, 80);
  cache.put('oversize', [1], 'large', 101);
  assert.equal(cache.peek('oversize', [1]), undefined);
  assert.ok(cache.getStatus().estimatedBytes <= 100);
});

test('cache retains no caller revision array, never serializes payloads, and invalidates subscriptions on replacement/clear', () => {
  const cache = new CanvasContentCache(),
    revision = [1];
  let updates = 0;
  const unsubscribe = cache.subscribe('a', () => updates++);
  const value = {
    toJSON() {
      throw Error('must not serialize');
    },
  };
  cache.put('a', revision, value, 50);
  revision[0] = 2;
  assert.equal(cache.peek('a', [1]), value);
  assert.equal(cache.peek('a', revision), undefined);
  const version = cache.version('a');
  cache.clear();
  assert.equal(cache.peek('a', [1]), undefined);
  assert.ok(cache.version('a') > version);
  assert.equal(updates, 2);
  unsubscribe();
  cache.put('a', [2], 'new', 20);
  assert.equal(updates, 2);
  for (let i = 0; i < 1000; i++) cache.put('a', [i], String(i), 20);
  assert.equal(cache.getStatus().entries, 1);
  assert.equal(cache.getStatus().estimatedBytes, 20);
});

test('nearby prefetch cannot evict a visible value first; pinned values still obey the hard budget', () => {
  const cache = new CanvasContentCache(2, 100);
  cache.put('visible', [1], 'visible', 40);
  const release = cache.pin('visible');
  cache.put('nearby1', [1], 'one', 40);
  cache.put('nearby2', [1], 'two', 40);
  assert.equal(cache.peek('visible', [1]), 'visible');
  assert.equal(cache.peek('nearby1', [1]), undefined);
  const second = cache.pin('nearby2');
  cache.put('next', [1], 'next', 40);
  assert.ok(
    cache.getStatus().entries <= 2 && cache.getStatus().estimatedBytes <= 100,
  );
  release();
  const replacement = cache.pin('visible');
  release();
  replacement();
  second();
});

test('one node can prepare independent markdown/image resources without canceling its siblings', () => {
  const frames = new Map();
  let frame = 0,
    time = 0;
  const scheduler = new CanvasPreparationScheduler();
  scheduler.connect(
    {
      frame: (fn) => {
        frames.set(++frame, fn);
        return frame;
      },
      cancelFrame: (id) => frames.delete(id),
      now: () => time,
    },
    () => true,
  );
  const values = [];
  const work = (value) => ({
    prepare: () => ({ done: true, value }),
    commit: (v) => values.push(v),
  });
  const old = scheduler.register('node', 1, work('old body'), 'markdown');
  scheduler.register('node', 1, work('image'), 'image:a');
  scheduler.register('node', 2, work('new body'), 'markdown');
  old();
  scheduler.setTargets(
    [{ id: 'node', level: 'detail', priority: 1, distance: 0 }],
    false,
  );
  for (let i = 0; i < 3; i++) {
    time += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(time));
  }
  assert.deepEqual(values.sort(), ['image', 'new body']);
});

test('protection leases are owner-specific, search reaches distant logical items, and a new scope has no old cache', () => {
  const frames = new Map();
  let frame = 0,
    time = 0;
  const clock = {
    frame: (fn) => {
      frames.set(++frame, fn);
      return frame;
    },
    cancelFrame: (id) => frames.delete(id),
    now: () => time,
    delay: () => 1,
    cancelDelay() {},
  };
  const store = new CanvasViewportStore();
  store.connect(
    () => ({
      camera: { x: 0, y: 0, zoom: 1, width: 500, height: 500 },
      nodes: [
        {
          id: 'far',
          data: { kind: 'document' },
          internals: { positionAbsolute: { x: 50000, y: 0 } },
          measured: { width: 400, height: 300 },
        },
      ],
    }),
    clock,
  );
  const flush = () => {
    time += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn(time));
  };
  flush();
  assert.equal(store.contentMode('far'), 0);
  const release = store.protect('far');
  flush();
  assert.equal(store.contentMode('far'), 2);
  release();
  const next = store.protect('far');
  release();
  flush();
  assert.equal(store.contentMode('far'), 2);
  next();
  flush();
  assert.equal(store.contentMode('far'), 0);
  store.setSearch(true);
  flush();
  assert.equal(store.contentMode('far'), 2);
  assert.equal(
    store.getPreparationSnapshot().targets.get('far').level,
    'detail',
  );
  store.setSearch(false);
  flush();
  assert.equal(store.contentMode('far'), 0);
  store.content.put('file', [1], 'private to this view', 50);
  assert.equal(new CanvasViewportStore().content.peek('file', [1]), undefined);
});
