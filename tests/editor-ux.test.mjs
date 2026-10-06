import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  editorToolPosition,
  editorCommands,
  slashQuery,
  drainEditorDraft,
  SourceHistory,
  editorDraftMatches,
} from '../src/editor-ux.ts';

test('draft base comparisons tolerate storage normalization but detect external text changes', () => {
  assert.equal(
    editorDraftMatches(
      { title: ' ', body: '\n본문\n' },
      { title: '제목 없음', body: '본문' },
    ),
    true,
  );
  assert.equal(
    editorDraftMatches(
      { title: '제목', body: '본문' },
      { title: '새 제목', body: '본문' },
    ),
    false,
  );
  assert.equal(
    editorDraftMatches(
      { title: '제목', body: '본문' },
      { title: '제목', body: '외부 변경' },
    ),
    false,
  );
});

test('screen-space toolbar follows the card and stays inside the viewport', () => {
  assert.deepEqual(
    editorToolPosition(
      { left: 100, top: 200, bottom: 400 },
      { width: 1280, height: 720 },
      350,
      50,
    ),
    { left: 100, top: 142 },
  );
  assert.deepEqual(
    editorToolPosition(
      { left: 1200, top: 5, bottom: 100 },
      { width: 1280, height: 720 },
      350,
      50,
    ),
    { left: 918, top: 108 },
  );
  assert.deepEqual(
    editorToolPosition(
      { left: -500, top: 900, bottom: 1000 },
      { width: 400, height: 300 },
      350,
      200,
    ),
    { left: 12, top: 88 },
  );
});
test('slash commands support Korean/English searches without triggering inside code or IME', () => {
  assert.equal(slashQuery('/표', true, false), '표');
  assert.equal(slashQuery('/table', true, false), 'table');
  for (const text of ['경로 /table', '//', '/two words', '/' + 'a'.repeat(25)])
    assert.equal(slashQuery(text, true, false), null);
  assert.equal(slashQuery('/표', false, false), null);
  assert.equal(slashQuery('/표', true, true), null);
  assert.deepEqual(
    editorCommands('표').map((c) => c.id),
    ['table'],
  );
  assert.deepEqual(
    editorCommands('CHECK').map((c) => c.id),
    ['task'],
  );
  assert.equal(editorCommands('not-a-command').length, 0);
});
test('finish drains edits typed during pending writes; autosave writes once; failure never marks draft as saved', async () => {
  let latest = { title: '메모', body: '하나' },
    saved = { title: '메모', body: '' };
  const writes = [];
  await drainEditorDraft(
    () => latest,
    () => saved,
    async (draft) => {
      writes.push(draft.body);
      if (writes.length === 1) latest = { title: '새 제목', body: '둘' };
      await Promise.resolve();
      saved = draft;
    },
    true,
  );
  assert.deepEqual(writes, ['하나', '둘']);
  assert.deepEqual(saved, latest);
  await drainEditorDraft(
    () => latest,
    () => saved,
    async () => assert.fail('unchanged draft must not write'),
    true,
  );
  latest = { ...latest, body: '셋' };
  await drainEditorDraft(
    () => latest,
    () => saved,
    async (draft) => {
      latest = { ...latest, body: '넷' };
      saved = draft;
    },
    false,
  );
  assert.equal(saved.body, '셋');
  assert.equal(latest.body, '넷');
  await assert.rejects(
    drainEditorDraft(
      () => latest,
      () => saved,
      async () => {
        throw Error('offline');
      },
      true,
    ),
    /offline/,
  );
  assert.equal(saved.body, '셋');
  assert.equal(latest.body, '넷');
});
test('raw Markdown undo includes formatting, groups typing, and clears redo on new edits', () => {
  const h = new SourceHistory();
  const a = { value: '본문', start: 0, end: 2 },
    b = { value: '*본문*', start: 1, end: 3 };
  h.record(a);
  assert.deepEqual(h.move('undo', b), a);
  assert.deepEqual(h.move('redo', a), b);
  h.reset();
  h.record(a, true, 1000);
  h.record(b, true, 1100);
  assert.deepEqual(
    h.move('undo', { value: '*본문* 추가', start: 8, end: 8 }),
    a,
  );
  h.record(a);
  assert.equal(h.move('redo', b), null);
  for (let i = 0; i < 110; i++)
    h.record({ value: String(i), start: 0, end: 0 });
  for (let i = 0; i < 100; i++) assert.ok(h.move('undo', a));
  assert.equal(h.move('undo', a), null);
});
