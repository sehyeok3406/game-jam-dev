import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialNavigation, nextMaterial } from '../src/gamejam-materials.ts';

test('physical WASD navigation works with Korean keys, capitals and Shift without capturing command shortcuts', () => {
  for (const [code, key, expected] of [
    ['KeyW', 'ㅉ', 'up'],
    ['KeyA', 'ㅁ', 'left'],
    ['KeyS', 'S', 'down'],
    ['KeyD', 'ㅇ', 'right'],
    ['ArrowLeft', 'ArrowLeft', 'left'],
    ['Space', ' ', 'toggle'],
  ]) {
    assert.equal(materialNavigation({ code, key, shiftKey: true }), expected);
    assert.equal(materialNavigation({ code, key, ctrlKey: true }), null);
    assert.equal(materialNavigation({ code, key, altKey: true }), null);
  }
});
test('spatial navigation chooses aligned neighbors and stays put at an edge', () => {
  const points = [
    { id: 'center', x: 0, y: 0 },
    { id: 'right', x: 150, y: 0 },
    { id: 'diagonal', x: 10, y: 110 },
    { id: 'left', x: -100, y: 0 },
    { id: 'up', x: 0, y: -100 },
  ];
  assert.equal(
    nextMaterial(points, 'center', 'right', { x: 0, y: 0 }),
    'right',
  );
  assert.equal(nextMaterial(points, 'center', 'left', { x: 0, y: 0 }), 'left');
  assert.equal(nextMaterial(points, 'center', 'up', { x: 0, y: 0 }), 'up');
  assert.equal(
    nextMaterial(points, 'right', 'right', { x: 0, y: 0 }),
    undefined,
  );
  assert.equal(nextMaterial(points, null, 'down', { x: 140, y: 5 }), 'right');
  assert.equal(nextMaterial([], null, 'up', { x: 0, y: 0 }), undefined);
});
