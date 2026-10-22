import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from '../src/markdown.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { createTaskPlan } from '../src/task-plan.ts';
import { taskHistoryRecord } from '../src/ai-task-history.ts';
import {
  loadGamejamDraft,
  saveGamejamDraft,
  clearGamejamDraft,
  entryRequest,
  requestSnapshotFromTask,
  readSavedRequest,
} from '../src/gamejam-history.ts';
import {
  saveHistory,
  listHistory,
  materialize,
  historyId,
  recoverInterruptedHistory,
} from '../src/project-store.ts';
import { defaultDocumentTemplates } from '../src/document-format.ts';
import { gamejamIssues } from '../src/gamejam-validation.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';

const request = {
  canvasId: 'default',
  organize: true,
  implement: true,
  inputPaths: ['project.md'],
  x: 120,
  y: 180,
  resultName: '복구 테스트',
  documentResult: {
    mode: 'new',
    structure: 'custom',
    documents: defaultDocumentTemplates(),
  },
  htmlResult: { mode: 'new', category: 'systems' },
  instructions: {
    organize: '## 직접 작성한 제목\n표로 정리하세요.',
    implement: '재화를 소비하여 이동한다.',
  },
};
const settings = {
  providerId: 'claude-cli',
  modelId: 'custom-model',
  retryOf: 'previous-run',
};
const input = () => gamejamTaskInput(structuredClone(request), settings);

test('reasoning is retained in task snapshots, drafts and retries while legacy records keep default behavior', () => {
  const choice = {
    providerId: 'codex-cli',
    modelId: 'gpt-6.1-sol',
    reasoningEffort: 'max',
  };
  const snapshot = gamejamTaskInput(
    structuredClone(request),
    choice,
  ).requestSnapshot;
  assert.equal(readSavedRequest(snapshot).reasoningEffort, 'max');
  const storage = memoryStorage();
  saveGamejamDraft(storage, 'reasoning', {
    ...snapshot,
    page: 5,
    instructionPage: 'implement',
    updatedAt: 42,
  });
  assert.equal(loadGamejamDraft(storage, 'reasoning').reasoningEffort, 'max');
  const reused = entryRequest({
    id: 'retry',
    aiTask: { requestSnapshot: snapshot },
    reasoningEffort: 'high',
  });
  assert.equal(reused.reasoningEffort, 'high');
  assert.equal(
    entryRequest({
      id: 'default-retry',
      aiTask: { requestSnapshot: snapshot },
      reasoningEffort: null,
    }).reasoningEffort,
    null,
  );
  assert.equal(
    readSavedRequest({ ...snapshot, reasoningEffort: undefined })
      .reasoningEffort,
    undefined,
  );
  assert.equal(
    readSavedRequest({ ...snapshot, reasoningEffort: 'unsafe-value' }),
    undefined,
  );
});
const taskPath = '.ai/tasks/recovery.md';
const entry = (raw) => ({
  id: historyId(),
  label: '문서 + HTML',
  kind: 'ai',
  status: 'running',
  createdAt: Date.now(),
  taskPath,
  providerId: 'claude-cli',
  modelId: 'custom-model',
  aiTask: taskHistoryRecord(raw),
});
const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
    data,
  };
};

test('incomplete drafts survive reopening, remain per project and report storage failure', () => {
  const storage = memoryStorage();
  const draft = {
    version: 1,
    request: {
      ...request,
      organize: false,
      implement: false,
      instructions: { organize: '', implement: '' },
    },
    ...settings,
    page: 3,
    instructionPage: 'implement',
    updatedAt: 42,
  };
  assert.equal(saveGamejamDraft(storage, 'A', draft), true);
  assert.deepEqual(loadGamejamDraft(storage, 'A'), draft);
  assert.equal(loadGamejamDraft(storage, 'B'), undefined);
  const restored = loadGamejamDraft(storage, 'A');
  restored.request.instructions.organize = '다른 입력';
  assert.equal(
    loadGamejamDraft(storage, 'A').request.instructions.organize,
    '',
  );
  clearGamejamDraft(storage, 'B');
  assert.ok(loadGamejamDraft(storage, 'A'));
  clearGamejamDraft(storage, 'A');
  assert.equal(loadGamejamDraft(storage, 'A'), undefined);
  assert.equal(
    saveGamejamDraft(
      {
        setItem() {
          throw Error('quota');
        },
      },
      'A',
      draft,
    ),
    false,
  );
  for (const value of [
    '{',
    '{}',
    JSON.stringify({ ...draft, page: 9 }),
    JSON.stringify({
      ...draft,
      request: { ...request, documentResult: { documents: [null] } },
    }),
  ]) {
    storage.setItem('game-canvas-gamejam-draft:A', value);
    assert.equal(loadGamejamDraft(storage, 'A'), undefined);
  }
});

test('saved requests retain both instructions, custom document configuration, provider/model and retry link', () => {
  const raw = createTaskPlan(input(), 'recovery', {});
  const saved = taskHistoryRecord(raw).requestSnapshot;
  assert.deepEqual(saved.request, request);
  assert.equal(saved.providerId, settings.providerId);
  assert.equal(saved.modelId, settings.modelId);
  assert.equal(saved.retryOf, settings.retryOf);
  const reused = entryRequest({ ...entry(raw), files: [] });
  assert.equal(reused.retryOf.includes('-'), true);
  reused.request.instructions.organize = '새 요청';
  assert.equal(
    taskHistoryRecord(raw).requestSnapshot.request.instructions.organize,
    request.instructions.organize,
  );
  assert.equal(
    entryRequest({ ...entry(raw), files: [], modelId: null }).modelId,
    '',
  );
  assert.equal(
    readSavedRequest({
      ...saved,
      request: { ...request, htmlResult: { mode: 'new', category: 'unknown' } },
    }),
    undefined,
  );
});

