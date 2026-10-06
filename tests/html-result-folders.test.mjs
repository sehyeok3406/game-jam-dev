import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  isPreviewPath,
  nextPreviewPath,
  previewWindowPath,
  previewVersion,
} from '../src/preview-output.ts';
import { createTaskFiles, workflowStages } from '../src/task-plan.ts';
import {
  captureProject,
  materialize,
  saveHistory,
  restoreHistory,
} from '../src/project-store.ts';
import { expectedArtifacts, validateArtifacts } from '../src/ai-artifacts.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const initial = {
  'project.md': matter.stringify('게임 아이디어', {
    id: 'project',
    title: '게임',
    type: 'overview',
    status: 'draft',
    sources: [],
  }),
};
const input = {
  kind: 'implement',
  inputPaths: ['project.md'],
  x: 0,
  y: 0,
  resultName: '한밤의 카페',
};
const plan = (files, options = input, id = 'fixture') => {
  const tasks = createTaskFiles(options, id, files);
  const raw = tasks[`.ai/tasks/${id}.md`];
  return { tasks, raw, data: matter(raw).data };
};

test('first HTML and sequential workflow use dedicated folders with identical local/server plans', () => {
  for (const options of [
    input,
    {
      ...input,
      kind: 'organize',
      documentResult: { mode: 'new' },
      thenImplement: {
        resultName: input.resultName,
        htmlResult: { mode: 'new' },
      },
    },
  ]) {
    const local = plan(initial, options);
    const html = local.data.expected_outputs.at(-1);
    assert.equal(html, 'output/games/v1-한밤의-카페/index.html');
    assert.equal(previewVersion(html), 1);
    assert.equal(expectedArtifacts(local.raw).at(-1), html);
    const shared = reduceCollaboration(initial, 'tasks:create', options);
    assert.deepEqual(
      matter(shared.files[shared.result.relativePath]).data.expected_outputs,
      local.data.expected_outputs,
    );
    const stage = workflowStages(local.raw).at(-1) ?? local.raw;
    assert.match(
      stage,
      /프로젝트 내부 경로·외부 라이브러리 다운로드에 의존하지 않는다/,
    );
    assert.match(stage, /캔버스 정보·기획 문서를 작성하지 않는다/);
    assert.equal(initial[html], undefined);
  }
});

test('pending requests reserve unique folders across legacy, imported and new output paths', () => {
  const files = {
    ...initial,
    'output/index.html': '<html><body>legacy</body></html>',
    'output/versions/v7-old.html': '<html><body>legacy v7</body></html>',
    'output/games/v8-other/index.html': '<html><body>other</body></html>',
  };
  const options = { ...input, htmlResult: { mode: 'new' } };
  const first = plan(files, options, 'first');
  const second = plan({ ...files, ...first.tasks }, options, 'second');
  assert.equal(
    first.data.expected_outputs[0],
    'output/games/v9-한밤의-카페/index.html',
  );
  assert.equal(
    second.data.expected_outputs[0],
    'output/games/v10-한밤의-카페/index.html',
  );
  assert.equal(
    nextPreviewPath([
      'output/imported/import-00000000-0000-0000-0000-000000000000.html',
    ]),
    'output/games/v1/index.html',
  );
  for (const invalid of [
    'output/games/v01-game/index.html',
    'output/games/v0/index.html',
    'output/games/v9007199254740992/index.html',
    'output/games/v2/other.html',
    'output/games/v2/../index.html',
    'output/games/v2-game/notes.md',
    'output/games/v2-game/index.html/other',
    'output/games/v2-game\\index.html',
  ])
    assert.equal(isPreviewPath(invalid), false, invalid);
});

test('updates keep selected folder and legacy filenames even when the title changes', () => {
  for (const base of [
    'output/index.html',
    'output/versions/v3-old.html',
    'output/games/v3-old/index.html',
  ]) {
    const files = { ...initial, [base]: '<html><body>original</body></html>' };
    const update = plan(files, {
      ...input,
      htmlResult: { mode: 'update', basePath: base },
    });
    assert.deepEqual(update.data.expected_outputs, [base]);
    assert.equal(update.data.base_html, base);
    const implicit = plan(files);
    assert.deepEqual(implicit.data.expected_outputs, [base]);
    assert.equal(implicit.data.base_html, base);
    const next = plan(files, {
      ...input,
      htmlResult: { mode: 'new', basePath: base },
    });
    assert.notEqual(next.data.expected_outputs[0], base);
    assert.equal(next.data.base_html, base);
  }
  assert.notEqual(
    previewWindowPath('output/games/v2-one/index.html'),
    previewWindowPath('output/games/v2-two/index.html'),
  );
  assert.notEqual(
    previewWindowPath('output/games/v2-one/index.html'),
    previewWindowPath('output/versions/v2-one.html'),
  );
});

test('output folders contain no app metadata; copying one folder and restoring its HTML preserve other results', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-result-folder-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const request = plan(initial);
  const output = request.data.expected_outputs[0];
  const html =
    '<!doctype html><html><head><style>body{background:#123}</style></head><body><canvas></canvas><script>window.gameScore=1;</script></body></html>';
  const before = { ...initial, ...request.tasks, [output]: html };
  const after = {
    ...before,
    [output]: html.replace('gameScore=1', 'gameScore=2'),
  };
  validateArtifacts(before, after, [output]);
  await materialize(root, after);
  assert.deepEqual(await captureProject(root), after);
  await materialize(root, { [previewWindowPath(output)]: '{"x":20}' });
  await saveHistory(root, before, after, {
    id: 'folder-history',
    label: 'HTML 업데이트',
    kind: 'ai',
    status: 'completed',
    createdAt: Date.now(),
  });
  const folder = path.dirname(path.join(root, output));
  assert.deepEqual(await fs.readdir(folder), ['index.html']);
  await fs.cp(folder, path.join(root, 'export-copy'), { recursive: true });
  assert.deepEqual(await fs.readdir(path.join(root, 'export-copy')), [
    'index.html',
  ]);
  assert.equal(
    await fs.readFile(path.join(root, 'export-copy/index.html'), 'utf8'),
    after[output],
  );
  await restoreHistory(root, 'folder-history', output, 'before');
  assert.deepEqual(await captureProject(root), before);
  assert.deepEqual(await fs.readdir(folder), ['index.html']);
});

test('old servers cannot silently fall back to flat outputs, but document-only requests remain available', async () => {
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:4318',
      projectId: '00000000-0000-0000-0000-000000000000',
      token: 'fixture',
    },
    () => {},
  );
  client.state = {
    ...client.state,
    connected: true,
    role: 'admin',
    taskInstructionsEditable: true,
    taskResultNaming: true,
  };
  let sent = false;
  client.request = async () => {
    sent = true;
    throw new Error('request probe');
  };
  await assert.rejects(client.command('tasks:create', input), /v0.8.1/);
  assert.equal(sent, false);
  await assert.rejects(
    client.command('tasks:create', {
      kind: 'organize',
      inputPaths: ['project.md'],
      x: 0,
      y: 0,
    }),
    /request probe/,
  );
  assert.equal(sent, true);
  client.stop();
});
