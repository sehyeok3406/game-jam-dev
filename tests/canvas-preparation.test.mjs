import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanvasCameraMotion,
  canvasDetail,
} from '../src/core/canvas/preparation-policy.ts';
import { CanvasSpatialIndex } from '../src/core/canvas/spatial-index.ts';
import { CanvasRangeTracker } from '../src/core/canvas/viewport-ranges.ts';
import { CanvasPreparationScheduler } from '../src/ui/canvas/preparation-scheduler.ts';

function clock() {
  let time = 0,
    id = 0;
  const frames = new Map();
  return {
    frames,
    now: () => time,
    frame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelFrame: (key) => frames.delete(key),
    delay: () => {
      throw Error('scheduler must not spin timers');
    },
    cancelDelay() {},
    advance: (ms) => {
      time += ms;
    },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      time += 16;
      pending.forEach((fn) => fn(time));
    },
  };
}
const target = (id, priority = 1, distance = 0, level = 'detail') => ({
  id,
  priority,
  distance,
  level,
});
const done = (value) => ({ done: true, value });
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
function setup() {
  const timer = clock(),
    scheduler = new CanvasPreparationScheduler();
  scheduler.connect(timer, () => true);
  return { timer, scheduler };
}

test('motion handles pan, zoom, reversals, an idle camera and resize without extending activity on polls', () => {
  const motion = new CanvasCameraMotion();
  const camera = { x: 0, y: 0, zoom: 1, width: 1440, height: 900 };
  assert.equal(motion.sample(camera, 0).moving, false);
  const right = motion.sample({ ...camera, x: -400 }, 16);
  assert.equal(right.fast, true);
  assert.equal(right.aheadX, 512);
  const left = motion.sample(camera, 32);
  assert.equal(left.aheadX, -512);
  assert.equal(motion.sample(camera, 100).moving, true);
  assert.equal(motion.sample(camera, 193).moving, false);
  assert.equal(motion.sample({ ...camera, width: 5120 }, 200).fast, false);
  assert.equal(motion.sample({ ...camera, zoom: 0.2 }, 216).fast, true);
});

test('detail hysteresis combines zoom with projected footprint and does not chatter at either boundary', () => {
  const large = { x: 0, y: 0, width: 500, height: 400 };
  let quality;
  for (const zoom of [0.37, 0.379, 0.36]) {
    quality = canvasDetail(quality, zoom, large);
    assert.equal(quality, 'summary');
  }
  quality = canvasDetail(quality, 0.4, large);
  assert.equal(quality, 'detail');
  for (const zoom of [0.379, 0.31, 0.3])
    assert.equal(canvasDetail(quality, zoom, large), 'detail');
  assert.equal(canvasDetail(quality, 0.299, large), 'summary');
  assert.equal(
    canvasDetail(undefined, 1, { ...large, width: 20, height: 20 }),
    'summary',
  );
});

test('directional preparation is capped by the larger retention boundary', () => {
  const index = new CanvasSpatialIndex();
  index.sync(
    Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      x: i * 100 - 2000,
      y: 0,
      width: 10,
      height: 10,
    })),
  );
  const ranges = new CanvasRangeTracker();
  ranges.update(index, { x: 0, y: 0, zoom: 1, width: 500, height: 500 }, 0, {
    x: 1e9,
    y: 0,
  });
  const value = ranges.getSnapshot();
  assert.ok(value.prepare.has('35'));
  assert.equal(value.prepare.has('36'), false);
  assert.ok([...value.prepare].every((id) => value.retain.has(id)));
});

