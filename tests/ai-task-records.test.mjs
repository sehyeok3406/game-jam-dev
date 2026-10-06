import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { taskHistoryRecord, withTaskHistory } from '../src/ai-task-history.ts';
import {
  isCanvasDocument,
  isAiTaskPath,
  entryTaskRecord,
  relatedAiEntries,
} from '../src/ai-task-records.ts';
import { createTaskPlan } from '../src/task-plan.ts';
import {
  listHistory,
  materialize,
  saveHistory,
  historyId,
  captureProject,
} from '../src/project-store.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const taskPath = '.ai/tasks/fixture.md';
const input = {
  kind: 'implement',
  inputPaths: ['project.md'],
  instructions: '이동 속도를 2로 변경하세요.',
  x: 10,
  y: 10,
  htmlResult: { mode: 'new' },
};
const raw = createTaskPlan(input, 'fixture', {});
const meta = () => ({
  id: historyId(),
  label: 'HTML 구현',
  kind: 'ai',
  status: 'failed',
  createdAt: Date.now(),
  taskPath,
  modelId: 'fixture-model',
});
const entry = () => ({ ...meta(), files: [], aiTask: taskHistoryRecord(raw) });
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-task-records-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('AI task and HTML source records never become selectable canvas documents', () => {
  assert.equal(
    isCanvasDocument({ type: 'idea', relativePath: 'ideas/a.md' }),
    true,
  );
  assert.equal(
    isCanvasDocument({ type: 'ai-task', relativePath: taskPath }),
    false,
  );
  assert.equal(
    isCanvasDocument({ type: 'reference', relativePath: taskPath }),
    false,
  );
  assert.equal(
    isCanvasDocument({
      type: 'reference',
      relativePath: 'docs/html-sources/a.md',
      htmlSource: 'output/index.html',
    }),
    false,
  );
  assert.equal(isAiTaskPath('.ai/tasks/../project.md'), false);
  assert.equal(isAiTaskPath('docs/ai/tasks/a.md'), false);
});

test('task records contain exact input/output paths and instructions without frontmatter', () => {
  const record = taskHistoryRecord(raw);
  assert.deepEqual(record.inputs, ['project.md']);
  assert.deepEqual(record.outputs, ['output/games/v1/index.html']);
  assert.match(record.specification, /이동 속도를 2로/);
  assert.equal(record.origin, 'snapshot');
  assert.ok(!record.specification.includes('expected_outputs:'));
  assert.equal(taskHistoryRecord('---\ntype: idea\n---\ntext'), undefined);
  assert.equal(taskHistoryRecord('---\ntype: [\n---'), undefined);
});

test('related result history includes failed attempts but excludes input references and mere task creation', () => {
  const run = entry(),
    creation = { ...entry(), kind: 'user' };
  assert.deepEqual(
    relatedAiEntries([run, creation], 'output/games/v1/index.html'),
    [run],
  );
  assert.deepEqual(relatedAiEntries([run], 'project.md'), []);
  const legacy = { ...run, aiTask: undefined };
  const docs = [
    {
      title: 'old task',
      relativePath: taskPath,
      body: '## 입력 문서\n\n- `project.md`\n\n## 출력\n\n- `output/versions/v1.html`',
    },
  ];
  assert.equal(entryTaskRecord(legacy, docs).origin, 'legacy');
  assert.deepEqual(
    relatedAiEntries([legacy], 'output/versions/v1.html', docs),
    [legacy],
  );
});

test('local AI history persists its immutable request even with no outputs and after the internal task is deleted', async (t) => {
  const root = await temporary(t);
  await materialize(root, { [taskPath]: raw });
  const saved = await saveHistory(
    root,
    {},
    {},
    { ...meta(), aiTask: taskHistoryRecord(raw) },
  );
  await fs.unlink(path.join(root, taskPath));
  const found = (await listHistory(root)).find((item) => item.id === saved.id);
  assert.equal(
    found.aiTask.specification,
    taskHistoryRecord(raw).specification,
  );
  assert.equal(found.status, 'failed');
  assert.equal(found.modelId, 'fixture-model');
  assert.deepEqual(found.files, []);
});

test('task creation history captures the specification without rewriting the workspace', async (t) => {
  const root = await temporary(t);
  const snapshot = { [taskPath]: raw };
  await materialize(root, snapshot);
  const saved = await saveHistory(root, {}, snapshot, {
    ...meta(),
    kind: 'user',
    taskPath: undefined,
  });
  assert.equal(saved.aiTask.origin, 'snapshot');
  assert.match(saved.aiTask.specification, /이동 속도를 2로/);
  assert.deepEqual(await captureProject(root), snapshot);
  const oldRecord = withTaskHistory(
    { ...entry(), aiTask: undefined },
    {},
    snapshot,
  );
  assert.deepEqual(oldRecord.aiTask.outputs, ['output/games/v1/index.html']);
});

test('legacy local history prefers immutable input snapshots and labels current-file fallback', async (t) => {
  const root = await temporary(t);
  await materialize(root, {
    [taskPath]: raw.replace('이동 속도를 2로', '이동 속도를 999로'),
  });
  const old = await saveHistory(root, {}, {}, meta());
  await fs.mkdir(path.join(root, '.history', old.id, 'input'), {
    recursive: true,
  });
  await materialize(path.join(root, '.history', old.id, 'input'), {
    [taskPath]: raw,
  });
  const read = (await listHistory(root)).find((item) => item.id === old.id);
  assert.match(read.aiTask.specification, /이동 속도를 2로/);
  assert.equal(read.aiTask.origin, 'snapshot');
  const fallback = await saveHistory(root, {}, {}, meta());
  const readFallback = (await listHistory(root)).find(
    (item) => item.id === fallback.id,
  );
  assert.match(readFallback.aiTask.specification, /999로/);
  assert.equal(readFallback.aiTask.origin, 'legacy');
});

test('collaboration shares task instructions, model, actor and cancellation history with viewers across restart', async (t) => {
  const root = await temporary(t);
  let server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  const url = `http://127.0.0.1:${server.port}`;
  const project = {
    'project.md': '---\nid: project\ntitle: Project\ntype: project\n---\nHello',
  };
  const created = await CollaborationClient.create(
    url,
    'fixture',
    '관리자 A',
    'records',
    project,
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    '참여자 B',
  );
  const viewer = new CollaborationClient(joined.credentials, () => {});
  viewer.accept(joined.result);
  try {
    await owner.setRole(viewer.state.memberId, 'viewer');
    const task = await owner.command('tasks:create', input);
    await owner.beginAi(task.relativePath, 'fixture-model');
    await owner.request('ai-cancel');
    const histories = await viewer.history();
    const cancelled = histories.find((item) => item.status === 'cancelled');
    assert.equal(cancelled.actorName, '관리자 A');
    assert.equal(cancelled.modelId, 'fixture-model');
    assert.equal(cancelled.aiTask.origin, 'snapshot');
    assert.match(cancelled.aiTask.specification, /이동 속도를 2로/);
    const port = server.port;
    await server.close();
    server = await createCollaborationServer({
      port,
      dataDirectory: root,
      creationKey: 'fixture',
    });
    const reread = (await viewer.history()).find(
      (item) => item.id === cancelled.id,
    );
    assert.deepEqual(reread.aiTask, cancelled.aiTask);
    await assert.rejects(
      viewer.beginAi(task.relativePath),
      /뷰어|관리자·편집자/,
    );
  } finally {
    owner.stop();
    viewer.stop();
    await server.close();
  }
});
