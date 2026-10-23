import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeGroup } from '../src/ui/canvas/group-resize.ts';

const boxes = [
  {
    id: 'file',
    x: 100,
    y: 120,
    width: 400,
    height: 300,
    minWidth: 260,
    minHeight: 180,
  },
  {
    id: 'html',
    x: 700,
    y: 520,
    width: 720,
    height: 460,
    minWidth: 420,
    minHeight: 300,
  },
];
test('different-sized file and HTML receive equal deltas without scaling their spacing', () => {
  const result = resizeGroup(boxes, boxes[0], {
    ...boxes[0],
    width: 500,
    height: 350,
  });
  assert.deepEqual(
    result.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [
      { x: 100, y: 120, width: 500, height: 350 },
      { x: 700, y: 520, width: 820, height: 510 },
    ],
  );
  assert.equal(boxes[0].width, 400);
});
test('left and top handles keep each opposite edge fixed, including negative and section-relative coordinates', () => {
  const inputs = boxes.map((box) => ({
    ...box,
    x: box.x - 600,
    y: box.y - 300,
  }));
  const primary = inputs[1];
  const result = resizeGroup(inputs, primary, {
    x: primary.x - 80,
    y: primary.y - 40,
    width: primary.width + 80,
    height: primary.height + 40,
  });
  result.forEach((box, index) => {
    assert.equal(box.x + box.width, inputs[index].x + inputs[index].width);
    assert.equal(box.y + box.height, inputs[index].y + inputs[index].height);
  });
});
test('a large shrink stops every item exactly when any item reaches its minimum', () => {
  const result = resizeGroup(boxes, boxes[1], {
    ...boxes[1],
    width: 420,
    height: 300,
  });
  assert.deepEqual(
    result.map((box) => [box.width, box.height]),
    [
      [260, 180],
      [580, 340],
    ],
  );
  const reversed = resizeGroup(boxes, boxes[1], {
    ...boxes[1],
    width: 760,
    height: 480,
  });
  assert.deepEqual(
    reversed.map((box) => [box.width, box.height]),
    [
      [440, 320],
      [760, 480],
    ],
  );
});
test('side handles leave the other axis unchanged and top-left minimum does not shift the opposite edge', () => {
  const result = resizeGroup(boxes, boxes[0], {
    ...boxes[0],
    x: 350,
    width: 150,
  });
  result.forEach((box, index) => {
    assert.equal(box.height, boxes[index].height);
    assert.equal(box.y, boxes[index].y);
    assert.equal(box.x + box.width, boxes[index].x + boxes[index].width);
    assert.equal(box.width - boxes[index].width, -140);
  });
});