test('bounded queue ranks urgent, visible and nearby jobs and refills until all 1000 are complete', () => {
  const { timer, scheduler } = setup();
  const applied = [];
  const targets = Array.from({ length: 1000 }, (_, i) =>
    target(String(i), i === 999 ? 0 : i < 100 ? 1 : 2, i),
  );
  scheduler.setTargets(targets, false);
  for (const { id } of targets)
    scheduler.register(id, 1, {
      prepare: () => done(id),
      commit: (value) => applied.push(value),
    });
  assert.equal(scheduler.getStatus().pending, 32);
  for (let i = 0; i < 260; i++) {
    timer.flush();
    assert.ok(scheduler.getStatus().pending <= 32);
    assert.ok(scheduler.getStatus().active <= 2);
  }
  assert.equal(applied[0], '999');
  assert.equal(applied[1], '0');
  assert.equal(applied.length, 1000);
  assert.equal(timer.frames.size, 0);
});

test('A to B to C drops old queued work and only the newest camera request runs', () => {
  const { timer, scheduler } = setup();
  const ran = [];
  for (const id of ['A', 'B', 'C'])
    scheduler.register(id, 1, {
      prepare: () => {
        ran.push(id);
        return done(id);
      },
      commit() {},
    });
  for (const id of ['A', 'B', 'C']) scheduler.setTargets([target(id)], true);
  timer.flush();
  assert.deepEqual(ran, ['C']);
});

test('A to B to A never revives an uncancellable old completion and concurrent work remains bounded', async () => {
  const { timer, scheduler } = setup();
  const waiting = [],
    applied = [],
    discarded = [];
  scheduler.register('A', 1, {
    prepare: ({ signal }) =>
      new Promise((resolve) => waiting.push({ resolve, signal })),
    commit: (v) => applied.push(v),
    discard: (v) => discarded.push(v),
  });
  scheduler.setTargets([target('A')], true);
  timer.flush();
  scheduler.setTargets([target('B')], true);
  assert.equal(waiting[0].signal.aborted, true);
  scheduler.setTargets([target('A')], true);
  timer.flush();
  assert.equal(waiting.length, 2);
  assert.equal(scheduler.getStatus().active, 2);
  waiting[0].resolve(done('old'));
  await tick();
  waiting[1].resolve(done('new'));
  await tick();
  assert.deepEqual(applied, ['new']);
  assert.deepEqual(discarded, ['old']);
});

test('a harmless camera replan keeps in-flight work; priority changes do not cancel its revision', async () => {
  const { timer, scheduler } = setup();
  let resolve,
    signal,
    applied = 0;
  scheduler.register(
    'A',
    { version: 1 },
    {
      prepare: (context) => {
        signal = context.signal;
        return new Promise((r) => {
          resolve = r;
        });
      },
      commit: () => applied++,
    },
  );
  scheduler.setTargets([target('A', 2, 900)], true);
  timer.flush();
  scheduler.setTargets([target('A', 0, 1)], true);
  assert.equal(signal.aborted, false);
  resolve(done('current'));
  await tick();
  assert.equal(applied, 1);
});

test('content revision replacement, same-ID owner replacement and old cleanup cannot acknowledge a newer result', async () => {
  const { timer, scheduler } = setup();
  const waiting = [],
    applied = [];
  const work = (revision) => ({
    prepare: () =>
      new Promise((resolve) => waiting.push({ revision, resolve })),
    commit: () => applied.push(revision),
  });
  const releaseOld = scheduler.register('A', 1, work(1));
  scheduler.setTargets([target('A')], true);
  timer.flush();
  scheduler.register('A', 2, work(2));
  releaseOld();
  timer.flush();
  waiting[1].resolve(done('new'));
  await tick();
  waiting[0].resolve(done('old'));
  await tick();
  assert.deepEqual(applied, [2]);
});

