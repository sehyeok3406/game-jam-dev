import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from '../src/markdown.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import {
  createTaskPlan,
  workflowStages,
  newOutputsAlreadyExist,
  assertStageInputs,
} from '../src/task-plan.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { DEFAULT_TASK_INSTRUCTIONS } from '../src/task-instructions.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const files = {
  'project.md': matter.stringify('Project', {
    id: 'project',
    title: 'project',
    type: 'overview',
    status: 'draft',
    sources: [],
  }),
  'ideas/a.md': matter.stringify('Idea', {
    id: 'a',
    title: 'a',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
  'ideas/image.md': matter.stringify('Asset', {
    id: 'image',
    title: 'image',
    type: 'image',
    status: 'draft',
    sources: [],
    asset: {
      path: 'assets/images/test.png',
      purpose: 'asset',
      originalName: 'test.png',
      mime: 'image/png',
      bytes: 78,
    },
  }),
  'assets/images/test.png':
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
  'output/index.html': '<html><body>old game</body></html>',
};
const request = {
  organize: true,
  implement: true,
  inputPaths: ['ideas/a.md', 'ideas/image.md'],
  x: 1,
  y: 2,
  documentResult: { mode: 'new' },
  htmlResult: { mode: 'new', basePath: 'output/index.html' },
  resultName: '밤 카페',
  instructions: { ...DEFAULT_TASK_INSTRUCTIONS },
};

test('gamejam checkboxes cover all combinations without discarding edited instructions', () => {
  const edited = {
    ...request,
    instructions: { organize: '정리 지시', implement: '구현 지시' },
  };
  const before = structuredClone(edited);
  const both = gamejamTaskInput(edited);
  assert.equal(both.kind, 'organize');
  assert.equal(both.instructions, '정리 지시');
  assert.equal(both.thenImplement.instructions, '구현 지시');
  assert.equal(
    gamejamTaskInput({ ...edited, organize: false }).kind,
    'implement',
  );
  assert.equal(
    gamejamTaskInput({ ...edited, implement: false }).thenImplement,
    undefined,
  );
  assert.throws(
    () => gamejamTaskInput({ ...edited, organize: false, implement: false }),
    { code: 'GC-AI-001' },
  );
  assert.throws(
    () =>
      gamejamTaskInput({
        ...edited,
        instructions: { organize: '정리', implement: ' ' },
      }),
    { code: 'GC-AI-001' },
  );
  assert.deepEqual(edited, before);
});

test('local and server task plans reserve both outputs and pass only fresh documents and selected images to HTML', () => {
  const input = gamejamTaskInput(request);
  const raw = createTaskPlan(input, 'gamejam-fixture', files);
  const steps = workflowStages(raw).map(matter);
  assert.equal(steps[0].data.expected_outputs.length, 3);
  assert.deepEqual(steps[1].data.inputs, [
    ...steps[0].data.expected_outputs,
    'ideas/image.md',
  ]);
  assert.equal(steps[1].data.base_html, 'output/index.html');
  assert.equal(steps[1].data.result_name, '밤 카페');
  const shared = reduceCollaboration(files, 'tasks:create', input);
  assert.equal(
    shared.result.relativePath.startsWith('.ai/tasks/gamejam-'),
    true,
  );
  assert.deepEqual(
    workflowStages(shared.files[shared.result.relativePath]).map(
      (s) => matter(s).data.expected_outputs,
    ),
    steps.map((s) => s.data.expected_outputs),
  );
  const next = createTaskPlan(input, 'next', {
    ...files,
    '.ai/tasks/reserved.md': raw,
  });
  assert.notDeepEqual(
    matter(next).data.expected_outputs,
    matter(raw).data.expected_outputs,
  );
});

test('new/update checks handle each artifact group separately, including mixed modes', () => {
  const first = createTaskPlan(gamejamTaskInput(request), 'first', files);
  const outputs = matter(first).data.expected_outputs;
  const existing = {
    ...files,
    ...Object.fromEntries(
      outputs.slice(0, 3).map((path, index) => [
        path,
        matter.stringify('old', {
          id: `doc${index}`,
          title: 'old',
          type: 'system',
          status: 'draft',
          sources: ['a'],
        }),
      ]),
    ),
  };
  const mixed = createTaskPlan(
    gamejamTaskInput({
      ...request,
      documentResult: { mode: 'update', baseDir: 'docs' },
    }),
    'mixed',
    existing,
  );
  assert.equal(newOutputsAlreadyExist(mixed, existing), false);
  const htmlPath = matter(mixed).data.expected_outputs.at(-1);
  assert.equal(
    newOutputsAlreadyExist(mixed, { ...existing, [htmlPath]: 'existing' }),
    true,
  );
  const reverse = createTaskPlan(
    gamejamTaskInput({
      ...request,
      htmlResult: { mode: 'update', basePath: 'output/index.html' },
    }),
    'reverse',
    existing,
  );
  assert.equal(newOutputsAlreadyExist(reverse, existing), false);
});

test('malformed plans, extra stage scope and tampered organized input are rejected', () => {
  const raw = createTaskPlan(gamejamTaskInput(request), 'first', files),
    parsed = matter(raw);
  const bad = structuredClone(parsed.data);
  const second = matter(bad.workflow_steps[1]);
  second.data.inputs.push('docs/unrelated.md');
  bad.workflow_steps[1] = matter.stringify(second.content, second.data);
  assert.throws(() => workflowStages(matter.stringify(parsed.content, bad)), {
    code: 'GC-AI-004',
  });
  assert.throws(
    () =>
      createTaskPlan(
        { ...gamejamTaskInput(request), kind: 'implement' },
        'bad',
        files,
      ),
    { code: 'GC-AI-001' },
  );
  assert.throws(
    () =>
      assertStageInputs(
        { 'docs/a.md': 'immutable' },
        { 'docs/a.md': 'changed', 'output/index.html': 'html' },
        ['output/index.html'],
      ),
    { code: 'GC-AI-003' },
  );
  assertStageInputs(
    { 'docs/a.md': 'immutable' },
    { 'docs/a.md': 'immutable', 'output/index.html': 'html' },
    ['output/index.html'],
  );
});

test('older servers cannot silently drop the second workflow stage', async () => {
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:4318',
      projectId: '00000000-0000-0000-0000-000000000000',
      token: 'fixture',
    },
    () => {},
  );
  client.state.connected = true;
  client.state.taskInstructionsEditable = true;
  client.state.taskResultNaming = true;
  client.state.htmlResultFolders = true;
  let sent = false;
  client.request = async () => {
    sent = true;
    throw new Error('unexpected');
  };
  await assert.rejects(
    client.command('tasks:create', gamejamTaskInput(request)),
    /서버.*v0.7.9/,
  );
  assert.equal(sent, false);
  client.stop();
});

