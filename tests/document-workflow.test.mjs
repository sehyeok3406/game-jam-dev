import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from '../src/markdown.ts';
import {
  defaultStatuses,
  readStatuses,
  validateStatuses,
  DOCUMENT_STATUSES_PATH,
} from '../src/document-statuses.ts';
import {
  applyWorkflow,
  saveStatuses,
  initializeWorkflows,
  assertWorkflowReferences,
} from '../src/document-workflow.ts';
import {
  snapshotDocuments,
  reduceCollaboration,
} from '../src/collaboration-model.ts';
import { mergeProperties } from '../src/sync-properties.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { planOfflineMerge } from '../src/offline-sync.ts';
import { assertAiMutation } from '../src/ai-file-lock.ts';
import { captureProject, materialize } from '../src/project-store.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
const raw = (id, extra = {}) =>
  matter.stringify('\n원문\n', {
    id,
    title: id,
    type: 'idea',
    status: 'completed',
    x: 10,
    y: 20,
    width: 340,
    height: 300,
    sources: [],
    ...extra,
  });
const legacy = () => ({ 'ideas/a.md': raw('a'), 'ideas/b.md': raw('b') });
const input = (files, id, statusId, extra = {}) => {
  const d = snapshotDocuments(files).find((d) => d.id === id);
  return {
    relativePath: d.relativePath,
    objectId: id,
    expectedStatus: d.workflowStatusId,
    expectedOrder: d.workflowOrder,
    statusId,
    ...extra,
  };
};
test('legacy reads are pure and AI completed does not become user done', () => {
  const files = legacy(),
    before = JSON.stringify(files);
  assert.equal(readStatuses().statuses.length, 3);
  assert.equal(snapshotDocuments(files)[0].workflowStatusId, undefined);
  assert.equal(JSON.stringify(files), before);
});
test('status validation rejects duplicate normalized names, invalid IDs/colors/default/empty lists', () => {
  for (const patch of [
    (v) => (v.statuses[0].badgeColor = 'red'),
    (v) => (v.statuses[1].name = v.statuses[0].name),
    (v) => (v.statuses[0].id = '../x'),
    (v) => (v.defaultStatusId = 'missing'),
    (v) => (v.statuses = []),
  ]) {
    const v = defaultStatuses();
    patch(v);
    assert.throws(() => validateStatuses(v));
  }
  assert.throws(() => readStatuses('{broken'));
});
test('document workflow preserves legacy AI state, content, geometry and membership', () => {
  const before = legacy(),
    after = applyWorkflow(before, input(before, 'a', 'in-progress'));
  const a = matter(after['ideas/a.md']);
  assert.equal(a.data.status, 'completed');
  assert.equal(a.data.workflow_status_id, 'in-progress');
  assert.equal(a.content, matter(before['ideas/a.md']).content);
  assert.equal(a.data.x, 10);
  assert.equal(after['ideas/b.md'], before['ideas/b.md']);
  assertWorkflowReferences(after);
  assert.throws(() => applyWorkflow(after, input(before, 'a', 'done')), /변경/);
  assert.throws(() =>
    applyWorkflow(after, {
      ...input(after, 'a', 'done'),
      objectId: 'different',
    }),
  );
});
test('same-column insertion and cross-column moves are deterministic', () => {
  let f = legacy();
  f = applyWorkflow(f, input(f, 'a', 'in-progress'));
  f = applyWorkflow(f, input(f, 'b', 'in-progress'));
  f = applyWorkflow(f, input(f, 'b', 'in-progress', { beforeId: 'a' }));
  assert.ok(
    matter(f['ideas/b.md']).data.workflow_order <
      matter(f['ideas/a.md']).data.workflow_order,
  );
  f = applyWorkflow(f, input(f, 'b', 'done'));
  assert.equal(matter(f['ideas/b.md']).data.workflow_status_id, 'done');
});
test('used status deletion requires replacement and rewrites implicit legacy users atomically', () => {
  const f = legacy(),
    value = defaultStatuses();
  value.statuses.shift();
  value.defaultStatusId = 'in-progress';
  assert.throws(() => saveStatuses(f, { expected: null, value }));
  assert.equal(f['ideas/a.md'], legacy()['ideas/a.md']);
  const after = saveStatuses(f, {
    expected: null,
    value,
    replacements: { 'not-started': 'in-progress' },
  });
  assert.equal(
    matter(after['ideas/a.md']).data.workflow_status_id,
    'in-progress',
  );
  assert.equal(
    matter(after['ideas/b.md']).data.workflow_status_id,
    'in-progress',
  );
  assertWorkflowReferences(after);
});
test('changing new-document default leaves legacy documents unchanged and applies only to creations', () => {
  const f = legacy(),
    value = defaultStatuses();
  value.defaultStatusId = 'done';
  const settings = saveStatuses(f, { expected: null, value });
  const after = initializeWorkflows(settings, {
    ...settings,
    'ideas/c.md': raw('c'),
  });
  assert.equal(after['ideas/a.md'], f['ideas/a.md']);
  assert.equal(matter(after['ideas/c.md']).data.workflow_status_id, 'done');
  const created = reduceCollaboration(settings, 'documents:create-idea', {
    x: 10,
    y: 10,
  });
  assert.equal(created.result.workflowStatusId, 'done');
});
test('AI publication preserves latest workflow and assigns current default to new outputs', () => {
  const f = applyWorkflow(legacy(), input(legacy(), 'a', 'in-progress'));
  const after = initializeWorkflows(
    f,
    {
      ...f,
      'ideas/a.md': raw('a', { workflow_status_id: 'done' }),
      'docs/new.md': raw('new'),
    },
    true,
  );
  assert.equal(
    matter(after['ideas/a.md']).data.workflow_status_id,
    'in-progress',
  );
  assert.equal(
    matter(after['docs/new.md']).data.workflow_status_id,
    'not-started',
  );
});
test('body and status changes merge; undo preserves teammate text', () => {
  const base = legacy(),
    mine = applyWorkflow(base, input(base, 'a', 'done'));
  const teammate = {
    ...base,
    'ideas/a.md': matter.stringify(
      '팀원 내용',
      matter(base['ideas/a.md']).data,
    ),
  };
  const merged = mergeProperties(
    'ideas/a.md',
    base['ideas/a.md'],
    mine['ideas/a.md'],
    teammate['ideas/a.md'],
  );
  assert.equal(matter(merged).content.trim(), '팀원 내용');
  assert.equal(matter(merged).data.workflow_status_id, 'done');
  const undo = invertEdit(
    { ...mine, 'ideas/a.md': merged },
    base,
    mine,
    'undo',
  );
  assert.equal(matter(undo['ideas/a.md']).content.trim(), '팀원 내용');
  assert.equal(matter(undo['ideas/a.md']).data.workflow_status_id, undefined);
});
test('undo of definition creation cannot delete a status used by a later document', () => {
  const f = legacy(),
    value = defaultStatuses();
  value.statuses.push({
    id: 'review',
    name: '검토',
    badgeColor: '#8B5CF6',
    boardBackground: { mode: 'none' },
  });
  const after = saveStatuses(f, { expected: null, value }),
    current = applyWorkflow(after, input(after, 'a', 'review'));
  assert.throws(() => invertEdit(current, f, after, 'undo'), /상태/);
});
test('AI protection catches both document moves and edits to a displayed status definition', () => {
  const f = legacy(),
    lock = { paths: ['ideas/a.md'], prefixes: [] };
  assert.throws(() =>
    assertAiMutation(lock, f, applyWorkflow(f, input(f, 'a', 'done'))),
  );
  const v = defaultStatuses();
  v.statuses[0].name = '준비';
  assert.throws(() =>
    assertAiMutation(lock, f, saveStatuses(f, { expected: null, value: v })),
  );
});
test('offline body and workflow merge; deleted target status is a dependent conflict', () => {
  const base = {
    ...legacy(),
    [DOCUMENT_STATUSES_PATH]: JSON.stringify(defaultStatuses(), null, 2),
  };
  const local = applyWorkflow(base, input(base, 'a', 'done'));
  const server = {
    ...base,
    'ideas/a.md': matter.stringify(
      '다른 내용',
      matter(base['ideas/a.md']).data,
    ),
  };
  assert.equal(planOfflineMerge(base, local, server).conflicts.length, 0);
  const value = defaultStatuses();
  value.statuses.pop();
  const changed = saveStatuses(base, {
    expected: base[DOCUMENT_STATUSES_PATH],
    value,
  });
  assert.ok(planOfflineMerge(base, local, changed).conflicts.length);
});
test('registry is captured and restored as part of project snapshots', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-snapshot-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = applyWorkflow(legacy(), input(legacy(), 'a', 'done'));
  await materialize(root, files);
  assert.equal(
    (await captureProject(root))[DOCUMENT_STATUSES_PATH],
    files[DOCUMENT_STATUSES_PATH],
  );
});