test('scope expiry rejects late work even before disposal and canceled promises still occupy their slots', async () => {
  const timer = clock(),
    scheduler = new CanvasPreparationScheduler();
  let current = true;
  scheduler.connect(timer, () => current);
  const waiting = [],
    applied = [];
  for (const id of ['A', 'B', 'C'])
    scheduler.register(id, 1, {
      prepare: ({ signal }) =>
        new Promise((resolve) => waiting.push({ resolve, signal })),
      commit: (value) => applied.push(value),
    });
  scheduler.setTargets(
    ['A', 'B', 'C'].map((id) => target(id)),
    false,
  );
  timer.flush();
  assert.equal(waiting.length, 2);
  scheduler.setTargets([target('C')], false);
  timer.flush();
  assert.equal(
    waiting.length,
    2,
    'unsettled canceled promises must not free concurrency slots early',
  );
  current = false;
  waiting[0].resolve(done('late'));
  await tick();
  assert.deepEqual(applied, []);
  scheduler.stop();
  assert.equal(waiting[1].signal.aborted, true);
  assert.equal(timer.frames.size, 0);
});

test('cooperative steps advance while moving, obey per-frame slice/time limits, and finish after input settles', () => {
  const { timer, scheduler } = setup();
  let steps = 0,
    commits = 0;
  const step = () => {
    steps++;
    return steps === 12 ? done('ready') : { done: false, next: step };
  };
  scheduler.register('A', 1, { prepare: step, commit: () => commits++ });
  scheduler.setTargets([target('A')], true);
  for (let i = 0; i < 8; i++) {
    timer.flush();
    assert.equal(steps, i + 1);
    scheduler.setTargets([target('A', 1, i)], true);
  }
  scheduler.setTargets([target('A')], false);
  timer.flush();
  assert.equal(steps, 12);
  assert.equal(commits, 1);
  let slow = 0;
  for (let i = 0; i < 10; i++)
    scheduler.register(String(i), 1, {
      prepare: () => {
        slow++;
        timer.advance(5);
        return done(null);
      },
      commit() {},
    });
  scheduler.setTargets(
    Array.from({ length: 10 }, (_, i) => target(String(i))),
    false,
  );
  timer.flush();
  assert.equal(
    slow,
    1,
    'cannot preempt a synchronous slice, but must yield before the next one',
  );
});

test('failed work does not spin; an explicit new revision can retry, and a level change invalidates old work', async () => {
  const { timer, scheduler } = setup();
  let attempts = 0,
    errors = 0,
    resolve,
    applied = [];
  scheduler.register('A', 1, {
    prepare: () => {
      attempts++;
      throw Error('decode');
    },
    commit() {},
    error: () => errors++,
  });
  scheduler.setTargets([target('A')], false);
  timer.flush();
  timer.flush();
  assert.equal(attempts, 1);
  assert.equal(errors, 1);
  scheduler.register('A', 2, {
    prepare: () =>
      new Promise((r) => {
        resolve = r;
      }),
    commit: (v) => applied.push(v),
  });
  timer.flush();
  scheduler.setTargets([target('A', 1, 0, 'summary')], true);
  resolve(done('old detail'));
  await tick();
  assert.deepEqual(applied, []);
});

test('a live revision guard blocks completion before a consumer re-registers and does not spin new frames', async () => {
  const { timer, scheduler } = setup();
  let revisionCurrent = true,
    resolve,
    applied = 0,
    discarded = 0;
  scheduler.register('A', 1, {
    isCurrent: () => revisionCurrent,
    prepare: ({ revision }) => {
      assert.equal(revision, 1);
      return new Promise((r) => {
        resolve = r;
      });
    },
    commit: () => applied++,
    discard: () => discarded++,
  });
  scheduler.setTargets([target('A')], true);
  timer.flush();
  revisionCurrent = false;
  resolve(done('stale'));
  await tick();
  timer.flush();
  assert.equal(applied, 0);
  assert.equal(discarded, 1);
  assert.equal(scheduler.getStatus().pending, 0);
  assert.equal(timer.frames.size, 0);
});

