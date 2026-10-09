import test from 'node:test';
import { installUiDebugShortcut } from '../src/ui-debug-shortcut.ts';
import assert from 'node:assert/strict';
import {
  UI_DEBUG_ENTRIES,
  uiDebugEntries,
  validUiDebugSelection,
} from '../src/ui/debug/uiDebugRegistry.ts';
import {
  createUiPreviewApi,
  SAMPLE_DOCUMENT,
} from '../src/ui/debug/uiDebugFixtures.ts';

test('desktop F12 consumes DevTools shortcut, ignores repeats and sends one toggle', () => {
  let handle;
  const sent = [];
  let prevented = 0;
  installUiDebugShortcut({
    on: (name, callback) => {
      assert.equal(name, 'before-input-event');
      handle = callback;
    },
    send: (channel) => sent.push(channel),
  });
  const event = { preventDefault: () => prevented++ };
  handle(event, { type: 'keyDown', key: 'F12', isAutoRepeat: false });
  handle(event, { type: 'keyDown', key: 'F12', isAutoRepeat: true });
  handle(event, { type: 'keyUp', key: 'F12', isAutoRepeat: false });
  handle(event, { type: 'keyDown', key: 'F11', isAutoRepeat: false });
  assert.deepEqual(sent, ['ui-debug:toggle']);
  assert.equal(prevented, 3);
});

test('UI catalog separates home and project and validates every state', () => {
  assert.equal(
    new Set(UI_DEBUG_ENTRIES.map((item) => item.id)).size,
    UI_DEBUG_ENTRIES.length,
  );
  assert(!uiDebugEntries('home').some((item) => item.id === 'editor'));
  assert(!uiDebugEntries('project').some((item) => item.id === 'home-create'));
  for (const scope of ['home', 'project']) {
    assert(uiDebugEntries(scope).some((item) => item.id === 'collaboration'));
    assert(uiDebugEntries(scope).some((item) => item.id === 'update'));
    for (const item of uiDebugEntries(scope))
      for (const state of item.states)
        assert(
          validUiDebugSelection({ scope, id: item.id, state, theme: 'dark' }),
        );
  }
  assert(
    !validUiDebugSelection({
      scope: 'home',
      id: 'delete',
      state: 'document',
      theme: 'dark',
    }),
  );
  assert(
    !validUiDebugSelection({
      scope: 'project',
      id: 'editor',
      state: 'unknown',
      theme: 'dark',
    }),
  );
});

test('preview API blocks mutations and unknown methods without changing fixture data', async () => {
  const blocked = [];
  const api = createUiPreviewApi(
    { scope: 'project', id: 'document', state: 'idea', theme: 'dark' },
    (method) => blocked.push(method),
  );
  const before = await api.listDocuments();
  assert.equal(
    api.selfHost,
    undefined,
    'optional namespaces must not become callable fallback functions',
  );
  for (const [method, args] of [
    ['saveDocument', [{ ...SAMPLE_DOCUMENT, body: 'changed' }]],
    [
      'deleteDocument',
      [
        {
          documentId: SAMPLE_DOCUMENT.id,
          relativePath: SAMPLE_DOCUMENT.relativePath,
        },
      ],
    ],
    [
      'joinCollaboration',
      [{ serverUrl: 'https://example.invalid', code: 'abc', nickname: 'test' }],
    ],
    ['startCodexRun', [{}]],
    ['installUpdate', []],
    ['publishWebViewer', [{}]],
    ['setEditorDraft', ['draft', {}, 1]],
    ['copyText', ['text']],
    ['futureUnknownOperation', []],
  ])
    await assert.rejects(
      api[method](...args),
      /실제 작업은 실행하지 않았습니다/,
    );
  assert.equal(blocked.length, 9);
  assert.deepEqual(await api.listDocuments(), before);
  const cloned = await api.listDocuments();
  cloned[0].body = 'mutating a returned value';
  assert.deepEqual(await api.listDocuments(), before);
  assert.equal(
    typeof api.onWorkspaceChanged(() => assert.fail('no real events')),
    'function',
  );
});
