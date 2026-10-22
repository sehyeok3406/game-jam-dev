import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanvasCollapseActions,
  sectionViewCollapsed,
  selectionShouldExpand,
} from '../src/ui/canvas/collapse-actions.ts';

const doc = {
  id: 'a',
  relativePath: 'docs/a.md',
  title: '원문',
  collapsed: false,
};
const section = {
  id: 's',
  relativePath: 'sections/s.md',
  members: [{ id: 'a', path: 'docs/a.md' }],
};
const preview = {
  kind: 'preview',
  relativePath: 'output/index.html',
  windowState: {
    x: 1,
    y: 2,
    width: 640,
    height: 480,
    collapsed: false,
    presetId: 'custom',
    freeSize: { width: 640, height: 480 },
  },
};
const scope = () => ({
  root: 'temp',
  saveScope: 'durable',
  sessionId: 'session',
  epoch: 1,
  canvasId: 'default',
  viewEpoch: 0,
  home: false,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
function setup() {
  const events = [],
    errors = [],
    notices = [],
    busy = [];
  const ports = {
    scope: scope(),
    busy: false,
    canCollapse: (paths) => {
      events.push(['allowed', paths]);
      return true;
    },
    editor: {
      setDocumentCollapsed: async (input) => {
        events.push(['document', input]);
      },
    },
    flush: async (guard, mode) => {
      events.push(['flush', mode]);
      guard();
    },
    sectionViews: (ids, value) => events.push(['sections', ids, value]),
    clearTemporarySections: (ids) => events.push(['temporary-sections', ids]),
    clearTemporaryDocument: (id) => events.push(['temporary-document', id]),
    selectCollapsedSection: (s) => events.push(['select-section', s.id]),
    savePreview: async (relative, state, guard) => {
      guard();
      events.push(['preview', relative, state]);
    },
    reload: async () => events.push('reload'),
    notice: (n) => notices.push(n),
    error: (e) => errors.push(e),
  };
  return {
    ports,
    events,
    errors,
    notices,
    busy,
    service: new CanvasCollapseActions(
      () => ports,
      (s, b) => busy.push([s, b]),
    ),
  };
}
test('effective section collapse keeps search and temporary reveal separate from stored preference', () => {
  assert.equal(sectionViewCollapsed('s', { s: true }, false, []), true);
  assert.equal(sectionViewCollapsed('s', { s: true }, true, []), false);
  assert.equal(sectionViewCollapsed('s', { s: true }, false, ['s']), false);
  assert.equal(sectionViewCollapsed('other', { s: true }, false, []), false);
  for (const target of [
    { kind: 'document', document: { ...doc, collapsed: true } },
    { ...preview, windowState: { ...preview.windowState, collapsed: true } },
    { kind: 'section', section, collapsed: true },
    { kind: 'kanban', collapsed: true, update: () => {} },
  ])
    assert.equal(selectionShouldExpand([target]), true);
  assert.equal(
    selectionShouldExpand([{ kind: 'document', document: doc }, preview]),
    false,
  );
});
test('document header and menu keep the same IPC without extra flush, while only the menu reports success', async () => {
  for (const menu of [false, true]) {
    const h = setup();
    let accepted = 0;
    await h.service.document(doc, { menu }, () => accepted++);
    assert.deepEqual(h.events.find((e) => e[0] === 'document')[1], {
      relativePath: 'docs/a.md',
      collapsed: true,
    });
    assert.ok(!h.events.some((e) => e[0] === 'flush'));
    assert.equal(accepted, 1);
    assert.equal(h.notices.length, Number(menu));
  }
});
test('temporary document reveal closes without changing Markdown or the personal backend state', async () => {
  const h = setup();
  await h.service.document({ ...doc, collapsed: true }, { temporary: true });
  assert.ok(
    h.events.some((e) => e[0] === 'temporary-document' && e[1] === 'a'),
  );
  assert.ok(!h.events.some((e) => e[0] === 'document' || e === 'reload'));
  assert.equal(h.notices.length, 0);
});
test('single section collapse flushes only captured editors and changes only personal views and selection', async () => {
  const h = setup();
  await h.service.section(section, false);
  assert.deepEqual(
    h.events.find((e) => e[0] === 'flush'),
    ['flush', 'editors'],
  );
  assert.deepEqual(
    h.events.find((e) => e[0] === 'sections'),
    ['sections', ['s'], true],
  );
  assert.deepEqual(
    h.events.find((e) => e[0] === 'temporary-sections'),
    ['temporary-sections', ['s']],
  );
  assert.ok(h.events.some((e) => e[0] === 'select-section'));
  assert.ok(!h.events.some((e) => e[0] === 'document' || e === 'reload'));
  assert.deepEqual(h.events[0][1], ['sections/s.md', 'docs/a.md']);
  const expand = setup();
  await expand.service.section(section, true);
  assert.ok(!expand.events.some((e) => e[0] === 'select-section'));
});
test('mixed minimize preserves sequential native documents, personal sections/kanban and preview fields', async () => {
  const h = setup();
  const targets = [
    { kind: 'document', document: doc },
    { kind: 'section', section, collapsed: false },
    { kind: 'section', section: { ...section, id: 'next' }, collapsed: false },
    preview,
    {
      kind: 'kanban',
      collapsed: false,
      update: (v) => h.events.push(['kanban', v]),
    },
  ];
  await h.service.selection(targets);
  assert.deepEqual(
    h.events.find((e) => e[0] === 'flush'),
    ['flush', 'all'],
  );
  assert.deepEqual(h.events.find((e) => e[0] === 'document')[1], {
    relativePath: 'docs/a.md',
    collapsed: true,
  });
  assert.deepEqual(
    h.events.filter((e) => e[0] === 'sections'),
    [['sections', ['s', 'next'], true]],
  );
  assert.deepEqual(h.events.find((e) => e[0] === 'preview')[2], {
    ...preview.windowState,
    collapsed: true,
  });
  assert.deepEqual(
    h.events.find((e) => e[0] === 'kanban'),
    ['kanban', true],
  );
  assert.deepEqual(preview.windowState.freeSize, { width: 640, height: 480 });
  assert.equal(
    h.events.filter((event) => event[0] !== 'allowed').at(-1),
    'reload',
  );
});
test('one collapsed target expands all selected targets and snapshots selection before flush', async () => {
  const h = setup(),
    gate = deferred(),
    targets = [
      { kind: 'document', document: { ...doc, collapsed: true } },
      { kind: 'section', section: structuredClone(section), collapsed: false },
    ];
  h.ports.flush = async () => gate.promise;
  const pending = h.service.selection(targets);
  targets[0].document.relativePath = 'docs/new.md';
  targets[1].section.id = 'replacement';
  targets.length = 0;
  gate.resolve();
  await pending;
  assert.deepEqual(h.events.find((e) => e[0] === 'document')[1], {
    relativePath: 'docs/a.md',
    collapsed: false,
  });
  assert.deepEqual(
    h.events.find((e) => e[0] === 'sections'),
    ['sections', ['s'], false],
  );
});
test('scope changes during flush prevent both personal and native changes, including canvas round trips', async () => {
  for (const mode of [
    'root',
    'canvas',
    'epoch',
    'home',
    'roundtrip',
    'dispose',
  ]) {
    const h = setup(),
      gate = deferred();
    h.ports.flush = async () => gate.promise;
    const pending = h.service.selection([
      { kind: 'section', section, collapsed: false },
      { kind: 'document', document: doc },
    ]);
    if (mode === 'root') h.ports.scope.root = 'other';
    if (mode === 'canvas') h.ports.scope.canvasId = 'other';
    if (mode === 'epoch') h.ports.scope.epoch++;
    if (mode === 'home') h.ports.scope.home = true;
    if (mode === 'roundtrip') h.ports.scope.viewEpoch += 2;
    if (mode === 'dispose') h.service.dispose();
    gate.resolve();
    await pending;
    assert.ok(!h.events.some((e) => ['sections', 'document'].includes(e[0])));
    assert.equal(h.errors.length, 0);
    assert.equal(h.notices.length, 0);
  }
});
test('late document receipts cannot close a new context menu, reload or announce success', async () => {
  const h = setup(),
    gate = deferred();
  h.ports.editor.setDocumentCollapsed = () => gate.promise;
  let accepted = 0;
  const pending = h.service.document(doc, { menu: true }, () => accepted++);
  h.ports.scope.sessionId = 'new';
  gate.resolve();
  await pending;
  assert.equal(accepted, 0);
  assert.ok(!h.events.includes('reload'));
  assert.equal(h.notices.length, 0);
});
test('scope or protection change between sequential writes stops the remaining targets without rollback claims', async () => {
  for (const change of ['scope', 'AI']) {
    const h = setup(),
      gate = deferred();
    let allowed = true;
    h.ports.canCollapse = () => allowed;
    h.ports.editor.setDocumentCollapsed = async (input) => {
      h.events.push(['document', input]);
      await gate.promise;
    };
    const pending = h.service.selection([
      { kind: 'document', document: doc },
      preview,
      { kind: 'section', section, collapsed: false },
    ]);
    await Promise.resolve();
    if (change === 'scope') h.ports.scope.canvasId = 'other';
    else allowed = false;
    gate.resolve();
    await pending;
    assert.equal(h.events.filter((e) => e[0] === 'document').length, 1);
    assert.ok(!h.events.some((e) => ['preview', 'sections'].includes(e[0])));
    assert.equal(h.errors.length, 0);
  }
});
test('rapid repeat, failed flush and failed native write do not duplicate or continue publication', async () => {
  const h = setup(),
    gate = deferred();
  h.ports.flush = async () => gate.promise;
  const pending = h.service.selection([{ kind: 'document', document: doc }]);
  await h.service.selection([{ kind: 'document', document: doc }]);
  gate.resolve();
  await pending;
  assert.equal(h.events.filter((e) => e[0] === 'document').length, 1);
  assert.deepEqual(
    h.busy.map(([, b]) => b),
    [true, false],
  );
  for (const point of ['flush', 'write']) {
    const failed = setup(),
      error = Error(point);
    if (point === 'flush')
      failed.ports.flush = async () => {
        throw error;
      };
    else
      failed.ports.editor.setDocumentCollapsed = async () => {
        throw error;
      };
    await failed.service.selection([
      { kind: 'document', document: doc },
      preview,
    ]);
    assert.deepEqual(failed.errors, [error]);
    assert.ok(!failed.events.some((e) => e[0] === 'preview'));
  }
});
test('AI protection is rechecked after saving and busy/home/missing-root prevent all effects', async () => {
  const h = setup();
  let allowed = true;
  h.ports.canCollapse = () => allowed;
  h.ports.flush = async () => {
    allowed = false;
  };
  await h.service.section(section, false);
  assert.ok(!h.events.some((e) => e[0] === 'sections'));
  for (const reason of ['busy', 'home', 'root', 'AI']) {
    const f = setup();
    if (reason === 'busy') f.ports.busy = true;
    if (reason === 'home') f.ports.scope.home = true;
    if (reason === 'root') f.ports.scope.root = null;
    if (reason === 'AI') f.ports.canCollapse = () => false;
    await f.service.document(doc);
    assert.ok(!f.events.some((e) => e[0] === 'document'));
  }
});
