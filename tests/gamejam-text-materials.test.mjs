import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from 'gray-matter';
import { createTextObject } from '../src/text-document.ts';
import { applyDrawing } from '../src/drawing-model.ts';
import {
  textMaterialMarkdown,
  textMaterialPath,
  textMaterialItems,
} from '../src/canvas-text-materials.ts';
import { prepareTextSources } from '../src/gamejam-text-sources.ts';
import { createTaskFiles, workflowStages } from '../src/task-plan.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import {
  reduceCollaboration,
  snapshotDocuments,
} from '../src/collaboration-model.ts';
import { parseApprovalRequest } from '../src/gamejam-approval.ts';
import { planApproval } from '../src/server/project-operations.ts';
import { validateArtifacts, expectedArtifacts } from '../src/ai-artifacts.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { gamejamIssues } from '../src/gamejam-validation.ts';

const p = (text) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
});
const text = createTextObject(150, 170);
text.geometry.document = JSON.stringify({
  type: 'doc',
  content: [
    p('별을 모아 탈출하기'),
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            p('보석 획득'),
            {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [{ type: 'listItem', content: [p('출구 열기')] }],
            },
          ],
        },
      ],
    },
  ],
});
const other = createTextObject(600, 170);
other.geometry.document = JSON.stringify({
  type: 'doc',
  content: [p('선택하지 않은 비밀 재료')],
});
const files = applyDrawing(
  {},
  { canvasId: 'default', action: 'create', objects: [text, other] },
);
const ref = textMaterialPath({ ...text, canvasId: 'default' });
const request = {
  organize: false,
  implement: true,
  inputPaths: [ref],
  x: 800,
  y: 100,
  htmlResult: { mode: 'new' },
  instructions: {
    organize: '선택한 자료 정리',
    implement: '선택한 자료로 게임 구현',
  },
  resultName: '별 모으기',
};

test('text materials retain paragraphs, bullet nesting and ordered list start, while empty lists are not materials', () => {
  assert.equal(
    textMaterialMarkdown(text.geometry.document),
    '별을 모아 탈출하기\n\n- 보석 획득\n  3. 출구 열기',
  );
  const empty = {
    ...text,
    geometry: {
      ...text.geometry,
      document: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [p('')] }],
          },
        ],
      }),
    },
  };
  assert.equal(
    textMaterialItems([{ ...empty, canvasId: 'default' }]).length,
    0,
  );
});
test('text-only task captures exactly the chosen text and retains original selection for history', () => {
  const added = createTaskFiles(gamejamTaskInput(request), 'text-task', files);
  const task = matter(added['.ai/tasks/text-task.md']);
  assert.equal(task.data.inputs.length, 1);
  const source = task.data.inputs[0];
  assert.ok(source.startsWith('docs/text-sources/'));
  assert.match(added[source], /보석 획득/);
  assert.ok(!JSON.stringify(added).includes('선택하지 않은 비밀 재료'));
  assert.deepEqual(task.data.gamejam_request.request.inputPaths, [ref]);
  assert.equal(
    snapshotDocuments({ ...files, ...added }).length,
    1,
    'no extra source card appears',
  );
  const changed = applyDrawing(
    { ...files, ...added },
    {
      canvasId: 'default',
      action: 'patch',
      patches: [
        {
          id: text.id,
          generation: text.generation,
          expectedGeometry: text.geometry,
          geometry: {
            ...text.geometry,
            document: JSON.stringify({
              type: 'doc',
              content: [p('수정된 재료')],
            }),
          },
        },
      ],
    },
  );
  assert.equal(
    changed[source],
    added[source],
    'queued input is immutable after original edits',
  );
  const next = prepareTextSources(changed, [ref]);
  assert.notEqual(next.paths[0], source);
});
test('text-only organize + implement workflow has valid real input paths and output source IDs', () => {
  const added = createTaskFiles(
    gamejamTaskInput({ ...request, organize: true }),
    'both',
    files,
  );
  const raw = added['.ai/tasks/both.md'];
  const stages = workflowStages(raw);
  assert.equal(stages.length, 2);
  const source = matter(stages[0]).data.inputs[0];
  const id = matter(added[source]).data.id;
  const outputs = expectedArtifacts(stages[0]);
  const after = {
    ...files,
    ...added,
    ...Object.fromEntries(
      outputs.map((path, i) => [
        path,
        matter.stringify('# 정리\n본문', {
          id: 'result-' + i,
          title: '문서 ' + i,
          type: i === 0 ? 'overview' : i === 1 ? 'system' : 'question',
          status: 'draft',
          sources: [id],
        }),
      ]),
    ),
  };
  validateArtifacts({ ...files, ...added }, after, outputs);
});
test('shared command and approval resolve drawings server-side and yield stable review tokens', () => {
  const parsed = parseApprovalRequest(request);
  assert.deepEqual(parsed.inputPaths, [ref]);
  const result = reduceCollaboration(
    files,
    'tasks:create',
    gamejamTaskInput(request),
    { id: () => 'task-id', now: () => 100 },
  );
  assert.equal(result.result.type, 'ai-task');
  assert.ok(
    matter(result.files[result.result.relativePath]).data.inputs[0].startsWith(
      'docs/text-sources/',
    ),
  );
  const project = { files, aiQueue: [], job: null };
  assert.equal(
    planApproval(project, parsed).reviewToken,
    planApproval(project, parsed).reviewToken,
  );
});
test('deleted/recreated, moved, empty and malformed text materials fail without partial writes; existing source snapshots are reused', () => {
  const before = JSON.stringify(files);
  for (const path of [
    ref.replace(text.generation, other.generation),
    ref.replace('default:', 'missing:'),
    'canvas-text:../../outside',
  ])
    assert.throws(() => prepareTextSources(files, [path]));
  const first = prepareTextSources(files, [ref, ref]);
  assert.equal(first.paths.length, 1);
  const repeated = prepareTextSources({ ...files, ...first.additions }, [ref]);
  assert.deepEqual(repeated.additions, {});
  const corrupt = { ...files, ...first.additions, [first.paths[0]]: 'changed' };
  assert.throws(() => prepareTextSources(corrupt, [ref]), /사본/);
  assert.equal(JSON.stringify(files), before);
});

