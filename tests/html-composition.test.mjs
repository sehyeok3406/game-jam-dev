import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { createTaskFiles, workflowStages } from '../src/task-plan.ts';
import { validateHtmlAnalysis, htmlSourcePath } from '../src/html-source.ts';
import { describeHtmlInput } from '../src/html-inputs.ts';
import { encodeAsset } from '../src/file-assets.ts';
import { embedSelectedAssets } from '../src/ai-asset-links.ts';
import { taskFileLock, isAiFileLocked } from '../src/ai-file-lock.ts';
import { materialize, captureProject } from '../src/project-store.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';

const htmls = ['combat', 'growth', 'shop'].map(
  (name) => `output/systems/${name}/v001/index.html`,
);
const js = 'output/systems/combat/v001/combat.js';
const css = 'output/systems/combat/v001/style.css';
const svg = 'output/systems/combat/v001/art/icon.svg';
const input = {
  kind: 'implement',
  sourceMode: 'html-compose',
  inputPaths: htmls,
  x: 1000,
  y: 120,
  resultName: '통합 게임',
  instructions:
    '전투 골드를 상점에서 사용하고 구매한 공격력을 성장과 전투에 반영해줘.',
};
const fixture = () => ({
  'project.md':
    '---\nid: project\ntitle: game\ntype: overview\nstatus: draft\nsources: []\n---\n# game',
  [htmls[0]]:
    '<html><head><link rel="stylesheet" href="style.css"></head><body><button>combat</button><script src="combat.js"></script></body></html>',
  [htmls[1]]: '<html><body><button>growth</button></body></html>',
  [htmls[2]]: '<html><body><button>shop</button></body></html>',
  [js]: encodeAsset(js, Buffer.from('const gold = 0;')),
  [css]: encodeAsset(
    css,
    Buffer.from('body { background-image:url("./art/icon.svg"); }'),
  ),
  [svg]: encodeAsset(
    svg,
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  ),
});
const taskFixture = (choice = input) => {
  const before = fixture();
  const additions = createTaskFiles(choice, 'compose', before);
  const files = { ...before, ...additions };
  const raw = files['.ai/tasks/compose.md'];
  return { before, additions, files, raw, data: matter(raw).data };
};

test('HTML-only composition carries every original, support file and provenance through local/shared tasks, snapshots and history', async (t) => {
  const { before, additions, files, raw, data } = taskFixture();
  validateHtmlAnalysis(raw, files);
  assert.equal(data.source_mode, 'html-compose');
  assert.equal(data.html_inputs_version, 1);
  assert.equal(
    data.expected_outputs[0],
    'output/prototypes/통합-게임/v001/index.html',
  );
  for (const path of [...htmls, js, css, svg, ...htmls.map(htmlSourcePath)])
    assert.ok(data.inputs.includes(path), path);
  const shared = reduceCollaboration(before, 'tasks:create', input).files;
  const sharedRaw =
    shared[Object.keys(shared).find((path) => path.startsWith('.ai/tasks/'))];
  const sharedData = matter(sharedRaw).data;
  for (const field of [
    'inputs',
    'expected_outputs',
    'html_input_sources',
    'source_mode',
  ])
    assert.deepEqual(sharedData[field], data[field]);
  assert.equal(matter(sharedRaw).content.trim(), matter(raw).content.trim());
  assert.match(raw, /전투 골드를 상점/);
  assert.match(raw, /html_input_sources/);
  const mixed = createTaskFiles(
    { ...input, inputPaths: [...htmls, 'project.md'] },
    'mixed',
    before,
  );
  assert.ok(
    matter(mixed['.ai/tasks/mixed.md']).data.inputs.includes('project.md'),
  );
  const lock = taskFileLock(files, '.ai/tasks/compose.md');
  for (const path of [...htmls, js, css, svg])
    assert.ok(isAiFileLocked(lock, path));
  assert.equal(isAiFileLocked(lock, 'ideas/unrelated.md'), false);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-compose-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await materialize(root, files);
  assert.deepEqual(await captureProject(root), files);
  assert.equal(
    await fs.readFile(path.join(root, js), 'utf8'),
    'const gold = 0;',
  );
  assert.equal(Object.keys(additions).length, 4);
});

test('both workflow stages retain original HTML and support files alongside newly organized documents; omitted stage inputs cannot execute', () => {
  const { files, raw, data } = taskFixture({
    ...input,
    kind: 'organize',
    documentResult: { mode: 'new' },
    thenImplement: {
      instructions: input.instructions,
      htmlResult: { mode: 'new' },
      resultName: input.resultName,
    },
  });
  const stages = workflowStages(raw);
  const second = matter(stages[1]).data;
  assert.ok(
    matter(raw).content.includes(data.html_input_sources[0].sha256),
    'Workflow history retains source fingerprints',
  );
  for (const path of [
    ...htmls,
    js,
    css,
    svg,
    ...htmls.map(htmlSourcePath),
    ...matter(stages[0]).data.expected_outputs,
  ])
    assert.ok(second.inputs.includes(path));
  validateHtmlAnalysis(raw, files);
  const omitted = matter(stages[1]);
  omitted.data.inputs = omitted.data.inputs.filter((path) => path !== js);
  assert.throws(
    () =>
      validateHtmlAnalysis(
        matter.stringify('task', {
          ...data,
          workflow_steps: [
            stages[0],
            matter.stringify(omitted.content, omitted.data),
          ],
        }),
        files,
      ),
    { code: 'GC-AI-007' },
  );
  const docs = Object.fromEntries(
    matter(stages[0]).data.expected_outputs.map((path, index) => [
      path,
      matter.stringify('combined systems', {
        id: `doc-${index}`,
        title: 'systems',
        type: 'system',
        status: 'draft',
        sources: data.html_input_sources.map((source) => source.id),
        analyzed_htmls: data.html_input_sources
          .map(({ id, path, sha256 }) => ({ sha256, path, id }))
          .reverse(),
      }),
    ]),
  );
  validateHtmlAnalysis(raw, { ...files, ...docs }, Object.keys(docs));
  const bad = matter(docs[Object.keys(docs)[0]]);
  bad.data.analyzed_htmls.pop();
  assert.throws(
    () =>
      validateHtmlAnalysis(
        raw,
        {
          ...files,
          ...docs,
          [Object.keys(docs)[0]]: matter.stringify(bad.content, bad.data),
        },
        Object.keys(docs),
      ),
    { code: 'GC-MD-003' },
  );
});