test('late urgent targets preempt a full queued batch without waiting behind 32 nearby entries', () => {
  const { timer, scheduler } = setup();
  const applied = [];
  const targets = Array.from({ length: 50 }, (_, i) => target(String(i), 2, i));
  for (const { id } of targets)
    scheduler.register(id, 1, {
      prepare: () => done(id),
      commit: (v) => applied.push(v),
    });
  scheduler.setTargets(targets, true);
  scheduler.register('urgent', 1, {
    prepare: () => done('urgent'),
    commit: (v) => applied.push(v),
  });
  scheduler.setTargets([...targets, target('urgent', 0, 1000)], true);
  timer.flush();
  assert.deepEqual(applied, ['urgent']);
  assert.ok(scheduler.getStatus().pending <= 32);
});

test('a failing stale disposer or error callback cannot stall unrelated work', async () => {
  const { timer, scheduler } = setup();
  let resolve,
    applied = 0;
  scheduler.register('old', 1, {
    prepare: () =>
      new Promise((r) => {
        resolve = r;
      }),
    commit() {},
    discard() {
      throw Error('cleanup');
    },
  });
  scheduler.setTargets([target('old')], true);
  timer.flush();
  scheduler.register('bad', 1, {
    prepare() {
      throw Error('decode');
    },
    commit() {},
    error() {
      throw Error('display');
    },
  });
  scheduler.register('good', 1, {
    prepare: () => done('ready'),
    commit: () => applied++,
  });
  scheduler.setTargets([target('bad'), target('good')], false);
  resolve(done('old'));
  await tick();
  timer.flush();
  assert.equal(applied, 1);
});

test('a completion between camera input and its RAF cannot commit against the old camera plan', async () => {
  const { timer, scheduler } = setup();
  let resolve;
  const applied = [],
    discarded = [];
  scheduler.register('A', 1, {
    prepare: () =>
      new Promise((r) => {
        resolve = r;
      }),
    commit: (v) => applied.push(v),
    discard: (v) => discarded.push(v),
  });
  scheduler.setTargets([target('A')], true);
  timer.flush();
  scheduler.invalidatePlan();
  resolve(done('old screen'));
  await tick();
  assert.deepEqual(applied, []);
  assert.equal(
    scheduler.getStatus().active,
    1,
    'buffered completion still consumes its bounded slot',
  );
  scheduler.setTargets([target('C')], true);
  assert.deepEqual(applied, []);
  assert.deepEqual(discarded, ['old screen']);
});

test('a harmless pan releases a buffered current result after the new plan, while disposal discards buffered resources', async () => {
  const { timer, scheduler } = setup();
  let resolve,
    errors = 0;
  const applied = [],
    discarded = [];
  const work = {
    prepare: () =>
      new Promise((r) => {
        resolve = r;
      }),
    commit: (v) => applied.push(v),
    discard: (v) => discarded.push(v),
    error: () => errors++,
  };
  scheduler.register('A', 1, work);
  scheduler.setTargets([target('A')], true);
  timer.flush();
  scheduler.invalidatePlan();
  resolve(done('still visible'));
  await tick();
  scheduler.setTargets([target('A', 0)], true);
  assert.deepEqual(applied, ['still visible']);
  scheduler.register('A', 2, work);
  timer.flush();
  scheduler.invalidatePlan();
  resolve(done('dispose'));
  await tick();
  scheduler.stop();
  assert.deepEqual(discarded, ['dispose']);
  assert.equal(errors, 0);
  assert.equal(scheduler.getStatus().active, 0);
});

test('continuous camera input cannot starve work by repeatedly canceling the following RAF, and a frame runs only one batch', () => {
  const { timer, scheduler } = setup();
  let steps = 0;
  const step = () => {
    steps++;
    return steps === 20 ? done(null) : { done: false, next: step };
  };
  scheduler.register('visible', 1, { prepare: step, commit() {} });
  for (let i = 0; i < 20; i++) {
    scheduler.invalidatePlan();
    timer.advance(16);
    scheduler.setTargets([target('visible', 1, i)], true);
    scheduler.flushFrame(timer.now());
    scheduler.flushFrame(timer.now());
    assert.equal(
      steps,
      i + 1,
      'one preparation slice progresses on every updated display frame',
    );
  }
});
