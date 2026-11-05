import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanvasSpatialIndex,
  intersects,
} from '../src/core/canvas/spatial-index.ts';
import {
  CanvasRangeTracker,
  cameraRect,
} from '../src/core/canvas/viewport-ranges.ts';

const rect = (x, y, width = 100, height = 100) => ({ x, y, width, height });
const item = (id, ...args) => ({ id, ...rect(...args) });
const sorted = (ids) => [...ids].sort();

test('grid queries include clipped edges, negative zones and items spanning zones once', () => {
  const index = new CanvasSpatialIndex(100);
  index.sync([
    item('negative', -101, -30, 50, 50),
    item('edge', 100, 100),
    item('wide', -150, 50, 500, 50),
    item('point', 200, 100, 0, 0),
  ]);
  assert.deepEqual(sorted(index.query(rect(0, 0))), ['edge', 'wide']);
  assert.deepEqual(sorted(index.query(rect(-100, -100))), ['negative']);
  assert.deepEqual(sorted(index.query(rect(200, 100, 0, 0))), [
    'edge',
    'point',
    'wide',
  ]);
});

test('oversized items and huge overview queries stay bounded and exact', () => {
  const index = new CanvasSpatialIndex(100, 4);
  index.sync([
    item('huge', -1e9, -1e9, 2e9, 2e9),
    item('small', 40, 40, 1, 1),
    item('far', 2e9, 2e9),
    item('extreme', 1e100, 1e100, 0, 0),
  ]);
  assert.deepEqual(sorted(index.query(rect(50, 50, 1, 1))), ['huge']);
  assert.deepEqual(sorted(index.query(rect(-1e10, -1e10, 2e10, 2e10))), [
    'far',
    'huge',
    'small',
  ]);
  assert.deepEqual(sorted(index.query(rect(1e100, 1e100, 0, 0))), ['extreme']);
});

test('sync updates only changed geometry, removes deleted/invalid entries and copies input', () => {
  const index = new CanvasSpatialIndex();
  const first = item('a', 10, 20);
  index.sync([first, item('b', 10000, 0)]);
  const revision = index.revision;
  assert.equal(index.sync([{ ...first }, item('b', 10000, 0)]), false);
  assert.equal(index.revision, revision);
  first.x = 500;
  assert.deepEqual(sorted(index.query(rect(10, 20, 0, 0))), ['a']);
  index.sync([first]);
  assert.deepEqual(sorted(index.query(rect(10, 20, 0, 0))), []);
  assert.deepEqual(sorted(index.query(rect(500, 20, 0, 0))), ['a']);
  assert.equal(index.has('b'), false);
  index.upsert(item('a', Number.NaN, 20));
  assert.equal(index.size, 0);
  assert.deepEqual(sorted(index.query(rect(Infinity, 0))), []);
});

test('randomized geometry updates match an exhaustive rectangle oracle', () => {
  const index = new CanvasSpatialIndex(128, 16);
  let seed = 42;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let items = Array.from({ length: 1000 }, (_, i) =>
    item(
      String(i),
      random() * 20000 - 10000,
      random() * 20000 - 10000,
      random() * 3000,
      random() * 3000,
    ),
  );
  for (let round = 0; round < 30; round++) {
    if (round) {
      items = items
        .filter((_, i) => i % 31 !== 0)
        .map((value, i) =>
          i % 7
            ? value
            : { ...value, x: value.x - 300, width: value.width / 2 },
        );
    }
    index.sync(items);
    const query = rect(
      random() * 20000 - 10000,
      random() * 20000 - 10000,
      round === 29 ? 1e9 : random() * 5000,
      random() * 5000,
    );
    assert.deepEqual(
      sorted(index.query(query)),
      sorted(
        items.filter((value) => intersects(value, query)).map((v) => v.id),
      ),
    );
  }
});

test('camera bounds use actual canvas dimensions and transform at ultrawide widths', () => {
  for (const width of [1920, 3440, 5120])
    assert.deepEqual(
      cameraRect({ x: -100, y: 50, zoom: 0.5, width, height: 900 }),
      rect(200, -100, width * 2, 1800),
    );
  assert.equal(
    cameraRect({ x: 0, y: 0, zoom: 0, width: 100, height: 100 }),
    null,
  );
});

test('range membership is stable across tiny moves and retains a recent item briefly', () => {
  const index = new CanvasSpatialIndex();
  index.sync([item('a', 100, 100), item('b', 2500, 0)]);
  const ranges = new CanvasRangeTracker();
  const camera = { x: 0, y: 0, zoom: 1, width: 500, height: 500 };
  ranges.update(index, camera, 0);
  const initial = ranges.getSnapshot();
  assert.equal(ranges.update(index, { ...camera, x: 1 }, 10), false);
  assert.equal(ranges.getSnapshot(), initial);
  ranges.update(index, { ...camera, x: -2500 }, 20);
  assert.deepEqual(sorted(ranges.getSnapshot().visible), ['b']);
  assert.deepEqual(sorted(ranges.getSnapshot().retain), ['a', 'b']);
  assert.equal(ranges.nextExpiry, 770);
  ranges.update(index, { ...camera, x: -2500 }, 771);
  assert.deepEqual(sorted(ranges.getSnapshot().retain), ['b']);
  index.remove('b');
  ranges.update(index, camera, 772);
  assert.equal(ranges.getSnapshot().retain.has('b'), false);
});

test('prepare and wider retention boundaries prevent repeated removal on boundary reversals', () => {
  const index = new CanvasSpatialIndex();
  index.upsert(item('a', 1020, 0, 40, 40));
  const ranges = new CanvasRangeTracker();
  const camera = { x: 0, y: 0, zoom: 1, width: 500, height: 500 };
  for (const [now, x] of [
    [0, -30],
    [1000, 0],
    [2000, -30],
    [3000, 0],
  ]) {
    ranges.update(index, { ...camera, x }, now);
    assert.equal(ranges.getSnapshot().retain.has('a'), true);
  }
  ranges.update(index, { ...camera, x: 2000 }, 4000);
  assert.equal(ranges.getSnapshot().retain.has('a'), false);
});

test('recent retention starts on exit after an idle camera and does not resurrect deleted geometry', () => {
  const index = new CanvasSpatialIndex();
  index.upsert(item('a', 0, 0));
  const ranges = new CanvasRangeTracker();
  const camera = { x: 0, y: 0, zoom: 1, width: 500, height: 500 };
  ranges.update(index, camera, 0);
  ranges.update(index, { ...camera, x: -10000 }, 10000);
  assert.equal(ranges.getSnapshot().retain.has('a'), true);
  assert.equal(ranges.nextExpiry, 10750);
  index.remove('a');
  ranges.update(index, camera, 10001);
  assert.equal(ranges.getSnapshot().retain.has('a'), false);
  assert.equal(ranges.nextExpiry, null);
});
