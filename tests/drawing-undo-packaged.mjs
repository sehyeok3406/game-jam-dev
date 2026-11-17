import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  boot,
  js,
  key,
  mouse,
  profile,
  root,
  stop,
  wait,
} from './helpers/packaged-canvas.mjs';

async function drag(x, y, endX, endY) {
  await mouse('mousePressed', x, y);
  for (let i = 1; i <= 6; i++)
    await mouse(
      'mouseMoved',
      x + ((endX - x) * i) / 6,
      y + ((endY - y) * i) / 6,
    );
  await mouse('mouseReleased', endX, endY);
}

const drawings = () => js('window.gameCanvas.listDrawings()');
const expectDrawingCount = (count) =>
  wait(`document.querySelectorAll('.canvas-drawing-node').length === ${count} &&
        window.gameCanvas.listDrawings().then(objects => objects.length === ${count})`);

function assertRestored(restored, original) {
  assert.notEqual(restored.generation, original.generation);
  assert.deepEqual({ ...restored, generation: original.generation }, original);
}

async function changeHistory(direction) {
  const label = direction === 'undo' ? '실행 취소' : '다시 실행';
  const button = `.header-undo button[aria-label="${label}"][title*="도형 · 그림 편집"]:not(:disabled)`;
  await wait(`!!document.querySelector(${JSON.stringify(button)})`);
  await js('document.activeElement?.blur()');
  await key('z', 'KeyZ', 90, direction === 'undo' ? 2 : 10);
}

try {
  await boot();
  await js(`(async () => {
    const sheets = await window.gameCanvas.getCanvasSheets();
    await window.gameCanvas.changeCanvasSheets({
      action: 'add', id: 'drawing-test', name: '그림 테스트', expected: sheets.raw,
    });
  })()`);
  await wait('document.querySelectorAll("[role=tab]").length === 2');
  await js(`[...document.querySelectorAll('[role=tab]')]
    .find(tab => tab.textContent.includes('그림 테스트')).click()`);
  await wait('document.querySelectorAll(".react-flow__node").length === 0');

  await key('r', 'KeyR', 82);
  await wait('!!document.querySelector(".drawing-input-layer")');
  await drag(250, 230, 440, 360);
  await expectDrawingCount(1);
  const [shape] = await drawings();
  assert.equal(shape.kind, 'shape');
  await changeHistory('undo');
  await expectDrawingCount(0);
  await changeHistory('redo');
  await expectDrawingCount(1);
  const [restoredShape] = await drawings();
  assertRestored(restoredShape, shape);

  await key('p', 'KeyP', 80, 8);
  await wait('!!document.querySelector(".drawing-input-layer--pen")');
  await drag(600, 480, 900, 540);
  await expectDrawingCount(2);
  const stroke = (await drawings()).find((object) => object.kind === 'stroke');
  assert.ok(stroke.geometry.points.length > 2);
  await changeHistory('undo');
  await expectDrawingCount(1);
  await changeHistory('redo');
  await expectDrawingCount(2);
  assertRestored(
    (await drawings()).find((object) => object.id === stroke.id),
    stroke,
  );

  await key('e', 'KeyE', 69);
  await wait('!!document.querySelector(".drawing-input-layer--eraser")');
  await drag(760, 400, 760, 600);
  await expectDrawingCount(1);
  assert.deepEqual(await drawings(), [restoredShape]);
  await changeHistory('undo');
  await expectDrawingCount(2);
  assertRestored(
    (await drawings()).find((object) => object.id === stroke.id),
    stroke,
  );
  await changeHistory('redo');
  await expectDrawingCount(1);
  assert.deepEqual(await drawings(), [restoredShape]);
  console.log(
    'PASS: packaged rectangle, pen stroke and eraser Undo/Redo update disk and canvas',
  );
} catch (error) {
  console.error(
    await js(`(async () => ({
      state: await window.gameCanvas.getUndoState(),
      saved: (await window.gameCanvas.listDrawings()).map(({ kind }) => kind),
      drawn: document.querySelectorAll('.canvas-drawing-node').length,
      notice: document.querySelector('.status-toast')?.textContent,
    }))()`).catch(() => null),
  );
  throw error;
} finally {
  await stop();
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(
    path
      .resolve(profile)
      .startsWith(
        path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users') +
          path.sep,
      ),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
