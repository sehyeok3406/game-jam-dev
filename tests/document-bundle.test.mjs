import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from '../src/markdown.ts';
import {
  createTaskPlan,
  workflowStages,
  newOutputsAlreadyExist,
} from '../src/task-plan.ts';
import {
  documentBundleContract,
  resolveTaskArtifacts,
  MAX_SYSTEM_DOCUMENTS,
} from '../src/document-bundle.ts';
import { validateArtifacts } from '../src/ai-artifacts.ts';
import { documentSets } from '../src/document-output.ts';
import { taskFileLock, isAiFileLocked } from '../src/ai-file-lock.ts';
import { snapshotDocuments } from '../src/collaboration-model.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const files = {
  'project.md': matter.stringify('Game idea', {
    id: 'project',
    title: 'Game',
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
  resultName: '카드 게임',
  documentResult: { mode: 'new', structure: 'systems' },
};
function artifacts(raw, count = 4, previous = {}) {
  const contract = documentBundleContract(raw);
  const systems = Array.from({ length: count }, (_, index) => {
    const key = `feature-${index + 1}`,
      relative = `${contract.systemPrefix}${key}.md`;
    return {
      key,
      path: relative,
      id: previous[relative]
        ? matter(previous[relative]).data.id
        : `${contract.id}-${key}`,
      title: `시스템 ${index + 1}`,
    };
  });
  const metadata = { status: 'draft', sources: ['project'] };
  return {
    [contract.overview]: matter.stringify('Game overview', {
      ...metadata,
      id: previous[contract.overview]
        ? matter(previous[contract.overview]).data.id
        : `${contract.id}-overview`,
      title: '개요',
      type: 'overview',
      document_bundle: { version: 1, id: contract.id, systems },
    }),
    ...Object.fromEntries(
      systems.map((system) => [
        system.path,
        matter.stringify('System rules', {
          ...metadata,
          id: system.id,
          title: system.title,
          type: 'system',
          document_bundle_id: contract.id,
          system_id: `${contract.id}:${system.key}`,
        }),
      ]),
    ),
  };
}
function mutate(raw, change) {
  const parsed = matter(raw);
  change(parsed.data);
  return matter.stringify(parsed.content, parsed.data);
}

test('new bundle reserves one overview and its namespace, supports 1–20 systems and keeps legacy plans', () => {
  const raw = createTaskPlan(input, 'bundle-test', files),
    bundle = documentBundleContract(raw);
  assert.equal(matter(raw).data.expected_outputs.length, 1);
  assert.equal(bundle.maxSystems, MAX_SYSTEM_DOCUMENTS);
  for (const count of [1, 4, 20]) {
    const produced = artifacts(raw, count);
    const outputs = resolveTaskArtifacts(raw, produced, files);
    assert.equal(outputs.length, count + 1);
    validateArtifacts(files, { ...files, ...produced }, outputs);
    assert.equal(documentSets(outputs)[0].structure, 'systems');
  }
  const taskPath = '.ai/tasks/bundle-test.md';
  const lock = taskFileLock({ ...files, [taskPath]: raw }, taskPath);
  assert.equal(isAiFileLocked(lock, `${bundle.systemPrefix}new.md`), true);
  assert.equal(isAiFileLocked(lock, 'docs/unrelated.md'), false);
  assert.equal(
    newOutputsAlreadyExist(raw, {
      ...files,
      [`${bundle.systemPrefix}other.md`]: 'existing',
    }),
    true,
  );
  const next = createTaskPlan(input, 'next', { ...files, [taskPath]: raw });
  assert.match(documentBundleContract(next).overview, /versions\/v2\//);
  const legacy = createTaskPlan(
    { ...input, documentResult: { mode: 'new' } },
    'legacy',
    files,
  );
  assert.equal(documentBundleContract(legacy), null);
  assert.equal(resolveTaskArtifacts(legacy, files).length, 3);
});

test('bundle index rejects incomplete, duplicate, mismatched and escaped results', () => {
  const raw = createTaskPlan(input, 'validation', files),
    bundle = documentBundleContract(raw);
  const valid = artifacts(raw);
  const first = Object.keys(valid)[1];
  const cases = [
    (candidate) => delete candidate[first],
    (candidate) =>
      (candidate[bundle.overview] = mutate(
        candidate[bundle.overview],
        (data) => delete data.document_bundle,
      )),
    (candidate) =>
      (candidate[bundle.overview] = mutate(candidate[bundle.overview], (data) =>
        data.document_bundle.systems.push(data.document_bundle.systems[0]),
      )),
    (candidate) =>
      (candidate[bundle.overview] = mutate(
        candidate[bundle.overview],
        (data) => (data.document_bundle.systems[0].path = 'docs/../project.md'),
      )),
    (candidate) =>
      (candidate[bundle.overview] = mutate(
        candidate[bundle.overview],
        (data) => (data.document_bundle.id = 'foreign-bundle'),
      )),
    (candidate) =>
      (candidate[first] = mutate(
        candidate[first],
        (data) => (data.system_id = 'wrong'),
      )),
    (candidate) =>
      (candidate[first] = mutate(
        candidate[first],
        (data) => (data.title = 'Wrong title'),
      )),
  ];
  for (const change of cases) {
    const candidate = { ...valid };
    change(candidate);
    assert.throws(() => resolveTaskArtifacts(raw, candidate, files), {
      code: 'GC-AI-004',
    });
  }
  assert.throws(() => resolveTaskArtifacts(raw, artifacts(raw, 21), files), {
    code: 'GC-AI-004',
  });
  assert.throws(
    () =>
      resolveTaskArtifacts(raw, valid, {
        ...files,
        [first]: 'unrelated document',
      }),
    { code: 'GC-AI-004' },
  );
  assert.throws(
    () =>
      documentBundleContract(
        mutate(raw, (data) => (data.document_bundle.systemPrefix = 'ideas/')),
      ),
    { code: 'GC-AI-004' },
  );
});

test('updates keep IDs, allow additional systems and recover missing files from the overview index', () => {
  const raw = createTaskPlan(input, 'original', files),
    produced = artifacts(raw, 4);
  const before = { ...files, ...produced };
  const baseDir = documentBundleContract(raw)
    .overview.split('/')
    .slice(0, -1)
    .join('/');
  const updateInput = { ...input, documentResult: { mode: 'update', baseDir } };
  const update = createTaskPlan(updateInput, 'update', before);
  assert.equal(
    documentBundleContract(update).id,
    documentBundleContract(raw).id,
  );
  const extended = artifacts(update, 5, produced);
  const outputs = resolveTaskArtifacts(update, extended, before);
  assert.equal(outputs.length, 6);
  validateArtifacts(before, { ...before, ...extended }, outputs);
  assert.throws(
    () => resolveTaskArtifacts(update, artifacts(update, 3, produced), before),
    { code: 'GC-AI-004' },
  );
  const overview = documentBundleContract(raw).overview;
  const missing = { ...files, [overview]: produced[overview] };
  const recovery = createTaskPlan(updateInput, 'recover', missing);
  assert.equal(matter(recovery).data.expected_outputs.length, 5);
  const docs = snapshotDocuments(before);
  assert.ok(docs.find((doc) => doc.relativePath === outputs[1]).systemId);
  assert.equal(
    docs.find((doc) => doc.relativePath === overview).documentBundleId,
    documentBundleContract(raw).id,
  );
});

test('workflow reserves variable documents and HTML under one frozen contract', () => {
  const raw = createTaskPlan(
    { ...input, thenImplement: { htmlResult: { mode: 'new' } } },
    'workflow-bundle',
    files,
  );
  const stages = workflowStages(raw);
  assert.equal(stages.length, 2);
  assert.equal(matter(raw).data.expected_outputs.length, 2);
  assert.deepEqual(
    documentBundleContract(stages[0]),
    documentBundleContract(raw),
  );
  const produced = artifacts(raw, 7),
    html = matter(stages[1]).data.expected_outputs[0];
  produced[html] = '<html><body>Game</body></html>';
  assert.equal(resolveTaskArtifacts(raw, produced, files).length, 9);
  const tampered = mutate(
    raw,
    (data) => (data.document_bundle.id = 'different'),
  );
  assert.throws(() => workflowStages(tampered), { code: 'GC-AI-004' });
});

test('shared server atomically publishes variable results, protects the namespace and records all outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-bundle-'));
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
    assert.equal(owner.state.documentBundles, true);
    const task = await owner.command('tasks:create', input),
      raw = owner.files[task.relativePath];
    await assert.rejects(
      owner.request('ai-start', {
        taskPath: task.relativePath,
        revision: owner.state.revision,
      }),
      /업데이트/,
    );
    await owner.beginAi(task.relativePath);
    const produced = artifacts(raw, 6),
      bundle = documentBundleContract(raw);
    await assert.rejects(
      owner.command('documents:save', {
        relativePath: Object.keys(produced)[1],
        content: 'illegal',
      }),
      /AI|파일|문서/,
    );
    const concurrent = await owner.command('documents:create-idea', {
      x: 10,
      y: 20,
    });
    const incomplete = { ...produced };
    delete incomplete[Object.keys(produced).at(-1)];
    await assert.rejects(
      owner.finishAi('completed', incomplete, 'fixture'),
      /시스템 문서가 없습니다/,
    );
    await owner.refresh();
    assert.equal(owner.files[bundle.overview], undefined);
    await owner.cancelAi();
    await owner.beginAi(task.relativePath);
    await assert.rejects(
      owner.finishAi(
        'completed',
        { ...produced, 'docs/extra.md': 'extra' },
        'fixture',
      ),
      /허용된 AI 결과/,
    );
    await owner.cancelAi();
    await owner.beginAi(task.relativePath);
    await owner.finishAi('completed', produced, 'fixture');
    assert.ok(owner.files[concurrent.relativePath]);
    for (const relative of Object.keys(produced))
      assert.ok(owner.files[relative]);
    const history = (await owner.history()).find(
      (entry) => entry.kind === 'ai' && entry.status === 'completed',
    );
    assert.deepEqual(history.aiTask.outputs, Object.keys(produced));
    assert.equal(owner.state.aiRun.status, 'completed');
  } finally {
    owner?.stop();
    await server.close();
  }
});

test('older servers are rejected before sending variable-document requests or executions', async () => {
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
  let sent = false;
  client.request = async () => {
    sent = true;
    throw Error('Unexpected request');
  };
  await assert.rejects(client.command('tasks:create', input), /함께 업데이트/);
  client.files['.ai/tasks/bundle.md'] = createTaskPlan(
    input,
    'old-server',
    files,
  );
  await assert.rejects(client.beginAi('.ai/tasks/bundle.md'), /함께 업데이트/);
  assert.equal(sent, false);
  client.stop();
});