test('composition rejects source overwrite, stale sources/assets and missing nested dependencies before execution', () => {
  const { before, files, raw } = taskFixture();
  for (const path of htmls)
    assert.throws(
      () =>
        createTaskFiles(
          { ...input, htmlResult: { mode: 'update', basePath: path } },
          'bad',
          before,
        ),
      { code: 'GC-AI-007' },
    );
  for (const path of [htmls[0], js, css, svg])
    assert.throws(
      () =>
        validateHtmlAnalysis(raw, {
          ...files,
          [path]: files[path] + 'changed',
        }),
      { code: 'GC-SYNC-001' },
    );
  const missing = { ...before };
  delete missing[svg];
  assert.throws(
    () => createTaskFiles(input, 'missing', missing),
    /관련 파일이 없거나/,
  );
  assert.throws(
    () =>
      createTaskFiles(input, 'escape', {
        ...before,
        [css]: encodeAsset(
          css,
          Buffer.from('@import "../../shop/v001/shop.css";'),
        ),
      }),
    /관련 파일이 없거나/,
  );
  const external = {
    ...before,
    [htmls[2]]:
      '<html><body><img src="https://example.invalid/icon.png"></body></html>',
  };
  assert.match(
    describeHtmlInput(external, htmls[2]).warnings[0],
    /내려받지 않습니다/,
  );
});

test('provider asset placeholders embed selected HTML support images with correct MIME and refuse unrelated assets', () => {
  const { files, raw } = taskFixture();
  const embedded = embedSelectedAssets(
    `<html><body><img src="gamecanvas-asset:${svg}"></body></html>`,
    raw,
    files,
  );
  assert.match(embedded, /data:image\/svg\+xml;base64,/);
  assert.throws(
    () =>
      embedSelectedAssets(
        '<img src="gamecanvas-asset:assets/images/other.png">',
        raw,
        files,
      ),
    { code: 'GC-AI-004' },
  );
  assert.throws(
    () =>
      embedSelectedAssets(
        `<script src="gamecanvas-asset:${js}"></script>`,
        raw,
        files,
      ),
    /내부에 작성/,
  );
  const req = gamejamTaskInput({
    organize: false,
    implement: true,
    sourceMode: 'html',
    inputPaths: [htmls[0]],
    instructions: { organize: '', implement: input.instructions },
    resultName: '',
    x: 0,
    y: 0,
  });
  assert.equal(req.sourceMode, 'html-compose');
});

test('shared composition enforces server/runner support, protects all inputs, publishes a new result and preserves unrelated edits', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-compose-server-'));
  const server = await createCollaborationServer({
    dataDirectory: root,
    creationKey: 'fixture',
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    'fixture',
    'owner',
    'game',
    fixture(),
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'editor',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  t.after(async () => {
    owner.stop();
    editor.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.equal(owner.state.htmlComposition, true);
  owner.state.htmlComposition = false;
  await assert.rejects(owner.command('tasks:create', input), /v0.10.9/);
  owner.state.htmlComposition = true;
  const task = await owner.command('tasks:create', input);
  await assert.rejects(
    owner.request('ai-start', {
      taskPath: task.relativePath,
      providerId: 'codex-cli',
      htmlAnalysisVersion: 1,
      revision: owner.state.revision,
    }),
    /v0.10.9/,
  );
  await owner.beginAi(task.relativePath);
  await editor.refresh();
  for (const path of htmls)
    await assert.rejects(
      editor.command('documents:delete', { relativePath: path }),
      /AI 작업/,
    );
  const note = await editor.command('documents:create-idea', { x: 0, y: 0 });
  await editor.lock(note.relativePath);
  await editor.command('documents:save', {
    relativePath: note.relativePath,
    title: 'parallel',
    body: 'keep my unrelated work',
  });
  await editor.unlock(note.relativePath);
  const data = matter(owner.files[task.relativePath]).data;
  const output = data.expected_outputs[0];
  await owner.finishAi('completed', {
    [output]:
      '<html><body><button>combined combat growth shop</button></body></html>',
  });
  await editor.refresh();
  assert.ok(editor.files[output]);
  assert.match(editor.files[note.relativePath], /keep my unrelated work/);
  for (const path of [...htmls, js, css, svg])
    assert.equal(editor.files[path], fixture()[path]);
  assert.equal(editor.state.aiRun.status, 'completed');
  await editor.command('documents:delete', { relativePath: htmls[2] });
  assert.equal(editor.files[htmls[2]], undefined);
});
