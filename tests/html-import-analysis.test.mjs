import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { buildFileImports } from '../src/file-assets.ts';
import {
  htmlSourcePath,
  htmlSourceId,
  htmlHash,
  describePreview,
  inspectImportedHtml,
  validateHtmlAnalysis,
} from '../src/html-source.ts';
import {
  isPreviewPath,
  previewVersion,
  nextPreviewPath,
  previewLabel,
} from '../src/preview-output.ts';
import {
  createTaskFiles,
  createTaskPlan,
  workflowStages,
  assertStageInputs,
} from '../src/task-plan.ts';
import { validateArtifacts } from '../src/ai-artifacts.ts';
import {
  captureProject,
  materialize,
  saveHistory,
  restoreHistory,
  localFileAuthorship,
} from '../src/project-store.ts';
import {
  reduceCollaboration,
  snapshotDocuments,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { HTML_ANALYSIS_INSTRUCTIONS } from '../src/task-instructions.ts';
import {
  PREVIEW_SANDBOX,
  previewPermissionAllowed,
} from '../src/preview-permissions.ts';

const project = {
  'project.md':
    '---\nid: project\ntitle: test\ntype: overview\nstatus: draft\nsources: []\n---\n# test',
};
const game =
  '<!doctype html><html><head><title>타겟 게임</title><style>body{color:red}</style></head><body><button>Play</button><canvas id="game"></canvas><script>let score=0;document.querySelector("button").onclick=()=>score++;</script></body></html>';
const batch = {
  x: 150,
  y: 280,
  imagePurpose: 'asset',
  files: [{ name: '타겟 게임.HTM', content: game }],
};
function fixture() {
  const files = { ...project, ...buildFileImports(batch) };
  const html = Object.keys(files).find((path) => path.endsWith('.html'));
  const input = {
    kind: 'organize',
    sourceMode: 'html',
    inputPaths: [html],
    x: 1000,
    y: 280,
    documentResult: { mode: 'new' },
    resultName: '타겟 게임',
  };
  return { files, html, input };
}
function artifacts(task, id = 'analysis') {
  const data = matter(task).data;
  return Object.fromEntries(
    data.expected_outputs.map((relative, index) => [
      relative,
      relative.endsWith('.html')
        ? '<html><body>reimplemented</body></html>'
        : matter.stringify(
            '## 확인된 구현\n\n조작과 코드의 규칙.\n\n## AI의 추정\n\n없음\n\n## 확인 불가\n\n기획 의도',
            {
              id: `${id}-${index}`,
              title: 'HTML 분석',
              type: index === 2 ? 'question' : 'system',
              status: 'draft',
              sources: [data.html_analysis_source.id],
              analyzed_html: data.html_analysis_source,
            },
          ),
    ]),
  );
}

test('HTML imports preserve exact bytes, own stable source metadata and canvas positions without occupying result version numbers', () => {
  const { files, html } = fixture();
  checkSnapshot(files);
  assert.equal(files[html], game);
  assert.equal(previewVersion(html), 0);
  assert.match(previewLabel(html), /미분류/);
  assert.equal(
    nextPreviewPath(Object.keys(files)),
    'output/inbox/untitled/v001/index.html',
  );
  const record = snapshotDocuments(files).find((doc) => doc.htmlSource);
  assert.equal(record.id, htmlSourceId(html));
  assert.equal(record.htmlSource, html);
  assert.equal(record.title, '타겟 게임');
  const preview = describePreview(files, html);
  assert.equal(preview.initialWindow.x, 150);
  assert.equal(preview.initialWindow.y, 280);
  assert.equal(preview.sourceId, record.id);
  assert.equal(preview.title, record.title);
  assert.deepEqual(preview.warnings, []);
  const again = buildFileImports(batch);
  assert.ok(Object.keys(again).every((key) => files[key] === undefined));
  for (const unsafe of [
    'output/imported/../index.html',
    'output/imported/index.html',
    'output/imported/IMPORT-a.html',
    'file:///game.html',
  ])
    assert.equal(isPreviewPath(unsafe), false);
});

test('malformed and oversized HTML fail before publication; dependencies warn without fetching or evaluating', () => {
  for (const content of [
    '',
    '```html\n<html><body>game</body></html>\n```',
    '<html><body></body></html>',
    '\0' + game,
    game + ' '.repeat(8_000_000),
  ])
    assert.throws(
      () =>
        buildFileImports({ ...batch, files: [{ name: 'bad.html', content }] }),
      { code: 'GC-IMPORT-003' },
    );
  const original = JSON.stringify(project);
  assert.throws(() =>
    reduceCollaboration(project, 'files:import-batch', {
      ...batch,
      files: [...batch.files, { name: 'bad.exe', content: 'bad' }],
    }),
  );
  assert.equal(JSON.stringify(project), original);
  assert.equal(
    inspectImportedHtml(
      game.replace(
        '<script>',
        '<img src="assets/player.png"><script src="./game.js"></script><script>',
      ),
      'game.html',
    ).length,
    1,
  );
  assert.equal(
    inspectImportedHtml(
      game.replace('<script>', '<script>fetch("https://example.test/data");'),
      'game.html',
    ).length,
    1,
  );
  assert.equal(PREVIEW_SANDBOX, 'allow-scripts allow-pointer-lock');
  assert.equal(
    previewPermissionAllowed('pointerLock', true, false, false, 'about:srcdoc'),
    false,
  );
});

test('HTML source and metadata survive disk snapshots, import history and attributed restore', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-import-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { files, html } = fixture();
  await materialize(root, files);
  assert.deepEqual(await captureProject(root), files);
  assert.equal(await fs.readFile(path.join(root, html), 'utf8'), game);
  await saveHistory(root, project, files, {
    id: 'html-import',
    label: 'HTML 불러오기',
    kind: 'user',
    status: 'completed',
    createdAt: 1,
  });
  assert.equal(
    (await localFileAuthorship(root, html)).createdBy.name,
    '로컬 사용자',
  );
  await assert.rejects(restoreHistory(root, 'html-import', html), /전체 기록/);
  await restoreHistory(root, 'html-import');
  assert.equal((await captureProject(root))[html], game);
});