test('unknown statuses can be repaired one document at a time without silently resetting other documents', () => {
  const files = {
    'ideas/a.md': raw('a', { workflow_status_id: 'missing-a' }),
    'ideas/b.md': raw('b', { workflow_status_id: 'missing-b' }),
  };
  const first = applyWorkflow(files, input(files, 'a', 'done'));
  assert.equal(first['ideas/b.md'], files['ideas/b.md']);
  const next = applyWorkflow(first, input(first, 'b', 'in-progress'));
  assertWorkflowReferences(next);
});
test('real server synchronizes workflow, rejects stale state, viewer writes and legacy writes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-server-'));
  const server = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
  });
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    '',
    'owner',
    'workflow',
    { ...legacy(), 'project.md': '# legacy plain document' },
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'editor',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  clients.push(editor);
  assert.equal(owner.state.documentStatusesVersion, 1);
  await owner.command(
    'documents:set-workflow',
    input(owner.files, 'project.md', 'done'),
  );
  const old = input(owner.files, 'a', 'done');
  await owner.command('documents:set-workflow', old);
  await assert.rejects(
    editor.command('documents:set-workflow', {
      ...old,
      statusId: 'in-progress',
    }),
    /변경/,
  );
  editor.accept(await editor.request('state'));
  await owner.lock('ideas/a.md');
  await editor.command(
    'documents:set-workflow',
    input(editor.files, 'a', 'in-progress'),
  );
  await owner.command('documents:save', {
    relativePath: 'ideas/a.md',
    title: '편집한 제목',
    body: '본문 수정',
    contentRevision: 0,
  });
  assert.equal(
    matter(owner.files['ideas/a.md']).data.workflow_status_id,
    'in-progress',
  );
  await owner.request('role', {
    memberId: editor.state.memberId,
    role: 'viewer',
  });
  editor.accept(await editor.request('state'));
  await assert.rejects(
    editor.command('documents:set-workflow', input(editor.files, 'b', 'done')),
  );
  await assert.rejects(
    CollaborationClient.fetch(
      url,
      `/projects/${created.credentials.projectId}/command`,
      {
        command: {
          id: 'legacy',
          channel: 'documents:set-color',
          input: { relativePath: 'ideas/a.md', color: 'green' },
          revisions: owner.revisions,
        },
      },
      created.credentials.token,
    ),
    /업데이트/,
  );
});