test('two real clients submit a text-only approval and retain server-created source snapshots after restart', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-text-materials-'),
  );
  let server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.stop());
    await server.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('gamejam-text-materials-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const initial = await CollaborationClient.create(
    url,
    '',
    'owner',
    'text material test',
    files,
  );
  const owner = new CollaborationClient(initial.credentials, () => {});
  owner.accept(initial.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    url,
    initial.result.code,
    'editor',
  );
  const peer = new CollaborationClient(joined.credentials, () => {});
  peer.accept(joined.result);
  clients.push(peer);
  assert.equal(owner.state.gamejamTextMaterialsVersion, 1);
  const item = await peer.mutateApproval('create', {
    commandId: randomUUID(),
    request,
  });
  const first = await owner.readApproval(item.id),
    second = await owner.readApproval(item.id);
  assert.equal(first.reviewToken, second.reviewToken);
  const receipt = await owner.command(
    'tasks:create',
    gamejamTaskInput(request),
  );
  const task = Object.entries(owner.files).find(([p]) =>
    p.startsWith('.ai/tasks/'),
  );
  const source = matter(task[1]).data.inputs[0];
  await peer.refresh();
  assert.equal(peer.files[source], owner.files[source]);
  assert.ok(!JSON.stringify(owner.files[source]).includes('비밀'));
  assert.ok(receipt);
  const review = await owner.readApproval(item.id);
  await owner.beginAi('', 'fixture-model', 'codex-cli', {
    id: item.id,
    revision: review.item.revision,
    reviewToken: review.reviewToken,
    commandId: randomUUID(),
  });
  assert.ok(
    owner.state.aiRun?.taskPath,
    'approved text request creates a server lease without executing an AI provider',
  );
  await server.close();
  server = await createCollaborationServer({
    dataDirectory: directory,
    port: Number(new URL(url).port),
  });
  await owner.refresh();
  assert.match(owner.files[source], /출구 열기/);
});
test('old collaboration servers show an actionable text-material compatibility error', () => {
  const issues = gamejamIssues(request, {
    intent: 'content',
    collaboration: { active: true, connected: true, members: [], locks: [] },
    provider: 'codex-cli',
    model: '',
    connection: null,
    checkingConnection: false,
    aiBusy: false,
    locked: false,
    updateRestarting: false,
  });
  assert.ok(
    issues.some(
      (i) => i.message.includes('텍스트 재료') && i.message.includes('v0.35.4'),
    ),
  );
});

test('text, Markdown and HTML can be combined without passing virtual references to the executor', () => {
  const mixedFiles = {
    ...files,
    'ideas/memo.md': matter.stringify('추가 기획', {
      id: 'memo',
      title: '기획',
      type: 'idea',
      status: 'draft',
      sources: [],
    }),
    'output/index.html':
      '<!doctype html><html><head><title>기존 게임</title></head><body>게임</body></html>',
  };
  const added = createTaskFiles(
    gamejamTaskInput({
      ...request,
      sourceMode: 'html-compose',
      inputPaths: [ref, 'ideas/memo.md', 'output/index.html'],
    }),
    'mixed',
    mixedFiles,
  );
  const task = matter(added['.ai/tasks/mixed.md']);
  assert.ok(task.data.inputs.includes('ideas/memo.md'));
  assert.ok(task.data.inputs.includes('output/index.html'));
  assert.ok(task.data.inputs.some((p) => p.startsWith('docs/text-sources/')));
  assert.ok(task.data.inputs.every((p) => !p.startsWith('canvas-text:')));
  assert.equal(
    added['output/index.html'],
    undefined,
    'input HTML is preserved',
  );
});