test('local and shared HTML tasks use identical source scope, editable analysis defaults and immutable versioned originals', () => {
  const { files, html, input } = fixture();
  const raw = createTaskPlan(input, 'analysis', files);
  const spec = matter(raw);
  assert.deepEqual(spec.data.inputs, [html, htmlSourcePath(html)]);
  assert.equal(spec.data.source_mode, 'html');
  assert.equal(spec.data.instructions_source, 'default');
  assert.ok(spec.content.includes(HTML_ANALYSIS_INSTRUCTIONS));
  assert.deepEqual(spec.data.html_analysis_source, {
    id: htmlSourceId(html),
    path: html,
    sha256: htmlHash(game),
  });
  assert.equal(spec.data.expected_outputs.length, 3);
  assert.match(
    createTaskPlan(
      { ...input, instructions: '추가 지침으로 조작만 정리' },
      'edited',
      files,
    ),
    /추가 지침으로 조작만 정리/,
  );
  const reduced = reduceCollaboration(files, 'tasks:create', input);
  const serverSpec = matter(reduced.files[reduced.result.relativePath]);
  assert.deepEqual(serverSpec.data.inputs, spec.data.inputs);
  assert.deepEqual(
    serverSpec.data.html_analysis_source,
    spec.data.html_analysis_source,
  );
  assert.equal(files[html], game);
  const combined = createTaskPlan(
    {
      ...input,
      thenImplement: { htmlResult: { mode: 'new', basePath: html } },
    },
    'both',
    files,
  );
  const stages = workflowStages(combined);
  assert.deepEqual(matter(stages[1]).data.inputs, [
    ...spec.data.expected_outputs,
    html,
    htmlSourcePath(html),
  ]);
  assert.equal(matter(stages[1]).data.base_html, html);
  assert.throws(
    () =>
      createTaskPlan(
        {
          ...input,
          thenImplement: { htmlResult: { mode: 'update', basePath: html } },
        },
        'bad',
        files,
      ),
    { code: 'GC-AI-007' },
  );
  assert.throws(
    () =>
      createTaskPlan(
        { ...input, inputPaths: [html, 'output/index.html'] },
        'bad',
        { ...files, 'output/index.html': game },
      ),
    { code: 'GC-AI-007' },
  );
});

test('existing generated HTML gets a source record atomically and HTML source IDs cannot be spoofed', () => {
  const files = { ...project, 'output/index.html': game };
  const input = {
    kind: 'organize',
    sourceMode: 'html',
    inputPaths: ['output/index.html'],
    x: 10,
    y: 20,
  };
  const additions = createTaskFiles(input, 'generated', files);
  assert.equal(Object.keys(additions).length, 2);
  checkSnapshot({ ...files, ...additions });
  const { files: imported, html, input: importedInput } = fixture();
  const key = htmlSourcePath(html);
  const spoofed = {
    ...imported,
    [key]: imported[key].replace(htmlSourceId(html), 'fake-id'),
  };
  assert.throws(() => checkSnapshot(spoofed), { code: 'GC-AI-007' });
  assert.throws(() => createTaskFiles(importedInput, 'spoofed', spoofed), {
    code: 'GC-AI-007',
  });
});

