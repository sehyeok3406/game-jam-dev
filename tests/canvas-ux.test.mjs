import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canvasShortcut,
  markdownEdit,
  snapPosition,
} from '../src/canvas-ux.ts';
import { EditJournal, invertEdit } from '../src/edit-journal.ts';

test('canvas shortcuts respect text, dialogs and playable iframe focus', () => {
  for (const scope of [{ editable: true }, { dialog: true }, { playing: true }])
    for (const key of ['n', 'Delete', 'z', 'a', 'Enter', ' '])
      assert.equal(canvasShortcut({ key, ctrlKey: true }, scope), null);
  assert.equal(canvasShortcut({ key: 'd', ctrlKey: true }, {}), 'duplicate');
  assert.equal(canvasShortcut({ key: 'i', ctrlKey: true }, {}), 'import');
  assert.equal(
    canvasShortcut({ key: 'Z', ctrlKey: true, shiftKey: true }, {}),
    'redo',
  );
  assert.equal(
    canvasShortcut({ key: 'Enter', ctrlKey: true, shiftKey: true }, {}),
    'implement',
  );
  assert.equal(canvasShortcut({ key: '!', shiftKey: true }, {}), 'fit');
  assert.equal(
    canvasShortcut({ key: '@', shiftKey: true }, {}),
    'selection-fit',
  );
  assert.equal(canvasShortcut({ key: ' ', repeat: true }, {}), null);
  assert.equal(canvasShortcut({ key: 'n', altKey: true }, {}), null);
});

test('Markdown helpers preserve surrounding text and create GFM table and checkbox syntax', () => {
  assert.equal(markdownEdit('앞 제목 뒤', 2, 4, 'bold').body, '앞 **제목** 뒤');
  assert.equal(
    markdownEdit('앞 제목 뒤', 2, 4, 'heading').body,
    '앞 \n## 제목 뒤',
  );
  assert.equal(
    markdownEdit('첫째\n둘째', 0, 5, 'check').body,
    '- [ ] 첫째\n- [ ] 둘째',
  );
  const table = markdownEdit('표', 1, 1, 'table');
  assert.match(table.body, /\| --- \| --- \|/);
  assert.equal(
    table.body.slice(table.start, table.end),
    '\n\n| 항목 | 내용 |\n| --- | --- |\n| 항목 | 내용 |\n\n',
  );
});

test('smart guides snap nearest edges or centers only within zoom-adjusted tolerance', () => {
  const other = [{ x: 100, y: 100, width: 100, height: 100 }];
  const snapped = snapPosition(
    { x: 102, y: 97, width: 100, height: 100 },
    other,
    6,
  );
  assert.equal(snapped.x, 100);
  assert.equal(snapped.y, 100);
  const unsnapped = snapPosition(
    { x: 130, y: 130, width: 100, height: 100 },
    other,
    6,
  );
  assert.equal(unsnapped.xGuide, undefined);
  assert.equal(unsnapped.x, 130);
});

test('session edit journal retains order, clears redo on a new edit, and caps records', () => {
  const journal = new EditJournal();
  assert.throws(() => journal.peek('undo'), /없습니다/);
  for (let i = 0; i < 105; i++)
    journal.push({ id: String(i), label: String(i) });
  assert.equal(journal.undoStack.length, 100);
  assert.throws(() => journal.finish('undo', '103'), /순서/);
  journal.finish('undo', '104');
  assert.deepEqual(journal.state, { undo: '103', redo: '104' });
  journal.finish('redo', '104');
  journal.finish('undo', '104');
  journal.push({ id: 'new', label: '새 작업' });
  assert.equal(journal.state.redo, null);
});

test('undo and redo change only affected files and handle creation and deletion', () => {
  const before = { a: 'old', c: 'deleted' },
    after = { a: 'new', b: 'created' };
  const current = { ...after, other: 'collaborator' };
  const reverted = invertEdit(current, before, after, 'undo');
  assert.deepEqual(reverted, { ...before, other: 'collaborator' });
  assert.deepEqual(invertEdit(reverted, before, after, 'redo'), current);
  assert.deepEqual(current, { ...after, other: 'collaborator' });
});

test('one conflicting file prevents the entire undo and never mutates the caller snapshot', () => {
  const current = { a: 'changed by another member', b: 'new' };
  assert.throws(
    () =>
      invertEdit(
        current,
        { a: 'old', b: 'old' },
        { a: 'new', b: 'new' },
        'undo',
      ),
    /충돌/,
  );
  assert.equal(current.b, 'new');
});
