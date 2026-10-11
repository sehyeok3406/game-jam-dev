import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from '../src/markdown.ts';
import {
  defaultDocumentTemplates,
  documentTemplates,
  taskDocumentFormat,
} from '../src/document-format.ts';
import { createTaskPlan, workflowStages } from '../src/task-plan.ts';
import { resolveTaskArtifacts } from '../src/document-bundle.ts';
import { validateArtifacts } from '../src/ai-artifacts.ts';
import { documentSets } from '../src/document-output.ts';
import { gamejamIssues } from '../src/gamejam-validation.ts';
import { gamejamFieldPage } from '../src/gamejam-wizard.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const files = {
  'project.md': matter.stringify('Idea', {
    id: 'project',
    title: 'Idea',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
};
const input = {
  kind: 'organize',
  inputPaths: ['project.md'],
  x: 0,
  y: 0,
  resultName: '편집 구성',
  documentResult: {
    mode: 'new',
    structure: 'custom',
    documents: defaultDocumentTemplates(),
  },
};
function generated(raw, previous = {}) {
  const format = taskDocumentFormat(raw);
  return Object.fromEntries(
    format.documents.map((template) => [
      template.path,
      matter.stringify(
        `## ${template.title}\n\n${template.instructions || '출처에서 확인한 내용'}`,
        {
          id: previous[template.path]
            ? matter(previous[template.path]).data.id
            : `${format.id}-${template.key}`,
          title: template.title,
          type: template.type,
          ...(previous[template.path] &&
          matter(previous[template.path]).data.system_id
            ? { system_id: matter(previous[template.path]).data.system_id }
            : {}),
          status: 'draft',
          sources: ['project'],
          document_bundle_id: format.id,
          document_output: {
            key: template.key,
            instructions: template.instructions,
          },
          ...(template.type === 'system'
            ? { system_id: `${format.id}:${template.key}` }
            : {}),
        },
      ),
    ]),
  );
}
test('three documents are an editable default; arbitrary roles, counts and Markdown instructions reach the task', () => {
  const defaults = defaultDocumentTemplates();
  assert.deepEqual(
    defaults.map((doc) => doc.title),
    ['게임 개요', '핵심 플레이', '모호한 점'],
  );
  defaults[0].title = 'changed';
  assert.equal(defaultDocumentTemplates()[0].title, '게임 개요');
  const documents = [
    {
      key: 'd1',
      title: '카드 데이터',
      type: 'system',
      instructions: '## 카드 목록\n카드 ID/비용/효과를 표로 출력한다.',
    },
    {
      key: 'd7',
      title: '작업 우선순위',
      type: 'question',
      instructions: '체크리스트로 출력한다.',
    },
  ];
  const raw = createTaskPlan(
    { ...input, documentResult: { ...input.documentResult, documents } },
    'format-test',
    files,
  );
  assert.deepEqual(
    taskDocumentFormat(raw).documents.map(({ path: _path, ...doc }) => doc),
    documents,
  );
  assert.match(raw, /카드 ID\/비용\/효과/);
  assert.doesNotMatch(
    matter(raw).content,
    /이 작업은 기존 세 문서 형식|각 시스템 문서에는 역할/,
  );
  const produced = generated(raw);
  const outputs = resolveTaskArtifacts(raw, produced, files);
  assert.equal(outputs.length, 2);
  validateArtifacts(files, { ...files, ...produced }, outputs);
  assert.equal(documentSets(outputs)[0].structure, 'custom');
  const next = createTaskPlan(input, 'next', {
    ...files,
    '.ai/tasks/format.md': raw,
  });
  assert.match(taskDocumentFormat(next).documents[0].path, /versions\/v2/);
});
test('custom output validation rejects malformed templates, missing files and silently substituted titles or types', () => {
  for (const documents of [
    [],
    Array.from({ length: 22 }, (_, i) => ({
      ...defaultDocumentTemplates()[0],
      key: `d${i + 1}`,
    })),
    [{ ...defaultDocumentTemplates()[0], title: '' }],
    [{ ...defaultDocumentTemplates()[0], key: '../escape' }],
    [{ ...defaultDocumentTemplates()[0], instructions: 'x'.repeat(4001) }],
    [defaultDocumentTemplates()[0], defaultDocumentTemplates()[0]],
  ])
    assert.throws(() => documentTemplates(documents), { code: 'GC-AI-004' });
  const raw = createTaskPlan(input, 'invalid-format', files),
    valid = generated(raw),
    first = Object.keys(valid)[0];
  assert.throws(() => resolveTaskArtifacts(raw, {}, files), {
    code: 'GC-AI-004',
  });
  for (const changes of [
    { title: 'AI overrode the title' },
    { type: 'system' },
    { document_output: { key: 'd9', instructions: '' } },
  ]) {
    const doc = matter(valid[first]);
    assert.throws(
      () =>
        resolveTaskArtifacts(
          raw,
          {
            ...valid,
            [first]: matter.stringify(doc.content, { ...doc.data, ...changes }),
          },
          files,
        ),
      { code: 'GC-AI-004' },
    );
  }
});
test('custom updates preserve paths/IDs, add documents and reject omission of existing documents', () => {
  const raw = createTaskPlan(input, 'original-format', files),
    produced = generated(raw),
    before = { ...files, ...produced };
  const original = taskDocumentFormat(raw),
    baseDir = original.documents[0].path.split('/').slice(0, -1).join('/');
  const documents = [
    ...defaultDocumentTemplates().map((doc) => ({
      ...doc,
      title: `${doc.title} 수정`,
    })),
    { key: 'd4', title: '경제 시스템', type: 'system', instructions: '가격표' },
  ];
  const updateInput = {
    ...input,
    documentResult: { mode: 'update', baseDir, structure: 'custom', documents },
  };
  const update = createTaskPlan(updateInput, 'update-format', before),
    artifacts = generated(update, produced);
  assert.equal(taskDocumentFormat(update).id, original.id);
  assert.equal(resolveTaskArtifacts(update, artifacts, before).length, 4);
  validateArtifacts(
    before,
    { ...before, ...artifacts },
    Object.keys(artifacts),
  );
  const changedTypes = documents.map((doc) =>
    doc.key === 'd2' ? { ...doc, type: 'question' } : doc,
  );
  const changedTypeTask = createTaskPlan(
    {
      ...updateInput,
      documentResult: {
        ...updateInput.documentResult,
        documents: changedTypes,
      },
    },
    'change-type',
    before,
  );
  const changedArtifacts = generated(changedTypeTask, produced);
  assert.equal(
    resolveTaskArtifacts(changedTypeTask, changedArtifacts, before).length,
    4,
  );
  assert.equal(
    matter(changedArtifacts[original.documents[1].path]).data.system_id,
    matter(produced[original.documents[1].path]).data.system_id,
  );
  assert.throws(
    () =>
      createTaskPlan(
        {
          ...updateInput,
          documentResult: {
            ...updateInput.documentResult,
            documents: documents.slice(1),
          },
        },
        'bad',
        before,
      ),
    { code: 'GC-AI-004' },
  );
});
test('custom one-document and multi-document workflows share the same frozen output specification', () => {
  for (const count of [1, 3, 21]) {
    const documents = Array.from({ length: count }, (_, i) => ({
      ...defaultDocumentTemplates()[0],
      key: `d${i + 1}`,
      title: `분석 ${i + 1}`,
    }));
    const raw = createTaskPlan(
      {
        ...input,
        documentResult: { ...input.documentResult, documents },
        thenImplement: { htmlResult: { mode: 'new' } },
      },
      `workflow-${count}`,
      files,
    );
    const stages = workflowStages(raw);
    assert.deepEqual(taskDocumentFormat(raw), taskDocumentFormat(stages[0]));
    assert.equal(matter(stages[1]).data.inputs.length, count);
    assert.equal(matter(raw).data.expected_outputs.length, count + 1);
  }
});
test('empty titles route to the output settings page and unsupported servers block before sending', async () => {
  const request = {
    organize: true,
    implement: false,
    inputPaths: ['project.md'],
    x: 0,
    y: 0,
    resultName: '',
    instructions: { organize: '분석한다', implement: '구현한다' },
    documentResult: {
      ...input.documentResult,
      documents: [{ ...defaultDocumentTemplates()[0], title: '' }],
    },
  };
  const issues = gamejamIssues(request, {
    collaboration: { active: false },
    provider: 'codex-cli',
    model: '',
    connection: { available: true, authenticated: true },
    checkingConnection: false,
    aiBusy: false,
    locked: false,
    updateRestarting: false,
  });
  assert.equal(issues[0].field, 'document-format');
  assert.equal(gamejamFieldPage('document-format'), 2);
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:4318',
      projectId: '00000000-0000-0000-0000-000000000000',
      token: 'fixture',
    },
    () => {},
  );
  Object.assign(client.state, {
    connected: true,
    role: 'admin',
    taskInstructionsEditable: true,
    taskResultNaming: true,
  });
  client.request = async () => {
    throw Error('Must not send');
  };
  await assert.rejects(
    client.command('tasks:create', input),
    /출력 구성.*업데이트/,
  );
  client.files['.ai/tasks/format.md'] = createTaskPlan(
    input,
    'old-server-format',
    files,
  );
  await assert.rejects(
    client.beginAi('.ai/tasks/format.md'),
    /출력 구성.*업데이트/,
  );
  client.stop();
});
test('shared server validates and publishes a custom document format atomically and rejects old executors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-format-'));
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  let owner;
  try {
    const created = await CollaborationClient.create(
      `http://127.0.0.1:${server.port}`,
      'fixture',
      '관리자',
      'fixture',
      files,
    );
    owner = new CollaborationClient(created.credentials, () => {});
    owner.accept(created.result);
    assert.equal(owner.state.documentOutputFormats, true);
    const task = await owner.command('tasks:create', input),
      raw = owner.files[task.relativePath];
    await assert.rejects(
      owner.request('ai-start', {
        taskPath: task.relativePath,
        revision: owner.state.revision,
      }),
      /출력 구성.*업데이트/,
    );
    await owner.beginAi(task.relativePath);
    await assert.rejects(
      owner.finishAi('completed', {}, 'fixture'),
      /문서가 없습니다/,
    );
    await owner.refresh();
    assert.equal(
      owner.files[taskDocumentFormat(raw).documents[0].path],
      undefined,
    );
    await owner.cancelAi();
    await owner.beginAi(task.relativePath);
    const produced = generated(raw);
    await owner.finishAi('completed', produced, 'fixture');
    const history = (await owner.history()).find(
      (entry) => entry.kind === 'ai' && entry.status === 'completed',
    );
    assert.deepEqual(history.aiTask.outputs, Object.keys(produced));
  } finally {
    owner?.stop();
    await server.close();
  }
});
