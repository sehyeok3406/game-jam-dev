import test from 'node:test';
import assert from 'node:assert/strict';
import matter from '../src/markdown.ts';
import {
  applyStatusProperty,
  initializeWorkflows,
  saveStatuses,
} from '../src/document-workflow.ts';
import {
  defaultStatuses,
  DOCUMENT_STATUSES_PATH,
} from '../src/document-statuses.ts';
import {
  statusPropertyApplied,
  readFilePropertyViews,
  propertyVisible,
} from '../src/file-properties.ts';
import {
  moveKanbanCard,
  saveKanbanView,
} from '../src/features/kanban/view-storage.ts';
import {
  KANBAN_VIEW_PATH,
  readKanbanView,
} from '../src/features/kanban/view.ts';
import { mergeProperties } from '../src/sync-properties.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';
import { htmlSourceId, htmlSourcePath } from '../src/html-source.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { relocateResults } from '../src/result-structure.ts';
const doc = (id, metadata = {}) =>
  matter.stringify('원본 본문', { id, title: id, type: 'idea', ...metadata });
const files = () => ({
  'ideas/a.md': doc('a'),
  'ideas/b.md': doc('b', { workflow_status_id: 'done', workflow_order: 25 }),
  [DOCUMENT_STATUSES_PATH]: JSON.stringify(defaultStatuses()),
});
const propertyInput = (enabled, statusId) => ({
  relativePath: 'ideas/b.md',
  objectId: 'b',
  expectedEnabled: true,
  expectedStatus: 'done',
  ...(enabled === undefined ? {} : { enabled }),
  ...(statusId === undefined ? {} : { statusId }),
});
test('legacy files keep applied status; new files are optional; duplicated legacy files preserve applicability', () => {
  const f = files();
  assert.equal(statusPropertyApplied({}), true);
  const next = initializeWorkflows(f, { ...f, 'ideas/new.md': doc('new') });
  assert.equal(next['ideas/a.md'], f['ideas/a.md']);
  assert.equal(
    matter(next['ideas/new.md']).data.status_property_enabled,
    false,
  );
  const copied = reduceCollaboration(f, 'documents:duplicate', {
    documents: [{ path: 'ideas/a.md' }],
    offsetX: 20,
    offsetY: 20,
  });
  assert.equal(copied.result[0].statusPropertyEnabled, true);
});
test('unapply preserves the status and board order; reapply restores or chooses a surviving default', () => {
  const off = applyStatusProperty(files(), propertyInput(false));
  assert.deepEqual(matter(off['ideas/b.md']).data.workflow_order, 25);
  assert.equal(matter(off['ideas/b.md']).data.workflow_status_id, 'done');
  assert.equal(matter(off['ideas/b.md']).data.status_property_enabled, false);
  const on = applyStatusProperty(off, {
    ...propertyInput(true),
    expectedEnabled: false,
  });
  assert.equal(matter(on['ideas/b.md']).data.workflow_status_id, 'done');
  const statuses = defaultStatuses();
  statuses.statuses = statuses.statuses.filter((s) => s.id !== 'done');
  const removed = saveStatuses(off, {
    expected: off[DOCUMENT_STATUSES_PATH],
    value: statuses,
  });
  const restored = applyStatusProperty(removed, {
    ...propertyInput(true),
    expectedEnabled: false,
  });
  assert.equal(
    matter(restored['ideas/b.md']).data.workflow_status_id,
    'not-started',
  );
  assert.throws(() => applyStatusProperty(off, propertyInput(true)), /변경/);
});
test('legacy implicit state is preserved on unapply even after the project default changes', () => {
  const f = files(),
    statuses = defaultStatuses();
  statuses.defaultStatusId = 'done';
  f[DOCUMENT_STATUSES_PATH] = JSON.stringify(statuses);
  const input = {
    relativePath: 'ideas/a.md',
    objectId: 'a',
    expectedEnabled: true,
  };
  const off = applyStatusProperty(f, { ...input, enabled: false });
  assert.equal(
    matter(off['ideas/a.md']).data.workflow_status_id,
    'not-started',
  );
  const on = applyStatusProperty(off, {
    ...input,
    enabled: true,
    expectedEnabled: false,
    expectedStatus: 'not-started',
  });
  assert.equal(matter(on['ideas/a.md']).data.workflow_status_id, 'not-started');
});
test('file property changes preserve teammate content; conflicting property changes are rejected', () => {
  const f = files(),
    after = applyStatusProperty(f, propertyInput(false));
  const teammate = matter.stringify(
    '팀원의 새 본문',
    matter(f['ideas/b.md']).data,
  );
  const merged = mergeProperties(
    'ideas/b.md',
    f['ideas/b.md'],
    after['ideas/b.md'],
    teammate,
  );
  assert.equal(matter(merged).content.trim(), '팀원의 새 본문');
  assert.equal(matter(merged).data.status_property_enabled, false);
  const competing = applyStatusProperty(
    f,
    propertyInput(undefined, 'in-progress'),
  );
  assert.throws(
    () =>
      mergeProperties(
        'ideas/b.md',
        f['ideas/b.md'],
        after['ideas/b.md'],
        competing['ideas/b.md'],
      ),
    /충돌/,
  );
});
test('board order and appearance live in the view; reordering leaves file bytes unchanged', () => {
  const f = files();
  const moved = moveKanbanCard(f, {
    relativePath: 'ideas/b.md',
    objectId: 'b',
    expectedEnabled: true,
    expectedStatus: 'done',
    statusId: 'done',
    expectedView: null,
  });
  assert.equal(moved['ideas/b.md'], f['ideas/b.md']);
  assert.equal(moved['ideas/a.md'], f['ideas/a.md']);
  const view = readKanbanView(moved[KANBAN_VIEW_PATH], defaultStatuses());
  assert.equal(typeof view.orders.b, 'number');
  view.backgrounds.done = { mode: 'none' };
  const recolored = saveKanbanView(moved, {
    expected: moved[KANBAN_VIEW_PATH],
    value: view,
  });
  assert.equal(recolored[DOCUMENT_STATUSES_PATH], f[DOCUMENT_STATUSES_PATH]);
  assert.equal(recolored['ideas/b.md'], f['ideas/b.md']);
  assert.throws(
    () =>
      moveKanbanCard(moved, {
        relativePath: 'ideas/b.md',
        objectId: 'b',
        expectedEnabled: true,
        expectedStatus: 'done',
        statusId: 'done',
        expectedView: null,
      }),
    /順序|순서/,
  );
});
test('a board cannot silently reapply a removed property and moving columns writes just the target file', () => {
  const f = files(),
    off = applyStatusProperty(f, propertyInput(false));
  const input = {
    relativePath: 'ideas/b.md',
    objectId: 'b',
    expectedEnabled: true,
    expectedStatus: 'done',
    statusId: 'in-progress',
    expectedView: null,
  };
  assert.throws(() => moveKanbanCard(off, input), /미적용/);
  const moved = moveKanbanCard(f, input);
  assert.equal(
    matter(moved['ideas/b.md']).data.workflow_status_id,
    'in-progress',
  );
  assert.equal(moved['ideas/a.md'], f['ideas/a.md']);
});
test('HTML uses a metadata adapter without rewriting its source; property visibility remains independent', () => {
  const path = 'output/index.html',
    html = '<html><body>Game</body></html>',
    f = { [path]: html };
  const off = applyStatusProperty(f, {
    relativePath: path,
    objectId: htmlSourceId(path),
    expectedEnabled: true,
    enabled: false,
  });
  assert.equal(off[path], html);
  assert.equal(
    matter(off[htmlSourcePath(path)]).data.status_property_enabled,
    false,
  );
  const views = readFilePropertyViews({
    files: {
      [htmlSourceId(path)]: { status: false, createdBy: true, unknown: true },
      broken: true,
    },
  });
  assert.equal(
    propertyVisible(views.files[htmlSourceId(path)], 'status'),
    false,
  );
  assert.equal(
    propertyVisible(views.files[htmlSourceId(path)], 'createdBy'),
    true,
  );
  assert.equal(views.files[htmlSourceId(path)].unknown, undefined);
});
test('HTML folder moves remap the view order while preserving optional status and source bytes', () => {
  const from = 'output/index.html',
    to = 'output/systems/game/v001/index.html';
  const f = {
    [from]: '<html><body>Game</body></html>',
    [htmlSourcePath(from)]: doc(htmlSourceId(from), {
      html_source: from,
      status_property_enabled: false,
      workflow_status_id: 'done',
    }),
    [KANBAN_VIEW_PATH]: JSON.stringify({
      version: 1,
      backgrounds: {},
      orders: { [htmlSourceId(from)]: 123 },
    }),
  };
  const moved = relocateResults(f, [{ from, to }]);
  assert.equal(moved[to], f[from]);
  assert.equal(
    matter(moved[htmlSourcePath(to)]).data.status_property_enabled,
    false,
  );
  assert.equal(
    JSON.parse(moved[KANBAN_VIEW_PATH]).orders[htmlSourceId(to)],
    123,
  );
});
test('shared properties enforce permissions/capabilities, sync without a board, undo, and merge offline with teammate text', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'file-properties-shared-'),
  );
  const server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(url, '', '관리자', '속성', {
    ...files(),
    'output/index.html': '<html><body>Game</body></html>',
    [htmlSourcePath('output/index.html')]: doc(
      htmlSourceId('output/index.html'),
      { html_source: 'output/index.html', workflow_status_id: 'in-progress' },
    ),
  });
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    '팀원',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  t.after(async () => {
    owner.stop();
    editor.stop();
    await server.close();
    assert.ok(
      path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  assert.equal(owner.state.filePropertiesVersion, 1);
  await owner.command('files:set-status-property', propertyInput(false));
  const history = owner.lastCommandHistoryId;
  await editor.refresh();
  assert.equal(
    matter(editor.files['ideas/b.md']).data.status_property_enabled,
    false,
  );
  await owner.changeHistory(history, 'undo');
  await editor.refresh();
  assert.equal(
    statusPropertyApplied({
      statusPropertyEnabled: matter(editor.files['ideas/b.md']).data
        .status_property_enabled,
    }),
    true,
  );
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(
    editor.command('files:set-status-property', propertyInput(false)),
    /뷰어|권한/,
  );
  await owner.setRole(editor.state.memberId, 'editor');
  await editor.refresh();
  const transport = editor.request.bind(editor);
  editor.request = async () => {
    throw new TypeError('offline fixture');
  };
  await assert.rejects(editor.refresh());
  await editor.command('files:set-status-property', propertyInput(false));
  await editor.command('files:set-status-property', {
    relativePath: 'output/index.html',
    objectId: htmlSourceId('output/index.html'),
    expectedEnabled: true,
    expectedStatus: 'in-progress',
    enabled: false,
  });
  await owner.lock('ideas/b.md');
  await owner.command('documents:save', {
    relativePath: 'ideas/b.md',
    title: 'b',
    body: '팀원이 온라인에서 작성한 본문',
  });
  await owner.unlock('ideas/b.md');
  editor.request = transport;
  await editor.refresh();
  await owner.refresh();
  assert.equal(
    matter(owner.files['ideas/b.md']).data.status_property_enabled,
    false,
  );
  assert.equal(
    matter(owner.files[htmlSourcePath('output/index.html')]).data
      .status_property_enabled,
    false,
  );
  assert.equal(
    owner.files['output/index.html'],
    '<html><body>Game</body></html>',
  );
  assert.equal(
    matter(owner.files['ideas/b.md']).content.trim(),
    '팀원이 온라인에서 작성한 본문',
  );
  editor.state.filePropertiesVersion = undefined;
  await assert.rejects(
    editor.command('files:set-status-property', {
      ...propertyInput(true),
      expectedEnabled: false,
    }),
    /업데이트/,
  );
});