test('workflow server gates old executors, enforces admins and one lease, and publishes four attributed artifacts together', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-server-test-'));
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  let owner, editor;
  try {
    const url = `http://127.0.0.1:${server.port}`;
    const created = await CollaborationClient.create(
      url,
      'fixture',
      '관리자',
      'fixture',
      files,
    );
    owner = new CollaborationClient(created.credentials, () => {});
    owner.accept(created.result);
    assert.equal(owner.state.gamejamWorkflow, true);
    const joined = await CollaborationClient.join(
      url,
      created.result.code,
      '편집자',
    );
    editor = new CollaborationClient(joined.credentials, () => {});
    editor.accept(joined.result);
    await owner.refresh();
    const task = await owner.command('tasks:create', gamejamTaskInput(request));
    await assert.rejects(
      owner.request('ai-start', {
        taskPath: task.relativePath,
        revision: owner.state.revision,
      }),
      /관리자 앱 v0.7.9/,
    );
    await editor.command('tasks:create', gamejamTaskInput(request));
    await owner.refresh();
    await owner.beginAi(task.relativePath);
    await assert.rejects(
      editor.command('documents:create-idea', { x: 0, y: 0 }),
      /AI 작업/,
    );
    const expected = matter(owner.files[task.relativePath]).data
      .expected_outputs;
    await owner.finishAi('cancelled', {}, null);
    for (const relative of expected)
      assert.equal(owner.files[relative], undefined);
    const next = await owner.command('tasks:create', gamejamTaskInput(request));
    await owner.beginAi(next.relativePath);
    const outputs = matter(owner.files[next.relativePath]).data
      .expected_outputs;
    const artifacts = Object.fromEntries(
      outputs.map((relative, index) => [
        relative,
        relative.endsWith('.html')
          ? '<html><body>gamejam</body></html>'
          : matter.stringify('organized', {
              id: `workflow-doc-${index}`,
              title: 'organized',
              type: 'system',
              status: 'draft',
              sources: ['a', 'image'],
            }),
      ]),
    );
    await owner.finishAi('completed', artifacts, 'fixture');
    await editor.refresh();
    for (const relative of outputs)
      assert.equal(editor.files[relative], artifacts[relative]);
    assert.equal(editor.files['output/index.html'], files['output/index.html']);
    assert.equal(editor.state.aiRun.status, 'completed');
    const history = await editor.history();
    assert.ok(
      history.some(
        (entry) =>
          entry.status === 'completed' &&
          entry.kind === 'ai' &&
          entry.actorName === '관리자' &&
          entry.files.length === outputs.length + 1,
      ),
    );
  } finally {
    owner?.stop();
    editor?.stop();
    await server.close();
  }
});
