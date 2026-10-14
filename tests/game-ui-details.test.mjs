import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  newGameUiItem,
  applyGameUi,
  gameUiPath,
  readGameUi,
  mergeGameUi,
} from '../src/game-ui-model.ts';
import {
  gameUiStyle,
  gameUiRatio,
  gameUiRangePatch,
  gameUiValueText,
  gameUiFillColor,
  gameUiBounds,
  gameUiResize,
} from '../src/game-ui-details.ts';
const frame = () => ({
  version: 1,
  id: randomUUID(),
  generation: randomUUID(),
  canvasId: 'default',
  title: 'Details',
  x: 0,
  y: 0,
  width: 720,
  viewportWidth: 1920,
  viewportHeight: 1080,
  items: [newGameUiItem('health', randomUUID)],
  descriptionPath: null,
});
const patch = (f, item, changes) => ({
  id: f.id,
  generation: f.generation,
  action: 'patch',
  patches: [
    {
      id: item.id,
      generation: item.generation,
      changes,
      expected: Object.fromEntries(
        Object.keys(changes).map((k) => [k, item[k]]),
      ),
    },
  ],
});
const raw = (f) => JSON.stringify(f),
  files = (f) => ({ [gameUiPath(f.id)]: raw(f) });
test('legacy files retain their exact serialized data; effective styles match legacy defaults without migration writes', () => {
  const f = frame();
  assert.deepEqual(readGameUi(raw(f)), f);
  const i = f.items[0],
    s = gameUiStyle(i);
  assert.equal(s.borderWidth, 2);
  assert.equal(s.fillOpacity, 0.65);
  assert.equal(s.cornerRadius, 10);
  assert.equal(i.minimum, undefined);
  assert.equal(s.backgroundColor, '#f1f5f9');
  assert.equal(
    gameUiStyle(newGameUiItem('button', randomUUID)).backgroundColor,
    '#ced5de',
  );
});
test('nonzero and negative minima normalize values; shrinking bounds clamps atomically and invalid ranges reject', () => {
  const i = {
    ...newGameUiItem('health', randomUUID),
    minimum: 20,
    maximum: 100,
    value: 60,
    decimals: 1,
  };
  assert.equal(gameUiRatio(i), 0.5);
  assert.equal(gameUiValueText({ ...i, valueFormat: 'percent' }), '체력 50.0%');
  assert.deepEqual(gameUiRangePatch(i, { maximum: 40 }), {
    minimum: 20,
    maximum: 40,
    value: 40,
  });
  assert.throws(() => gameUiRangePatch(i, { maximum: 20 }));
  assert.equal(
    gameUiRatio({ ...i, minimum: -100, maximum: 100, value: 0 }),
    0.5,
  );
});
test('invalid detailed styles, rules, ranges and cooldown pairs never publish a partial mutation', () => {
  const f = frame(),
    i = f.items[0],
    base = files(f);
  for (const change of [
    { borderOpacity: 2 },
    { backgroundColor: 'red' },
    { rotation: NaN },
    { cornerRadii: [1, 2] },
    { segments: 1.5 },
    {
      thresholds: [
        { below: 50, color: '#ff0000' },
        { below: 20, color: '#ffff00' },
      ],
    },
    { stateStyles: { hover: { minimum: 4 } } },
    { minimum: 90 },
    { maximum: 0 },
  ])
    assert.throws(
      () => applyGameUi(base, patch(f, i, change)),
      JSON.stringify(change),
    );
  assert.deepEqual(base, files(f));
  const skills = {
    ...newGameUiItem('skills', randomUUID),
    slots: [
      {
        id: randomUUID(),
        label: 'Q',
        quantity: 0,
        cooldown: 0,
        cooldownTotal: 10,
        cooldownRemaining: 11,
      },
    ],
    count: 1,
  };
  assert.throws(() => readGameUi(raw({ ...f, items: [skills] })));
});
test('first optional-field CAS survives JSON transport and unrelated appearance changes merge online and offline', () => {
  const f = frame(),
    i = f.items[0],
    base = files(f),
    a = patch(f, i, { borderColor: '#ff0000' }),
    b = patch(f, i, { backgroundColor: '#000000' });
  const remote = applyGameUi(base, JSON.parse(JSON.stringify(a))),
    both = applyGameUi(remote, JSON.parse(JSON.stringify(b))),
    out = readGameUi(both[gameUiPath(f.id)]).items[0];
  assert.equal(out.borderColor, '#ff0000');
  assert.equal(out.backgroundColor, '#000000');
  const local = applyGameUi(base, b);
  assert.deepEqual(
    JSON.parse(
      mergeGameUi(raw(f), local[gameUiPath(f.id)], remote[gameUiPath(f.id)]),
    ).items[0],
    out,
  );
  assert.throws(() =>
    applyGameUi(remote, patch(f, i, { borderColor: '#ffffff' })),
  );
});
test('range Undo preserves teammate appearance while conflicting range edits refuse overwrite', () => {
  const f = frame(),
    i = f.items[0],
    base = raw(f),
    changed = applyGameUi(
      files(f),
      patch(f, i, gameUiRangePatch(i, { minimum: 20, value: 60 })),
    )[gameUiPath(f.id)],
    other = applyGameUi(
      { [gameUiPath(f.id)]: changed },
      patch(f, readGameUi(changed).items[0], { borderWidth: 7 }),
    )[gameUiPath(f.id)],
    undone = readGameUi(mergeGameUi(changed, base, other, true)).items[0];
  assert.equal(undone.value, 75);
  assert.equal(undone.minimum, undefined);
  assert.equal(undone.borderWidth, 7);
  const conflicting = raw({ ...f, items: [{ ...i, maximum: 200 }] });
  assert.throws(() => mergeGameUi(base, changed, conflicting));
});
test('rotation resize keeps opposite corner fixed; rotated bounds guide snapping', () => {
  const i = {
    ...newGameUiItem('panel', randomUUID),
    x: 50,
    y: 70,
    width: 100,
    height: 50,
    rotation: 90,
  };
  const b = gameUiBounds(i);
  assert.ok(Math.abs(b.width - 50) < 1e-8);
  assert.ok(Math.abs(b.height - 100) < 1e-8);
  const q = gameUiResize(i, -20, 30);
  assert.ok(Math.abs(q.width - 130) < 1e-8);
  assert.ok(Math.abs(q.height - 70) < 1e-8);
  const corner = (v) => ({
    x: v.x + v.width / 2 + v.height / 2,
    y: v.y + v.height / 2 - v.width / 2,
  });
  assert.deepEqual(corner({ ...i, ...q }), corner(i));
});
test('threshold boundaries and state style overrides remain separate from default styles', () => {
  const i = {
    ...newGameUiItem('health', randomUUID),
    value: 20,
    thresholds: [
      { below: 20, color: '#ff0000' },
      { below: 50, color: '#ffff00' },
    ],
    backgroundColor: '#222222',
    stateStyles: {
      hover: { backgroundColor: '#aaaaaa' },
      disabled: { opacity: 0.2 },
    },
  };
  assert.equal(gameUiFillColor(i), '#ff0000');
  assert.equal(gameUiFillColor({ ...i, value: 21 }), '#ffff00');
  assert.equal(gameUiStyle(i).backgroundColor, '#222222');
  assert.equal(gameUiStyle(i, 'hover').backgroundColor, '#aaaaaa');
  assert.equal(gameUiStyle(i, 'disabled').opacity, 0.2);
});