test('analysis validates exact selected source and hash; stale, absent or fabricated provenance cannot publish', () => {
  const { files, html, input } = fixture();
  const raw = createTaskPlan(input, 'analysis', files);
  const outputs = matter(raw).data.expected_outputs;
  const after = { ...files, ...artifacts(raw) };
  validateArtifacts(files, after, outputs);
  validateHtmlAnalysis(raw, after, outputs);
  assert.throws(
    () =>
      validateHtmlAnalysis(
        raw,
        { ...after, [html]: game + '<!-- changed -->' },
        outputs,
      ),
    { code: 'GC-SYNC-001' },
  );
  const doc = matter(after[outputs[0]]);
  delete doc.data.analyzed_html;
  assert.throws(
    () =>
      validateHtmlAnalysis(
        raw,
        { ...after, [outputs[0]]: matter.stringify(doc.content, doc.data) },
        outputs,
      ),
    { code: 'GC-MD-003' },
  );
  assert.throws(
    () =>
      assertStageInputs(
        files,
        { ...after, [html]: '<html><body>tamper</body></html>' },
        outputs,
      ),
    { code: 'GC-AI-003' },
  );
});

test('old server capabilities reject HTML import and analysis without transmitting unsupported work', async () => {
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:1',
      projectId: '00000000-0000-0000-0000-000000000000',
      token: 'fixture',
    },
    () => {},
  );
  client.state.connected = true;
  client.state.taskInstructionsEditable = true;
  client.state.taskResultNaming = true;
  try {
    await assert.rejects(
      client.command('files:import-batch', batch),
      /v0.7.10/,
    );
    await assert.rejects(
      client.command('tasks:create', fixture().input),
      /v0.7.10/,
    );
  } finally {
    client.stop();
  }
});

test('real collaboration imports and analyzes one HTML with admin permissions, lease protection and attributed output history', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-shared-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
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
      'HTML',
      project,
    );
    owner = new CollaborationClient(created.credentials, () => {});
    owner.accept(created.result);
    assert.equal(owner.state.htmlImportAnalysis, true);
    const joined = await CollaborationClient.join(
      url,
      created.result.code,
      '편집자',
    );
    editor = new CollaborationClient(joined.credentials, () => {});
    editor.accept(joined.result);
    const imported = await editor.command('files:import-batch', batch);
    const html = imported[0].htmlSource;
    await owner.refresh();
    assert.equal(owner.files[html], game);
    const input = { ...fixture().input, inputPaths: [html] };
    await editor.command('tasks:create', input);
    await owner.refresh();
    const task = await owner.command('tasks:create', input);
    await assert.rejects(
      owner.request('ai-start', {
        taskPath: task.relativePath,
        revision: owner.state.revision,
      }),
      /v0.7.10/,
    );
    const raw = owner.files[task.relativePath];
    await owner.beginAi(task.relativePath);
    const concurrent = await editor.command('files:import-batch', batch);
    assert.equal(concurrent.length, 1);
    const bad = artifacts(raw, 'bad');
    const first = Object.keys(bad)[0],
      parsed = matter(bad[first]);
    delete parsed.data.analyzed_html;
    bad[first] = matter.stringify(parsed.content, parsed.data);
    await assert.rejects(
      owner.request('ai-finish', {
        lease: owner.lease,
        status: 'completed',
        artifacts: bad,
        modelId: 'fixture',
      }),
      /GC-MD-003/,
    );
    assert.equal(owner.files[first], undefined);
    await owner.finishAi('completed', artifacts(raw), 'fixture');
    await editor.refresh();
    assert.equal(editor.files[html], game);
    validateHtmlAnalysis(raw, editor.files, matter(raw).data.expected_outputs);
    const history = await owner.history();
    assert.ok(
      history.some(
        (entry) =>
          entry.label === '파일 불러오기' && entry.actorName === '편집자',
      ),
    );
    assert.ok(
      history.some(
        (entry) =>
          entry.kind === 'ai' &&
          entry.status === 'completed' &&
          entry.actorName === '관리자',
      ),
    );
  } finally {
    owner?.stop();
    editor?.stop();
    await server.close();
  }
});
