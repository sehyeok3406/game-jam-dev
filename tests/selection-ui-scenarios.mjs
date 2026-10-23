import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { shapeFromDrag, DEFAULT_SHAPE_STYLE } from '../src/drawing-geometry.ts';

/** Identical UI interactions run against the fixture and the real Windows package. */
export async function selectionUiScenarios({ js, key, wait, screenshot }) {
  const call = (method, ...args) =>
    js(
      `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
    );
  const blur = () => js('document.activeElement?.blur()');
  const shortcut = async (name, modifier = []) => {
    await blur();
    await key(name, modifier);
  };
  const workspace = await call('getWorkspace');
  await call('applyDrawingCommand', {
    scope: workspace.saveScope,
    canvasId: 'default',
    action: 'create',
    objects: [
      {
        id: randomUUID(),
        generation: randomUUID(),
        kind: 'shape',
        ...shapeFromDrag('rectangle', { x: 300, y: 350 }, { x: 500, y: 450 }),
        style: DEFAULT_SHAPE_STYLE,
        layer: 'background',
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  const originals = await call('listDocuments'),
    drawings = await call('listDrawings');
  const count = originals.length,
    drawingCount = drawings.length;
  await wait(
    `document.querySelectorAll('.react-flow__node-document').length===${count} && document.querySelectorAll('.react-flow__node-drawing').length===${drawingCount}`,
  );
  await shortcut('A', ['control']);
  await wait(
    `document.querySelectorAll('.react-flow__node-document.selected').length===${count}`,
  );
  const beforeCopy = (await call('listHistory')).length;
  await shortcut('D', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.length===${count * 2})`,
  );
  await wait(
    `document.querySelector('.status-toast').textContent.includes('문서를 복제했습니다')`,
  );
  assert.equal((await call('listDrawings')).length, drawingCount * 2);
  assert.equal((await call('listHistory')).length, beforeCopy + 1);
  const copies = (await call('listDocuments')).filter(
    (doc) => !originals.some((original) => original.id === doc.id),
  );
  assert.equal(copies.length, count);
  const beforeArrange = (await call('listHistory')).length;
  await wait(
    `Array.from(document.querySelectorAll('summary')).some(e=>e.textContent.includes('정렬·간격')) && document.querySelectorAll('.react-flow__node-document.selected').length===${count}`,
  );
  await js(
    `Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('정렬·간격')).click()`,
  );
  await js(
    `Array.from(document.querySelectorAll('[aria-label="선택 항목 정렬 및 간격"] button')).find(e=>e.textContent.trim()==='왼쪽 맞춤').click()`,
  );
  await wait(
    `document.querySelector('.status-toast').textContent.includes('항목의 배치를 정리했습니다')`,
  );
  const aligned = (await call('listDocuments')).filter((doc) =>
    copies.some((copy) => copy.id === doc.id),
  );
  assert.equal(new Set(aligned.map((doc) => doc.x)).size, 1);
  assert.equal((await call('listHistory')).length, beforeArrange + 1);
  await shortcut('Z', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>${JSON.stringify(copies)}.every(c=>d.some(x=>x.id===c.id&&x.x===c.x)))`,
  );
  await shortcut('Z', ['control']);
  await wait(`window.gameCanvas.listDocuments().then(d=>d.length===${count})`);
  assert.equal((await call('listDrawings')).length, drawingCount);
  await shortcut('Y', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.length===${count * 2})`,
  );
  console.log(
    'PASS: actual UI mixed document/drawing duplicate and alignment each record once; undo/redo restore identities, positions and original drawings',
  );
  await wait(
    `document.querySelector('.status-toast')?.textContent.includes('내 작업을 다시 실행했습니다.')`,
  );
  await shortcut('A', ['control']);
  await wait(
    `document.querySelectorAll('.react-flow__node-document.selected').length===${count * 2}`,
  );
  await shortcut('Delete');
  await wait('!!document.querySelector("[data-ui-id=delete-many]")');
  const beforeDelete = (await call('listHistory')).length;
  if (screenshot) await screenshot();
  await wait(
    '!!document.querySelector("[data-ui-id=delete-many] .button-danger:not(:disabled)")',
  );
  await js(
    `{const button=document.querySelector('[data-ui-id=delete-many] .button-danger');button.click();button.click();}`,
  );
  await wait('!document.querySelector("[data-ui-id=delete-many]")');
  await wait('window.gameCanvas.listDocuments().then(d=>d.length===0)');
  assert.equal((await call('listDrawings')).length, 0);
  assert.equal((await call('listHistory')).length, beforeDelete + 1);
  await shortcut('Z', ['control']);
  await wait(
    `window.gameCanvas.listDocuments().then(d=>d.length===${count * 2})`,
  );
  assert.equal((await call('listDrawings')).length, drawingCount * 2);
  for (const original of originals) {
    const restored = (await call('listDocuments')).find(
      (doc) => doc.id === original.id,
    );
    assert.equal(restored.body, original.body);
    assert.equal(restored.relativePath, original.relativePath);
  }
  console.log(
    'PASS: actual delete confirmation double-click publishes one mixed batch and undo restores documents/drawings with original bodies',
  );
  const sheets = await call('getCanvasSheets');
  await call('changeCanvasSheets', {
    action: 'add',
    id: 'selection-other',
    name: '선택 경계 검사',
    expected: sheets.raw ?? null,
  });
  await wait(
    `Array.from(document.querySelectorAll('[role=tab]')).some(e=>e.textContent.includes('선택 경계 검사'))`,
  );
  await shortcut('A', ['control']);
  await shortcut('Delete');
  await wait('!!document.querySelector("[data-ui-id=delete-many]")');
  await js(
    `Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.includes('선택 경계 검사')).click()`,
  );
  await wait('!document.querySelector("[data-ui-id=delete-many]")');
  await js(
    `Array.from(document.querySelectorAll('[role=tab]')).find(e=>!e.textContent.includes('선택 경계 검사')).click()`,
  );
  await wait(
    `document.querySelectorAll('.react-flow__node-document').length===${count * 2}`,
  );
  assert.equal(
    await js('!!document.querySelector("[data-ui-id=delete-many]")'),
    false,
  );
  console.log(
    'PASS: actual canvas round trip expires the old deletion confirmation instead of authorizing another view',
  );
  const previews = await call('listPreviews');
  assert.ok(
    previews.length,
    'The UI regression requires an HTML preview fixture',
  );
  if (previews.length) {
    await wait('!!document.querySelector(".react-flow__node-preview")');
    await js(
      `document.querySelector('.react-flow__node-preview').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:200,button:2}))`,
    );
    await wait('!!document.querySelector("[data-ui-id=preview-menu]")');
    await js(
      `Array.from(document.querySelectorAll('[data-ui-id=preview-menu] button')).find(button=>button.querySelector('strong')?.textContent==='삭제').click()`,
    );
    await wait('!!document.querySelector("[data-ui-id=delete]")');
    const before = (await call('listHistory')).length;
    await wait(
      '!!document.querySelector("[data-ui-id=delete] .button-danger:not(:disabled)")',
    );
    await js(
      `document.querySelector('[data-ui-id=delete] .button-danger').click()`,
    );
    await wait('!document.querySelector("[data-ui-id=delete]")');
    await wait(
      `window.gameCanvas.listPreviews().then(p=>p.length===${previews.length - 1})`,
    );
    assert.equal((await call('listHistory')).length, before + 1);
    await shortcut('Z', ['control']);
    await wait(
      `window.gameCanvas.listPreviews().then(p=>p.length===${previews.length})`,
    );
    console.log(
      'PASS: actual single HTML deletion confirmation removes the selected preview once and Undo restores it',
    );
  }
}