test('old single/combined specifications rebuild edited instructions and custom formats without a snapshot', () => {
  for (const combined of [false, true]) {
    const source = input();
    if (!combined) delete source.thenImplement;
    const raw = createTaskPlan(source, 'old', {});
    const parsed = matter(raw);
    delete parsed.data.gamejam_request;
    const rebuilt = requestSnapshotFromTask(
      matter.stringify(parsed.content, parsed.data),
    );
    assert.equal(rebuilt.request.organize, true);
    assert.equal(rebuilt.request.implement, combined);
    assert.equal(
      rebuilt.request.instructions.organize,
      request.instructions.organize,
    );
    if (combined)
      assert.equal(
        rebuilt.request.instructions.implement,
        request.instructions.implement,
      );
    assert.deepEqual(rebuilt.request.documentResult, request.documentResult);
  }
});

test('interrupted runs retain immutable requests after source task deletion and retry reserves a fresh output version', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = createTaskPlan(input(), 'recovery', {});
  await materialize(root, { [taskPath]: raw });
  const saved = await saveHistory(root, {}, {}, entry(raw));
  await fs.unlink(path.join(root, taskPath));
  await recoverInterruptedHistory(root);
  const recovered = (await listHistory(root)).find(
    (item) => item.id === saved.id,
  );
  assert.equal(recovered.status, 'failed');
  const reused = entryRequest(recovered);
  assert.equal(reused.retryOf, saved.id);
  assert.deepEqual(reused.request, request);
  const next = createTaskPlan(
    gamejamTaskInput(reused.request, reused),
    'retry',
    { [taskPath]: raw },
  );
  const nextOutputs = matter(next).data.expected_outputs;
  assert.ok(
    nextOutputs.every((output) => !recovered.aiTask.outputs.includes(output)),
  );
  assert.equal(taskHistoryRecord(next).requestSnapshot.retryOf, saved.id);
  assert.equal(
    (await listHistory(root)).find((item) => item.id === saved.id).status,
    'failed',
  );
});

test('old history metadata is enriched from its frozen input even if the current task changed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-old-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = createTaskPlan(input(), 'old', {});
  const original = entry(raw);
  delete original.aiTask.requestSnapshot;
  const saved = await saveHistory(root, {}, {}, original);
  await materialize(root, {
    [taskPath]: raw.replaceAll('표로 정리하세요.', '변경된 현재 지시'),
  });
  await fs.mkdir(path.join(root, '.history', saved.id, 'input'), {
    recursive: true,
  });
  await materialize(path.join(root, '.history', saved.id, 'input'), {
    [taskPath]: raw,
  });
  const recovered = (await listHistory(root)).find(
    (item) => item.id === saved.id,
  );
  assert.equal(
    recovered.aiTask.requestSnapshot.request.instructions.organize,
    request.instructions.organize,
  );
});

test('restored requests cannot silently run with empty or removed input materials', () => {
  const context = {
    collaboration: { active: false },
    provider: 'codex-cli',
    model: '',
    connection: { available: true, authenticated: true },
    checkingConnection: false,
    aiBusy: false,
    locked: false,
    updateRestarting: false,
    availableInputs: ['project.md'],
  };
  assert.deepEqual(gamejamIssues(request, context), []);
  assert.ok(
    gamejamIssues({ ...request, inputPaths: [] }, context).some(
      (issue) => issue.field === 'steps',
    ),
  );
  assert.ok(
    gamejamIssues({ ...request, inputPaths: ['deleted.html'] }, context).some(
      (issue) => issue.message.includes('deleted.html'),
    ),
  );
});

test('shared request snapshots preserve inactive instructions, provider, model and retry link across server restart', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-shared-history-'),
  );
  let server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  let owner;
  t.after(async () => {
    owner?.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    'fixture',
    '검증 관리자',
    '작업 기록',
    {
      'project.md':
        '---\nid: project\ntitle: Project\ntype: overview\nstatus: draft\nsources: []\n---\n# Input',
    },
  );
  owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const savedRequest = { ...structuredClone(request), implement: false };
  const task = await owner.command(
    'tasks:create',
    gamejamTaskInput(savedRequest, settings),
  );
  assert.deepEqual(requestSnapshotFromTask(owner.files[task.relativePath]), {
    version: 1,
    request: savedRequest,
    ...settings,
  });
  await owner.beginAi(task.relativePath, settings.modelId, settings.providerId);
  await owner.request('ai-cancel');
  const record = (await owner.history()).find(
    (item) => item.status === 'cancelled',
  );
  assert.deepEqual(record.aiTask.requestSnapshot.request, savedRequest);
  assert.equal(record.aiTask.requestSnapshot.providerId, settings.providerId);
  assert.equal(record.aiTask.requestSnapshot.modelId, settings.modelId);
  assert.equal(record.aiTask.requestSnapshot.retryOf, settings.retryOf);
  const port = server.port;
  await server.close();
  server = await createCollaborationServer({
    port,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  assert.deepEqual(
    (await owner.history()).find((item) => item.id === record.id).aiTask,
    record.aiTask,
  );
});
