import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCanvasKanban,
  migrateKanbanLayout,
  blankBoardPosition,
  defaultCanvasKanban,
} from '../src/features/kanban/preferences.ts';

test('legacy screen board migrates to canvas coordinates with the viewport zoom', () => {
  const value = migrateKanbanLayout(
    JSON.stringify({
      enabled: true,
      minimized: true,
      scope: 'project',
      x: 100,
      y: 200,
      width: 800,
      height: 400,
    }),
    (p) => ({ x: (p.x - 20) / 0.5, y: (p.y - 40) / 0.5 }),
    0.5,
  );
  assert.deepEqual(value, {
    enabled: true,
    minimized: true,
    scope: 'project',
    x: 160,
    y: 320,
    width: 1600,
    height: 800,
    placed: true,
  });
  assert.equal(
    migrateKanbanLayout(null, (p) => p, 1),
    null,
  );
  assert.equal(
    migrateKanbanLayout('invalid', (p) => p, 1),
    null,
  );
});

test('saved board rejects invalid dimensions and retains negative canvas coordinates', () => {
  assert.deepEqual(
    readCanvasKanban({
      enabled: true,
      placed: true,
      x: -220,
      y: NaN,
      width: Infinity,
      height: 1,
      scope: 'unknown',
    }),
    {
      ...defaultCanvasKanban,
      enabled: true,
      placed: true,
      x: -220,
      height: 260,
    },
  );
});

test('initial board placement avoids documents and sections with a margin', () => {
  const bounds = [
    { x: 0, y: 0, width: 900, height: 600 },
    { x: 1000, y: 0, width: 340, height: 300 },
  ];
  const p = blankBoardPosition({ x: 80, y: 80 }, bounds, 960, 520);
  assert.ok(
    bounds.every(
      (b) =>
        p.x >= b.x + b.width + 40 ||
        p.x + 960 + 40 <= b.x ||
        p.y >= b.y + b.height + 40 ||
        p.y + 520 + 40 <= b.y,
    ),
  );
});

test('crowded canvas falls back below every occupied rectangle', () => {
  const p = blankBoardPosition(
    { x: 0, y: 0 },
    [{ x: -100, y: -100, width: 10000, height: 10000 }],
    960,
    520,
  );
  assert.deepEqual(p, { x: 0, y: 9940 });
});
