import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { createCollaborationServer } from '../src/collaboration-server';
import { CollaborationClient } from '../src/collaboration-client';
import { isImportedPreviewPath } from '../src/preview-output';
import '../src/main';
import { executionStarts, executionSpecs } from './mocks/process';
import {
  handlers,
  events,
  root,
  importSelections,
  createdWindows,
  revealedPaths,
  safeStorage,
} from './mocks/electron';

async function call(channel: string, ...args: unknown[]) {
  const handler = handlers.get(channel);
  assert.ok(handler, `Missing IPC ${channel}`);
  return handler(
    {
      sender: createdWindows[0]?.webContents,
      senderFrame: createdWindows[0]?.webContents.mainFrame,
    },
    ...args,
  ) as Promise<any>;
}
async function terminal(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const event = events.find(
      (item) =>
        item.runId === id &&
        ['completed', 'failed', 'cancelled'].includes(item.status),
    );
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Run did not finish');
}
const generatedPreviews = async () =>
  (await call('preview:list')).filter(
    (item: any) => !isImportedPreviewPath(item.relativePath),
  );

let collaborationServer: Awaited<
  ReturnType<typeof createCollaborationServer>
> | null = null;
let otherClient: CollaborationClient | null = null;
// Fake subprocess only: never use or modify real Gemini credentials in this test.
const originalGeminiKey = process.env.GEMINI_API_KEY;
process.env.GEMINI_API_KEY = 'fixture-not-a-real-api-key';
try {
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(createdWindows.length, 1);
  const updateState = await call('updates:state');
  assert.equal(updateState.status, 'unavailable');
  assert.equal(updateState.repository, 'sehyeok3406/game-jam-dev');
  assert.equal(updateState.currentVersion, '0.10.1');
  assert.equal((await call('updates:check')).available, false);
  assert.equal((await call('updates:install')).status, 'unavailable');
  assert.equal((await call('updates:automatic', false)).automatic, false);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'updates.json'), 'utf8'))
      .automatic,
    false,
  );
  assert.throws(
    () => handlers.get('updates:check')!({ sender: {}, senderFrame: {} }),
    /GC-UPD-001/,
  );
  assert.throws(
    () =>
      handlers.get('updates:install')!({
        sender: createdWindows[0].webContents,
        senderFrame: {},
      }),
    /GC-UPD-001/,
  );
  console.log(
    'PASS: configured development updater is inert, preferences persist and foreign/preview-frame control is denied',
  );
  if (process.platform !== 'darwin')
    assert.equal(createdWindows[0].nativeMenu, null);
  console.log(
    'PASS: main canvas window removes the native menu before display',
  );
  assert.equal((await call('collaboration:test-users')).isTestUser, false);
  await assert.rejects(
    call('collaboration:launch-test-users', {
      count: 3,
      nicknamePrefix: '테스트',
      role: 'editor',
    }),
    /관리자/,
  );
  assert.equal((await call('workspace:get')).root, null);
  for (const name of ['', '../escape', 'CON', 'trailing.', 'bad:name'])
    await assert.rejects(call('projects:create', name), /프로젝트 이름/);
  const newProject = await call('projects:create', '홈 생성 검증');
  assert.equal(newProject.root, path.join(root, '홈 생성 검증'));
  const newProjectFile = path.join(newProject.root, 'project.md');
  const originalProjectContent = await fs.readFile(newProjectFile, 'utf8');
  await assert.rejects(call('projects:create', '홈 생성 검증'), /이미/);
  assert.equal(
    await fs.readFile(newProjectFile, 'utf8'),
    originalProjectContent,
  );
  await call('projects:home');
  const createdEntry = (await call('projects:list')).find(
    (entry: any) => entry.root === newProject.root,
  );
  assert.equal(createdEntry.kind, 'local');
  assert.ok(Number.isFinite(createdEntry.createdAt));
  assert.ok(Number.isFinite(createdEntry.modifiedAt));
  await call('projects:rename', createdEntry.id, '홈 표시 이름');
  const datedEntry = (await call('projects:list')).find(
    (entry: any) => entry.id === createdEntry.id,
  );
  assert.equal(datedEntry.createdAt, createdEntry.createdAt);
  assert.ok(datedEntry.modifiedAt >= createdEntry.modifiedAt);
  const renamedProject = matter(await fs.readFile(newProjectFile, 'utf8'));
  const originalProject = matter(originalProjectContent);
  assert.equal(renamedProject.data.project_name, '홈 표시 이름');
  assert.equal(renamedProject.data.title, '홈 표시 이름');
  assert.equal(renamedProject.data.id, originalProject.data.id);
  assert.equal(renamedProject.content, originalProject.content);
  await assert.rejects(
    call('projects:rename', createdEntry.id, '덮어쓰기', '지난 이름'),
    /바뀌었습니다/,
  );
  const renamedProjectContent = await fs.readFile(newProjectFile, 'utf8');
  await call('projects:folder-create', '게임 아이디어');
  const homeFolder = (await call('projects:folders'))[0];
  await call('projects:move', createdEntry.id, homeFolder.id);
  assert.equal(
    (await call('projects:list')).find(
      (entry: any) => entry.id === createdEntry.id,
    ).name,
    '홈 표시 이름',
  );
  assert.equal(
    (await call('projects:list')).find(
      (entry: any) => entry.id === createdEntry.id,
    ).folderId,
    homeFolder.id,
  );
  await call('projects:folder-rename', homeFolder.id, '테스트 프로젝트');
  assert.equal((await call('projects:folders'))[0].name, '테스트 프로젝트');
  await call('projects:reveal', createdEntry.id);
  assert.ok(revealedPaths.includes(newProject.root));
  await call('projects:folder-remove', homeFolder.id);
  assert.equal(
    (await call('projects:list')).find(
      (entry: any) => entry.id === createdEntry.id,
    ).folderId,
    undefined,
  );
  assert.equal(
    await fs.readFile(newProjectFile, 'utf8'),
    renamedProjectContent,
  );
  await call('projects:open', createdEntry.id);
  assert.equal((await call('workspace:get')).root, newProject.root);
  assert.equal((await call('workspace:get')).name, '홈 표시 이름');
  const deletedHtml = 'output/games/v1-delete/index.html';
  const retainedHtml = 'output/games/v2-keep/index.html';
  for (const relative of [deletedHtml, retainedHtml]) {
    await fs.mkdir(path.dirname(path.join(newProject.root, relative)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(newProject.root, relative),
      '<!doctype html><html><body>game</body></html>',
    );
  }
  const deletedFolder = path.dirname(path.join(newProject.root, deletedHtml));
  await fs.mkdir(path.join(deletedFolder, 'assets/empty'), { recursive: true });
  await fs.writeFile(path.join(deletedFolder, 'assets/game.js'), 'game()');
  await call(
    'preview:save-window',
    { x: 0, y: 0, width: 720, height: 520, collapsed: false },
    deletedHtml,
  );
  const migratedHtml = 'output/systems/combat/v001/index.html';
  await call('results:move', {
    relativePath: deletedHtml,
    category: 'systems',
    feature: 'combat',
  });
  await assert.rejects(fs.access(deletedFolder));
  assert.equal(
    await fs.readFile(
      path.join(newProject.root, 'output/systems/combat/v001/assets/game.js'),
      'utf8',
    ),
    'game()',
  );
  assert.equal((await call('preview:window', migratedHtml)).width, 720);
  assert.ok(
    (await call('preview:list')).some(
      (item: any) => item.relativePath === migratedHtml,
    ),
  );
  await call('edit:undo');
  assert.equal(
    await fs.readFile(path.join(deletedFolder, 'assets/game.js'), 'utf8'),
    'game()',
  );
  await call('edit:redo');
  await call('edit:undo');
  await call('documents:delete', {
    documentId: deletedHtml,
    relativePath: deletedHtml,
  });
  await assert.rejects(fs.access(deletedFolder));
  assert.equal(
    await fs.readFile(
      path.join(`${deletedFolder}.trashed`, 'assets/game.js'),
      'utf8',
    ),
    'game()',
  );
  assert.equal(await call('preview:window', deletedHtml), null);
  assert.equal((await call('preview:list')).length, 1);
  await call('documents:delete-many', {
    documents: [
      { documentId: 'project', relativePath: 'project.md' },
      { documentId: retainedHtml, relativePath: retainedHtml },
    ],
  });
  assert.equal((await call('documents:list')).length, 0);
  assert.equal((await call('preview:list')).length, 0);
  await call('edit:undo');
  assert.equal((await call('documents:list')).length, 1);
  assert.equal((await call('preview:list')).length, 1);
  await call('edit:redo');
  await call('projects:home');
  await call('projects:rename', createdEntry.id, '기본 문서 없는 프로젝트');
  await call('projects:open', createdEntry.id);
  assert.equal((await call('workspace:get')).name, '기본 문서 없는 프로젝트');
  await assert.rejects(fs.access(newProjectFile));
  console.log(
    'PASS: IPC deletion removes default documents and owned HTML folders/assets/settings; undo, reopen and rename work without recreating project.md',
  );
  assert.equal(
    (await call('projects:list')).find(
      (entry: any) => entry.id === createdEntry.id,
    ).name,
    '기본 문서 없는 프로젝트',
  );
  await call('projects:home');
  console.log(
    'PASS: home startup, safe new project creation and recent local selection preserve existing folders',
  );
  await call('workspace:select');
  const fixtures = path.join(root, 'external-import-fixtures');
  await fs.mkdir(fixtures);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
    'base64',
  );
  const rawMarkdown =
    '---\nid: project\ntitle: 참고 기획서\n---\n\n|체력|공격력|\n|---|---|\n|100|20|';
  await fs.writeFile(path.join(fixtures, 'reference.md'), rawMarkdown);
  await fs.writeFile(path.join(fixtures, 'player.png'), png);
  importSelections.push(
    path.join(fixtures, 'reference.md'),
    path.join(fixtures, 'player.png'),
  );
  const imported = await call('files:import', {
    x: 300,
    y: 200,
    imagePurpose: 'diagram',
  });
  assert.equal(imported.length, 2);
  const importedImage = imported.find((doc: any) => doc.type === 'image');
  assert.equal(
    (await call('files:authorship', importedImage.relativePath)).createdBy.name,
    '로컬 사용자',
  );
  await assert.rejects(call('files:authorship', '../outside.md'), /경로/);
  assert.equal(importedImage.asset.purpose, 'diagram');
  assert.deepEqual(
    await fs.readFile(path.join(root, importedImage.asset.path)),
    png,
  );
  assert.equal(
    await call('assets:read', importedImage.asset.path),
    `data:image/png;base64,${png.toString('base64')}`,
  );
  assert.ok(
    (await call('documents:list')).find(
      (doc: any) => doc.id === importedImage.id,
    ).assetVersion,
  );
  await assert.rejects(call('assets:read', '../external.png'), /이미지 경로/);
  assert.equal(
    await fs.readFile(path.join(fixtures, 'reference.md'), 'utf8'),
    rawMarkdown,
  );
  assert.deepEqual(await fs.readFile(path.join(fixtures, 'player.png')), png);
  assert.equal((await call('edit:state')).undo, '파일 불러오기');
  await call('edit:undo');
  await assert.rejects(fs.access(path.join(root, importedImage.asset.path)));
  await call('edit:redo');
  assert.deepEqual(
    await fs.readFile(path.join(root, importedImage.asset.path)),
    png,
  );
  importSelections.length = 0;
  assert.deepEqual(
    await call('files:import', { x: 300, y: 200, imagePurpose: 'asset' }),
    [],
  );
  console.log(
    'PASS: native import IPC copies Markdown and binary images, preserves originals, renders safe data URIs and supports undo/redo without image corruption',
  );
  const windowState = {
    // Existing preview features must remain compatible with imported games.
    x: 420,
    y: 120,
    width: 800,
    height: 500,
    collapsed: true,
  };
  await call('preview:save-window', windowState);
  assert.deepEqual(await call('preview:window'), windowState);
  console.log(
    'PASS: preview position, size and collapse state persist to disk',
  );
  const externalHtml =
    '\uFEFF<!doctype html><html><head><title>Imported game</title></head><body><canvas></canvas><button>Play</button><script>let score=0;</script></body></html>';
  await fs.writeFile(path.join(fixtures, 'imported-game.htm'), externalHtml);
  importSelections.push(path.join(fixtures, 'imported-game.htm'));
  const htmlImports = await call('files:import', {
    x: 600,
    y: 700,
    imagePurpose: 'asset',
  });
  const importedHtmlPath = htmlImports[0].htmlSource;
  assert.ok(isImportedPreviewPath(importedHtmlPath));
  assert.equal(
    (await call('preview:list')).find(
      (item: any) => item.relativePath === importedHtmlPath,
    ).title,
    'imported-game',
  );
  assert.equal(
    (await call('preview:read', importedHtmlPath)).content,
    externalHtml,
  );
  assert.equal(
    (await call('files:authorship', importedHtmlPath)).createdBy.name,
    '로컬 사용자',
  );
  await call('edit:undo');
  await assert.rejects(fs.access(path.join(root, importedHtmlPath)));
  await call('edit:redo');
  assert.equal(
    (await call('preview:read', importedHtmlPath)).content,
    externalHtml,
  );
  await call('preview:save-window', windowState, importedHtmlPath);
  assert.deepEqual(await call('preview:window', importedHtmlPath), windowState);
  importSelections.length = 0;
  const analysisInput = {
    kind: 'organize',
    sourceMode: 'html',
    inputPaths: [importedHtmlPath],
    x: 1500,
    y: 700,
    documentResult: { mode: 'new' },
    resultName: '불러온 게임',
  };
  for (const [modelId, expectedStatus, errorCode] of [
    ['fixture-html-analysis-valid', 'completed', null],
    ['fixture-html-analysis-missing-source', 'failed', 'GC-MD-003'],
    ['fixture-html-analysis-tamper', 'failed', 'GC-AI-003'],
    ['fixture-html-analysis-cancel', 'cancelled', null],
  ]) {
    const task = await call('tasks:create', analysisInput);
    const spec = matter(
      await fs.readFile(path.join(root, task.relativePath), 'utf8'),
    ).data;
    assert.equal(spec.html_analysis_source.id, htmlImports[0].id);
    const run = await call('codex:start', {
      taskPath: task.relativePath,
      providerId: 'codex-cli',
      modelId,
    });
    assert.deepEqual(
      await call('files:import', { x: 0, y: 0, imagePurpose: 'asset' }),
      [],
    );
    if (expectedStatus === 'cancelled') await call('codex:cancel', run.runId);
    const end = await terminal(run.runId);
    assert.equal(end.status, expectedStatus, end.message);
    if (errorCode) assert.ok(end.message.includes(errorCode), end.message);
    for (const relative of spec.expected_outputs) {
      if (expectedStatus === 'completed') {
        const doc = matter(
          await fs.readFile(path.join(root, relative), 'utf8'),
        ).data;
        assert.deepEqual(doc.analyzed_html, spec.html_analysis_source);
        assert.ok(doc.sources.some((ref: any) => ref.id === htmlImports[0].id));
      } else await assert.rejects(fs.access(path.join(root, relative)));
    }
    assert.equal(
      await fs.readFile(path.join(root, importedHtmlPath), 'utf8'),
      externalHtml,
    );
  }
  assert.equal(
    await fs.readFile(path.join(fixtures, 'imported-game.htm'), 'utf8'),
    externalHtml,
  );
  console.log(
    'PASS: native HTML import copies originals, preserves window state/history, analyzes into sourced Markdown, and blocks missing provenance, input mutation and cancellation publication',
  );
  await call('preview:save-window', {
    ...windowState,
    presetId: 'mobile-320',
    freeSize: { width: 800, height: 500 },
  });
  const mobileWindow = await call('preview:window');
  assert.equal(mobileWindow.width, 322);
  assert.equal(mobileWindow.height, 608);
  assert.equal(mobileWindow.presetId, 'mobile-320');
  assert.deepEqual(mobileWindow.freeSize, { width: 800, height: 500 });
  console.log(
    'PASS: fixed mobile viewport is enforced and persisted without desktop minimum clamping',
  );
  const idea = await call('documents:create-idea', { x: 80, y: 90 });
  const originalIdea = await fs.readFile(
    path.join(root, idea.relativePath),
    'utf8',
  );
  await call('documents:save', {
    relativePath: idea.relativePath,
    title: '저장 후',
    body: 'undo 검증',
  });
  assert.equal((await call('edit:state')).undo, '문서 저장');
  await call('edit:undo');
  assert.equal(
    await fs.readFile(path.join(root, idea.relativePath), 'utf8'),
    originalIdea,
  );
  await call('edit:redo');
  assert.ok(
    (await fs.readFile(path.join(root, idea.relativePath), 'utf8')).includes(
      'undo 검증',
    ),
  );
  const disposable = await call('documents:create-idea', { x: 200, y: 90 });
  const section = await call('sections:create', {
    title: '테스트',
    members: [{ id: disposable.id, path: disposable.relativePath }],
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
  await call('sections:rename', {
    relativePath: section.relativePath,
    title: '이름 변경',
  });
  assert.equal(
    matter(await fs.readFile(path.join(root, section.relativePath), 'utf8'))
      .data.title,
    '이름 변경',
  );
  await call('documents:delete-many', {
    documents: [
      { documentId: disposable.id, relativePath: disposable.relativePath },
    ],
  });
  await assert.rejects(fs.access(path.join(root, disposable.relativePath)));
  await call('edit:undo');
  assert.equal(
    matter(await fs.readFile(path.join(root, section.relativePath), 'utf8'))
      .data.members.length,
    1,
  );
  await fs.access(path.join(root, disposable.relativePath));
  console.log(
    'PASS: desktop undo/redo, section rename and atomic batch-delete recovery preserve real Markdown files',
  );
  // Existing flat results must remain updateable in place after the upgrade.
  await fs.mkdir(path.join(root, 'output'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'output/index.html'),
    '<html><body>Legacy game</body></html>',
  );
  const task = await call('tasks:create', {
    kind: 'implement',
    inputPaths: [idea.relativePath],
    x: 500,
    y: 80,
    instructions:
      '모바일 세로 화면으로 구현하고 전투는 제외한다. HTML-INSTRUCTION-IPC-PROBE',
  });
  assert.ok(
    (await fs.readFile(path.join(root, task.relativePath), 'utf8')).includes(
      'HTML-INSTRUCTION-IPC-PROBE',
    ),
  );
  const run = await call('codex:start', {
    taskPath: task.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-concurrent',
  });
  await assert.rejects(
    call('documents:save', {
      relativePath: idea.relativePath,
      title: 'blocked',
      body: 'blocked',
    }),
    /AI 작업에 사용 중인 파일/,
  );
  const concurrent = await call('documents:create-idea', { x: 0, y: 0 });
  importSelections.push(path.join(fixtures, 'reference.md'));
  const concurrentImport = await call('files:import', {
    x: 900,
    y: 600,
    imagePurpose: 'asset',
  });
  assert.equal(concurrentImport.length, 1);
  await call('documents:save', {
    relativePath: concurrent.relativePath,
    title: '동시 편집',
    body: 'AI와 무관한 새 메모',
  });
  await call('documents:update-layout', {
    relativePath: concurrent.relativePath,
    x: 50,
    y: 80,
    width: 340,
    height: 300,
  });
  const removed = await call('documents:create-idea', { x: 0, y: 0 });
  await call('documents:delete', {
    documentId: removed.id,
    relativePath: removed.relativePath,
  });
  await assert.rejects(
    call('documents:delete', {
      documentId: idea.id,
      relativePath: idea.relativePath,
    }),
    /AI 작업에 사용 중인 파일/,
  );
  await assert.rejects(
    call('documents:update-layout', {
      relativePath: idea.relativePath,
      x: 20,
      y: 40,
      width: 340,
      height: 300,
    }),
    /AI 작업에 사용 중인 파일/,
  );
  await assert.rejects(
    call(
      'preview:save-window',
      { x: 10, y: 10, width: 720, height: 520, collapsed: false },
      'output/index.html',
    ),
    /AI 작업에 사용 중인 파일/,
  );
  assert.ok(
    await call('codex:active'),
    'Concurrent mutations must happen while AI is still running',
  );
  assert.equal((await terminal(run.runId)).status, 'completed');
  const html = await fs.readFile(path.join(root, 'output/index.html'), 'utf8');
  assert.ok(html.includes('fixture-concurrent'));
  assert.match(
    await fs.readFile(path.join(root, concurrent.relativePath), 'utf8'),
    /AI와 무관한 새 메모/,
  );
  await assert.rejects(fs.access(path.join(root, removed.relativePath)));
  assert.ok(
    events.some(
      (event) => event.runId === run.runId && event.status === 'validating',
    ),
  );
  console.log(
    'PASS: AI protects its inputs/output/window while unrelated notes can be created, edited, moved and deleted without blocking publication',
  );

  const stopped = await call('codex:start', {
    taskPath: task.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-stop',
  });
  await call('codex:cancel', stopped.runId);
  assert.equal((await terminal(stopped.runId)).status, 'cancelled');
  assert.equal(
    await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
    html,
  );
  console.log('PASS: stopping preserves the last valid HTML');

  const empty = await call('codex:start', {
    taskPath: task.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-empty',
  });
  assert.equal((await terminal(empty.runId)).status, 'failed');
  assert.equal(
    await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
    html,
  );
  console.log('PASS: exit code zero without updated output is rejected');

  const external = await call('codex:start', {
    taskPath: task.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-external',
  });
  await fs.appendFile(
    path.join(root, idea.relativePath),
    '\nexternal modification\n',
  );
  assert.equal((await terminal(external.runId)).status, 'failed');
  assert.equal(
    await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
    html,
  );
  assert.ok(
    (await fs.readFile(path.join(root, idea.relativePath), 'utf8')).includes(
      'external modification',
    ),
  );
  assert.equal(await call('codex:active'), null);
  console.log(
    'PASS: external input changes block publication without being overwritten',
  );

  await call('documents:save', {
    relativePath: idea.relativePath,
    title: 'after run',
    body: 'editable again',
  });
  const history = await call('history:list');
  assert.ok(
    history.some(
      (entry: any) => entry.kind === 'ai' && entry.status === 'completed',
    ),
  );
  assert.ok(history.some((entry: any) => entry.status === 'cancelled'));
  assert.ok(history.some((entry: any) => entry.status === 'failed'));
  const saved = history.find((entry: any) => entry.label === '문서 저장');
  await call('history:restore', saved.id, idea.relativePath, 'before');
  assert.ok(
    (await fs.readFile(path.join(root, idea.relativePath), 'utf8')).includes(
      'external modification',
    ),
  );
  console.log(
    'PASS: lock is released and histories restore real Markdown files',
  );

  const versionTask = await call('tasks:create', {
    kind: 'implement',
    inputPaths: [idea.relativePath],
    x: 900,
    y: 80,
    htmlResult: { mode: 'new', basePath: 'output/index.html' },
  });
  const versionSpec = matter(
    await fs.readFile(path.join(root, versionTask.relativePath), 'utf8'),
  ).data;
  const versionPath = versionSpec.expected_outputs[0];
  assert.equal(versionPath, 'output/inbox/untitled/v001/index.html');
  assert.equal(versionSpec.base_html, 'output/index.html');
  assert.equal(versionSpec.html_output_mode, 'new');
  assert.equal((await generatedPreviews()).length, 1);
  const versionRun = await call('codex:start', {
    taskPath: versionTask.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-version-new',
  });
  assert.equal((await terminal(versionRun.runId)).status, 'completed');
  assert.equal(
    await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
    html,
  );
  const versionHtml = await fs.readFile(path.join(root, versionPath), 'utf8');
  assert.ok(versionHtml.includes('fixture-version-new'));
  assert.deepEqual(
    await fs.readdir(path.dirname(path.join(root, versionPath))),
    ['index.html'],
  );
  await call('path:reveal', versionPath);
  assert.equal(revealedPaths.at(-1), path.join(root, versionPath));
  await assert.rejects(call('path:reveal', '../outside.html'), /프로젝트.*밖/);
  await assert.rejects(
    call('path:reveal', 'output/games/v999/index.html'),
    /ENOENT/,
  );
  assert.equal(revealedPaths.at(-1), path.join(root, versionPath));
  assert.deepEqual(
    (await generatedPreviews()).map((item: any) => item.relativePath).sort(),
    ['output/index.html', versionPath].sort(),
  );
  await call(
    'preview:save-window',
    { ...windowState, x: 1500, collapsed: false },
    versionPath,
  );
  assert.equal((await call('preview:window', versionPath)).x, 1500);
  assert.equal((await call('preview:window')).x, mobileWindow.x);
  assert.equal((await call('preview:read', versionPath)).content, versionHtml);
  await assert.rejects(
    call('codex:start', {
      taskPath: versionTask.relativePath,
      providerId: 'codex-cli',
      modelId: 'fixture-version-new',
    }),
    /이미 생성된 새 버전/,
  );
  assert.equal(
    await fs.readFile(path.join(root, versionPath), 'utf8'),
    versionHtml,
  );
  console.log(
    'PASS: new versions publish a separate file, preserve old HTML and own independent window state',
  );

  const updateTask = await call('tasks:create', {
    kind: 'implement',
    inputPaths: [idea.relativePath],
    x: 900,
    y: 400,
    htmlResult: { mode: 'update', basePath: versionPath },
  });
  assert.equal(
    matter(await fs.readFile(path.join(root, updateTask.relativePath), 'utf8'))
      .data.expected_outputs[0],
    versionPath,
  );
  const updateRun = await call('codex:start', {
    taskPath: updateTask.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-version-update',
  });
  assert.equal((await terminal(updateRun.runId)).status, 'completed');
  assert.ok(
    (await fs.readFile(path.join(root, versionPath), 'utf8')).includes(
      'fixture-version-update',
    ),
  );
  assert.equal(
    await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
    html,
  );
  assert.equal((await generatedPreviews()).length, 2);
  const versionHistory = (await call('history:list')).find(
    (entry: any) =>
      entry.taskPath === updateTask.relativePath &&
      entry.kind === 'ai' &&
      entry.status === 'completed',
  );
  await call('history:restore', versionHistory.id, versionPath, 'before');
  assert.equal(
    await fs.readFile(path.join(root, versionPath), 'utf8'),
    versionHtml,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
    html,
  );
  console.log(
    'PASS: updating and restoring a selected version never changes other result files',
  );

  const createVersion = () =>
    call('tasks:create', {
      kind: 'implement',
      inputPaths: [idea.relativePath],
      x: 900,
      y: 700,
      htmlResult: { mode: 'new', basePath: versionPath },
    });
  for (const modelId of [
    'fixture-invalid',
    'fixture-cross-version',
    'fixture-stop',
  ]) {
    const nextTask = await createVersion();
    const nextPath = matter(
      await fs.readFile(path.join(root, nextTask.relativePath), 'utf8'),
    ).data.expected_outputs[0];
    const nextRun = await call('codex:start', {
      taskPath: nextTask.relativePath,
      providerId: 'codex-cli',
      modelId,
    });
    if (modelId === 'fixture-stop') await call('codex:cancel', nextRun.runId);
    assert.equal(
      (await terminal(nextRun.runId)).status,
      modelId === 'fixture-stop' ? 'cancelled' : 'failed',
    );
    assert.equal((await call('preview:read', nextPath)).exists, false);
    assert.equal((await generatedPreviews()).length, 2);
    assert.equal(
      await fs.readFile(path.join(root, 'output/index.html'), 'utf8'),
      html,
    );
    assert.equal(
      await fs.readFile(path.join(root, versionPath), 'utf8'),
      versionHtml,
    );
  }
  const [reservationA, reservationB] = await Promise.all([
    createVersion(),
    createVersion(),
  ]);
  const pathA = matter(
    await fs.readFile(path.join(root, reservationA.relativePath), 'utf8'),
  ).data.expected_outputs[0];
  const pathB = matter(
    await fs.readFile(path.join(root, reservationB.relativePath), 'utf8'),
  ).data.expected_outputs[0];
  assert.notEqual(pathA, pathB);
  await assert.rejects(
    call('preview:read', '../outside.html'),
    /HTML 결과 경로/,
  );
  await assert.rejects(
    call('preview:save-window', windowState, '../outside.html'),
    /HTML 결과 경로/,
  );
  await assert.rejects(
    call('tasks:create', {
      kind: 'implement',
      inputPaths: [idea.relativePath],
      x: 0,
      y: 0,
      htmlResult: { mode: 'update', basePath: '../outside.html' },
    }),
    /기준 HTML/,
  );
  console.log(
    'PASS: failed, stopped and cross-version writes publish nothing; reservations and paths stay safe',
  );
  const freshIdeas = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      call('documents:create-idea', { x: index * 400, y: 1200 }),
    ),
  );
  const organizeInput = {
    kind: 'organize',
    inputPaths: freshIdeas.map((doc) => doc.relativePath),
    x: 2200,
    y: 1200,
    documentResult: { mode: 'new' },
    resultName: '실험 카페',
    instructions:
      '새 설정을 추가하지 말고 질문을 분리한다. MD-INSTRUCTION-IPC-PROBE',
  };
  const organized = await call('tasks:create', organizeInput);
  const docSpec = matter(
    await fs.readFile(path.join(root, organized.relativePath), 'utf8'),
  ).data;
  assert.ok(
    (
      await fs.readFile(path.join(root, organized.relativePath), 'utf8')
    ).includes('MD-INSTRUCTION-IPC-PROBE'),
  );
  assert.equal(docSpec.expected_outputs.length, 3);
  assert.equal(docSpec.result_name, '실험 카페');
  assert.ok(
    docSpec.expected_outputs.every((relative: string) =>
      relative.includes('/실험-카페-'),
    ),
  );
  const organizedRun = await call('codex:start', {
    taskPath: organized.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-doc-new',
  });
  assert.equal((await terminal(organizedRun.runId)).status, 'completed');
  const firstDocs = await Promise.all(
    docSpec.expected_outputs.map((relative: string) =>
      fs.readFile(path.join(root, relative), 'utf8'),
    ),
  );
  assert.equal(matter(firstDocs[0]).data.sources.length, 5);
  const documentLayouts = firstDocs.map((raw: string) => matter(raw).data);
  for (let index = 1; index < documentLayouts.length; index++) {
    assert.equal(documentLayouts[index].x, documentLayouts[0].x);
    assert.ok(
      documentLayouts[index].y >=
        documentLayouts[index - 1].y + documentLayouts[index - 1].height + 40,
    );
  }
  const implemented = await call('tasks:create', {
    kind: 'implement',
    inputPaths: docSpec.expected_outputs,
    resultName: '한밤의 카페',
    x: 3000,
    y: 1200,
    htmlResult: { mode: 'new' },
  });
  const htmlSpec = matter(
    await fs.readFile(path.join(root, implemented.relativePath), 'utf8'),
  ).data;
  assert.equal(htmlSpec.base_html, null);
  const implicitRun = await call('codex:start', {
    taskPath: implemented.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-implicit-body',
  });
  assert.equal((await terminal(implicitRun.runId)).status, 'completed');
  assert.ok(
    !(
      await fs.readFile(path.join(root, htmlSpec.expected_outputs[0]), 'utf8')
    ).includes('<body'),
  );
  const nextDocs = await call('tasks:create', organizeInput);
  const nextDocSpec = matter(
    await fs.readFile(path.join(root, nextDocs.relativePath), 'utf8'),
  ).data;
  assert.notDeepEqual(nextDocSpec.expected_outputs, docSpec.expected_outputs);
  const nextDocRun = await call('codex:start', {
    taskPath: nextDocs.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-doc-next',
  });
  assert.equal((await terminal(nextDocRun.runId)).status, 'completed');
  assert.deepEqual(
    await Promise.all(
      docSpec.expected_outputs.map((relative: string) =>
        fs.readFile(path.join(root, relative), 'utf8'),
      ),
    ),
    firstDocs,
  );
  const baseDir = nextDocSpec.expected_outputs[0].slice(
    0,
    nextDocSpec.expected_outputs[0].lastIndexOf('/'),
  );
  const previousId = matter(
    await fs.readFile(path.join(root, nextDocSpec.expected_outputs[0]), 'utf8'),
  ).data.id;
  const updateDocs = await call('tasks:create', {
    ...organizeInput,
    documentResult: { mode: 'update', baseDir },
  });
  const updateDocsRun = await call('codex:start', {
    taskPath: updateDocs.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-doc-update',
  });
  assert.equal((await terminal(updateDocsRun.runId)).status, 'completed');
  assert.equal(
    matter(
      await fs.readFile(
        path.join(root, nextDocSpec.expected_outputs[0]),
        'utf8',
      ),
    ).data.id,
    previousId,
  );
  assert.deepEqual(
    await Promise.all(
      docSpec.expected_outputs.map((relative: string) =>
        fs.readFile(path.join(root, relative), 'utf8'),
      ),
    ),
    firstDocs,
  );
  await assert.rejects(
    call('tasks:create', {
      ...organizeInput,
      inputPaths: nextDocSpec.expected_outputs,
      documentResult: { mode: 'update', baseDir },
    }),
    /GC-AI-004/,
  );
  const invalidTask = await createVersion();
  const invalidRun = await call('codex:start', {
    taskPath: invalidTask.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-invalid',
  });
  const invalidEvent = (await terminal(invalidRun.runId)) as any;
  assert.equal(invalidEvent.failure.code, 'GC-HTML-001');
  const diagnostic = JSON.parse(
    await fs.readFile(
      path.join(root, invalidEvent.failure.diagnosticPath),
      'utf8',
    ),
  );
  assert.equal(diagnostic.phase, 'artifact-validation');
  assert.equal(diagnostic.runId, invalidRun.runId);
  assert.equal(diagnostic.failure.code, 'GC-HTML-001');
  assert.equal(diagnostic.outputs[0].sha256.length, 64);
  const failedHistory = (await call('history:list')).find(
    (entry: any) => entry.id === invalidRun.runId,
  );
  assert.equal(failedHistory.failure.code, 'GC-HTML-001');
  console.log(
    'PASS: five fresh ideas organize into versioned Markdown and implement implicit-body HTML; selective updates preserve IDs and other games; failures persist structured diagnostics',
  );
  const workflowInput = {
    kind: 'organize',
    inputPaths: [idea.relativePath, importedImage.relativePath],
    x: 900,
    y: 100,
    documentResult: { mode: 'new' },
    resultName: 'gamejam 테스트',
    thenImplement: {
      htmlResult: { mode: 'new', basePath: 'output/index.html' },
      resultName: 'gamejam 테스트',
    },
  };
  const workflow = await call('tasks:create', workflowInput);
  const workflowRaw = await fs.readFile(
    path.join(root, workflow.relativePath),
    'utf8',
  );
  const workflowData = matter(workflowRaw).data;
  assert.equal(workflowData.expected_outputs.length, 4);
  const workflowRun = await call('codex:start', {
    taskPath: workflow.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-gamejam-valid',
  });
  const duringWorkflow = await call('documents:create-idea', { x: 0, y: 0 });
  const waitForStep2 = async (runId: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        events.some(
          (item) => item.runId === runId && item.message.includes('2/2'),
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('HTML stage did not start');
  };
  await waitForStep2(workflowRun.runId);
  for (const relative of workflowData.expected_outputs)
    await assert.rejects(fs.access(path.join(root, relative)));
  const duringImplementation = await call('documents:create-idea', {
    x: 0,
    y: 0,
  });
  const workflowCompleted = await terminal(workflowRun.runId);
  assert.ok(
    await fs.readFile(
      path.join(root, duringImplementation.relativePath),
      'utf8',
    ),
  );
  assert.ok(
    await fs.readFile(path.join(root, duringWorkflow.relativePath), 'utf8'),
  );
  assert.equal(
    workflowCompleted.status,
    'completed',
    workflowCompleted.message,
  );
  for (const relative of workflowData.expected_outputs)
    assert.ok((await fs.readFile(path.join(root, relative), 'utf8')).trim());
  const specs = executionSpecs.filter(
    (item) => item.model === 'fixture-gamejam-valid',
  );
  assert.equal(specs.length, 2);
  assert.deepEqual(specs[1].inputs, [
    ...workflowData.expected_outputs.slice(0, 3),
    importedImage.relativePath,
  ]);
  assert.ok(
    events.filter(
      (item) => item.runId === workflowRun.runId && item.status === 'completed',
    ).length === 1,
  );
  // One new group may update while the other creates a new version.
  const mixedWorkflow = await call('tasks:create', {
    ...workflowInput,
    documentResult: {
      mode: 'update',
      baseDir: workflowData.expected_outputs[0]
        .split('/')
        .slice(0, -1)
        .join('/'),
    },
  });
  const mixedRun = await call('codex:start', {
    taskPath: mixedWorkflow.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-gamejam-valid-update',
  });
  const mixedCompleted = await terminal(mixedRun.runId);
  assert.equal(mixedCompleted.status, 'completed', mixedCompleted.message);
  const workflowHistory = (await call('history:list')).find(
    (entry: { id: string }) => entry.id === mixedRun.runId,
  );
  assert.equal(workflowHistory.aiTask.origin, 'snapshot');
  assert.equal(workflowHistory.modelId, 'fixture-gamejam-valid-update');
  assert.equal(workflowHistory.aiTask.outputs.length, 4);
  assert.match(workflowHistory.aiTask.specification, /HTML 구현/);
  for (const [model, errorCode] of [
    ['fixture-gamejam-organize-invalid', 'GC-AI-006'],
    ['fixture-gamejam-html-invalid', 'GC-HTML-001'],
    ['fixture-gamejam-tamper-doc', 'GC-AI-003'],
  ]) {
    const task = await call('tasks:create', workflowInput);
    const expected = matter(
      await fs.readFile(path.join(root, task.relativePath), 'utf8'),
    ).data.expected_outputs;
    const startsBefore = executionStarts.filter(
      (item) => item.model === model,
    ).length;
    const run = await call('codex:start', {
      taskPath: task.relativePath,
      providerId: 'codex-cli',
      modelId: model,
    });
    const failed = await terminal(run.runId);
    assert.equal(failed.status, 'failed', failed.message);
    assert.equal(failed.failure?.code, errorCode);
    const failedRecord = (await call('history:list')).find(
      (entry: { id: string }) => entry.id === run.runId,
    );
    assert.equal(failedRecord.aiTask.origin, 'snapshot');
    assert.equal(failedRecord.aiTask.outputs.length, 4);
    assert.equal(failedRecord.modelId, model);
    assert.equal(
      executionStarts.filter((item) => item.model === model).length -
        startsBefore,
      model === 'fixture-gamejam-organize-invalid' ? 1 : 2,
    );
    for (const relative of expected)
      await assert.rejects(fs.access(path.join(root, relative)));
    const diagnostic = JSON.parse(
      await fs.readFile(
        path.join(root, `.history/${run.runId}/diagnostic.json`),
        'utf8',
      ),
    );
    assert.equal(
      diagnostic.workflowStage,
      model === 'fixture-gamejam-organize-invalid' ? 'organize' : 'implement',
    );
  }
  for (const cancelAt of ['organize', 'implement']) {
    const task = await call('tasks:create', workflowInput);
    const expected = matter(
      await fs.readFile(path.join(root, task.relativePath), 'utf8'),
    ).data.expected_outputs;
    const run = await call('codex:start', {
      taskPath: task.relativePath,
      providerId: 'codex-cli',
      modelId: 'fixture-gamejam-cancel',
    });
    if (cancelAt === 'implement') await waitForStep2(run.runId);
    await call('codex:cancel', run.runId);
    assert.equal((await terminal(run.runId)).status, 'cancelled');
    for (const relative of expected)
      await assert.rejects(fs.access(path.join(root, relative)));
  }
  console.log(
    'PASS: gamejam runs two isolated CLI stages in order, uses fresh documents/images, keeps the lock, publishes atomically, handles mixed modes, and stops on either stage failure/cancellation',
  );
  const reverseWorkflowTask = await call('tasks:create', {
    ...analysisInput,
    thenImplement: { htmlResult: { mode: 'new', basePath: importedHtmlPath } },
  });
  const reverseWorkflowSpec = matter(
    await fs.readFile(
      path.join(root, reverseWorkflowTask.relativePath),
      'utf8',
    ),
  ).data;
  const reverseRun = await call('codex:start', {
    taskPath: reverseWorkflowTask.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-gamejam-html-source',
  });
  const reverseEnd = await terminal(reverseRun.runId);
  assert.equal(reverseEnd.status, 'completed', reverseEnd.message);
  assert.equal(
    executionStarts.filter(
      (item) => item.model === 'fixture-gamejam-html-source',
    ).length,
    2,
  );
  for (const relative of reverseWorkflowSpec.expected_outputs.filter(
    (file: string) => file.endsWith('.md'),
  ))
    assert.deepEqual(
      matter(await fs.readFile(path.join(root, relative), 'utf8')).data
        .analyzed_html,
      reverseWorkflowSpec.html_analysis_source,
    );
  assert.equal(
    await fs.readFile(path.join(root, importedHtmlPath), 'utf8'),
    externalHtml,
  );
  console.log(
    'PASS: imported HTML is analyzed before a second CLI implements fresh documents; provenance and original HTML survive atomic publication',
  );
  const components = ['combat', 'growth', 'shop'].map(
    (name) => `output/systems/compose-${name}/v001/index.html`,
  );
  const componentJs = 'output/systems/compose-combat/v001/combat.js';
  for (const [index, relative] of components.entries()) {
    await fs.mkdir(path.dirname(path.join(root, relative)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, relative),
      `<html><body><button>${index}</button>${index === 0 ? '<script src="combat.js"></script>' : ''}</body></html>`,
    );
  }
  await fs.writeFile(path.join(root, componentJs), 'const gold = 0;');
  for (const workflow of [false, true]) {
    const composeTask = await call('tasks:create', {
      kind: workflow ? 'organize' : 'implement',
      sourceMode: 'html-compose',
      inputPaths: components,
      x: 1300,
      y: 800,
      resultName: '시스템 통합',
      instructions: workflow
        ? undefined
        : 'INSTRUCTION-IPC-PROBE 전투 보상을 상점·성장에 연결한다.',
      ...(workflow
        ? {
            documentResult: { mode: 'new' },
            thenImplement: {
              htmlResult: { mode: 'new' },
              instructions:
                'INSTRUCTION-IPC-PROBE 전투 보상을 상점·성장에 연결한다.',
              resultName: '시스템 통합',
            },
          }
        : {}),
    });
    const spec = matter(
      await fs.readFile(path.join(root, composeTask.relativePath), 'utf8'),
    ).data;
    const run = await call('codex:start', {
      taskPath: composeTask.relativePath,
      providerId: workflow ? 'claude-cli' : 'codex-cli',
      modelId: workflow
        ? 'fixture-gamejam-html-compose'
        : 'fixture-html-compose',
    });
    const end = await terminal(run.runId);
    assert.equal(end.status, 'completed', end.message);
    for (const output of spec.expected_outputs)
      await fs.access(path.join(root, output));
    const executions = executionSpecs.filter(
      (item) =>
        item.model ===
        (workflow ? 'fixture-gamejam-html-compose' : 'fixture-html-compose'),
    );
    assert.equal(executions.length, workflow ? 2 : 1);
    const implementation = executions.at(-1)!;
    for (const path of [...components, componentJs])
      assert.ok(implementation.inputs.includes(path));
    assert.match(spec.expected_outputs.at(-1), /^output\/prototypes\//);
  }
  assert.equal(
    await fs.readFile(path.join(root, componentJs), 'utf8'),
    'const gold = 0;',
  );
  console.log(
    'PASS: desktop HTML-only composition and Claude two-stage composition receive all three originals/support files, preserve sources and publish prototype versions',
  );
  collaborationServer = await createCollaborationServer({
    dataDirectory: path.join(root, 'test-server'),
    port: 0,
    creationKey: 'test-key',
  });
  const serverUrl = `http://127.0.0.1:${collaborationServer.port}`;
  const shared = await call('collaboration:create', {
    serverUrl,
    serverKey: 'test-key',
    nickname: '앱 관리자',
  });
  safeStorage.isEncryptionAvailable = () => false;
  await assert.rejects(
    call('collaboration:launch-test-users', {
      count: 3,
      nicknamePrefix: '테스트',
      role: 'editor',
    }),
    /안전한 세션 저장/,
  );
  safeStorage.isEncryptionAvailable = () => true;
  const joined = await CollaborationClient.join(
    serverUrl,
    shared.inviteCode,
    '다른 사용자',
  );
  otherClient = new CollaborationClient(joined.credentials, () => {});
  otherClient.accept(joined.result);
  await otherClient.lock(idea.relativePath);
  await assert.rejects(
    call('collaboration:lock', idea.relativePath),
    /편집 중/,
  );
  await otherClient.command('documents:save', {
    relativePath: idea.relativePath,
    title: '공동 편집 메모',
    body: '다른 PC 세션의 수정',
  });
  await otherClient.unlock(idea.relativePath);
  for (let i = 0; i < 60; i++) {
    if (
      (await call('documents:list')).some((doc: { body: string }) =>
        doc.body.includes('다른 PC 세션'),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(
    (await call('documents:list')).some((doc: { body: string }) =>
      doc.body.includes('다른 PC 세션'),
    ),
  );
  const ownSharedIdea = await call('documents:create-idea', { x: 100, y: 200 });
  assert.equal(
    (await call('files:authorship', ownSharedIdea.relativePath)).createdBy.name,
    '앱 관리자',
  );
  await call('edit:undo');
  assert.ok(
    !(await call('documents:list')).some(
      (doc: { id: string }) => doc.id === ownSharedIdea.id,
    ),
  );
  assert.ok(
    (await call('documents:list')).some((doc: { body: string }) =>
      doc.body.includes('다른 PC 세션'),
    ),
  );
  await call('edit:redo');
  assert.ok(
    (await call('documents:list')).some(
      (doc: { id: string }) => doc.id === ownSharedIdea.id,
    ),
  );
  console.log(
    'PASS: desktop shared undo/redo reverses only its own edits and preserves another member’s content',
  );
  const sharedTask = await call('tasks:create', {
    kind: 'implement',
    inputPaths: [idea.relativePath],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new', basePath: 'output/index.html' },
    instructions: '농사 루프만 구현해줘. SHARED-INSTRUCTION-IPC-PROBE',
  });
  assert.ok(sharedTask.body.includes('SHARED-INSTRUCTION-IPC-PROBE'));
  const sharedRun = await call('codex:start', {
    taskPath: sharedTask.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-valid',
  });
  await otherClient.refresh();
  assert.ok(
    ['starting', 'running', 'validating'].includes(
      otherClient.state.aiRun!.status,
    ),
  );
  const concurrentSharedIdea = await otherClient.command(
    'documents:create-idea',
    { x: 0, y: 0 },
  );
  const completedShared = await terminal(sharedRun.runId);
  assert.equal(completedShared.status, 'completed', completedShared.message);
  await otherClient.refresh();
  const outputPath = matter(otherClient.files[sharedTask.relativePath]).data
    .expected_outputs[0];
  assert.ok(otherClient.files[outputPath].includes('<html'));
  assert.ok(otherClient.files[concurrentSharedIdea.relativePath]);
  const sharedWorkspace = (await call('workspace:get')).root;
  assert.notEqual(sharedWorkspace, root);
  await call('path:reveal', outputPath);
  assert.equal(revealedPaths.at(-1), path.join(sharedWorkspace, outputPath));
  assert.deepEqual(await fs.readdir(path.dirname(revealedPaths.at(-1)!)), [
    'index.html',
  ]);
  assert.equal(
    await fs.readFile(revealedPaths.at(-1)!, 'utf8'),
    otherClient.files[outputPath],
  );
  assert.ok(
    (await call('history:list')).some(
      (entry: { actorName: string; kind: string; status: string }) =>
        entry.actorName === '앱 관리자' &&
        entry.kind === 'ai' &&
        entry.status === 'completed',
    ),
  );
  console.log(
    'PASS: desktop adapter receives another member edit and publishes local AI output to the shared server',
  );
  const sharedWorkflow = await call('tasks:create', workflowInput);
  const sharedWorkflowRun = await call('codex:start', {
    taskPath: sharedWorkflow.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-gamejam-shared',
  });
  await waitForStep2(sharedWorkflowRun.runId);
  await otherClient.refresh();
  const concurrentWorkflowIdea = await otherClient.command(
    'documents:create-idea',
    { x: 0, y: 0 },
  );
  const sharedComplete = await terminal(sharedWorkflowRun.runId);
  assert.equal(sharedComplete.status, 'completed', sharedComplete.message);
  await otherClient.refresh();
  const sharedExpected = matter(otherClient.files[sharedWorkflow.relativePath])
    .data.expected_outputs;
  for (const relative of sharedExpected) assert.ok(otherClient.files[relative]);
  assert.ok(otherClient.files[concurrentWorkflowIdea.relativePath]);
  assert.equal(otherClient.state.aiRun!.status, 'completed');
  console.log(
    'PASS: shared gamejam keeps one administrator lease across both stages and publishes all four outputs to other participants',
  );
  const rememberedId = `shared:${shared.projectId}`;
  const rememberedMember = shared.memberId;
  const rememberedCache = path.join(
    (await call('workspace:get')).root,
    'server-cache.json',
  );
  await call('documents:set-color', {
    relativePath: idea.relativePath,
    color: 'yellow',
  });
  assert.equal(
    (await call('documents:list')).find((doc: any) => doc.id === idea.id)
      .backgroundColor,
    'yellow',
  );
  await call('projects:home');
  assert.equal((await call('workspace:get')).root, null);
  assert.equal((await call('collaboration:get')).active, false);
  const entries = await call('projects:list');
  assert.ok(
    entries.some(
      (entry: any) => entry.id === rememberedId && entry.role === 'admin',
    ),
  );
  assert.ok(!JSON.stringify(entries).includes(shared.recoveryKey));
  await otherClient.refresh();
  const originalSharedFiles = structuredClone(otherClient.files);
  await call('projects:folder-create', '공동 게임');
  const sharedFolder = (await call('projects:folders'))[0];
  await call('projects:move', rememberedId, sharedFolder.id);
  const previousSharedName = entries.find(
    (entry: any) => entry.id === rememberedId,
  ).name;
  await call(
    'projects:rename',
    rememberedId,
    '이름 변경된 공동 게임',
    previousSharedName,
  );
  await otherClient.refresh();
  assert.equal(otherClient.state.projectName, '이름 변경된 공동 게임');
  assert.deepEqual(otherClient.files, originalSharedFiles);
  assert.equal(
    (await call('projects:list')).find(
      (entry: any) => entry.id === rememberedId,
    ).folderId,
    sharedFolder.id,
  );
  assert.equal(
    (await call('projects:list', true)).find(
      (entry: any) => entry.id === rememberedId,
    ).name,
    '이름 변경된 공동 게임',
  );
  assert.equal(
    (await call('projects:list')).find((entry: any) => entry.root === root)
      .name,
    path.basename(root),
  );
  await call('projects:open', rememberedId);
  assert.equal((await call('collaboration:get')).memberId, rememberedMember);
  assert.equal((await call('collaboration:get')).role, 'admin');
  await call('projects:home');
  const rememberedPort = collaborationServer.port;
  await collaborationServer.close();
  await assert.rejects(
    call('projects:rename', rememberedId, '오프라인 이름'),
    /서버|연결/,
  );
  await call('projects:open', rememberedId);
  assert.equal((await call('collaboration:get')).connected, false);
  await call('collaboration:lock', idea.relativePath);
  await call('documents:save', {
    relativePath: idea.relativePath,
    title: '오프라인 메모',
    body: '서버 종료 중 IPC 저장',
  });
  await assert.rejects(call('collaboration:leave'), /미동기화/);
  await call('projects:home');
  assert.ok(
    (await call('projects:list')).find(
      (entry: any) => entry.id === rememberedId,
    ).pendingChanges,
  );
  const savedOfflineCache = await fs.readFile(rememberedCache, 'utf8');
  await fs.writeFile(rememberedCache, 'broken fixture');
  await assert.rejects(call('projects:open', rememberedId), /덮어쓰지/);
  assert.equal(await fs.readFile(rememberedCache, 'utf8'), 'broken fixture');
  assert.equal((await call('workspace:get')).root, null);
  await fs.writeFile(rememberedCache, savedOfflineCache);
  await call('projects:open', rememberedId);
  assert.equal(
    (await call('documents:list')).find((doc: any) => doc.id === idea.id).body,
    '서버 종료 중 IPC 저장',
  );
  await call('projects:home');
  collaborationServer = await createCollaborationServer({
    dataDirectory: path.join(root, 'test-server'),
    port: rememberedPort,
    creationKey: 'test-key',
  });
  await call('projects:open', rememberedId);
  assert.equal((await call('collaboration:get')).pendingChanges, 0);
  await otherClient.refresh();
  assert.equal(
    matter(otherClient.files[idea.relativePath]).content.trim(),
    '서버 종료 중 IPC 저장',
  );
  console.log(
    'PASS: project home preserves administrator membership, encrypted project selection, card colors and durable offline IPC edits across server shutdown/restart',
  );
  await call('collaboration:leave');
  assert.equal((await call('workspace:get')).root, root);
  assert.equal((await call('collaboration:get')).active, false);
  await call('collaboration:join', {
    serverUrl,
    code: shared.inviteCode,
    nickname: '앱 편집자',
  });
  const editorTask = await call('tasks:create', {
    kind: 'implement',
    inputPaths: [idea.relativePath],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new', basePath: 'output/index.html' },
  });
  const editorRun = await call('codex:start', {
    taskPath: editorTask.relativePath,
    providerId: 'codex-cli',
    modelId: 'fixture-valid',
  });
  const editorCompleted = await terminal(editorRun.runId);
  assert.equal(editorCompleted.status, 'completed', editorCompleted.message);
  for (const providerId of ['claude-cli', 'gemini-cli']) {
    const status = await call('ai:status', providerId);
    assert.equal(status.available, true, status.message);
    assert.equal(status.authenticated, true, status.message);
    const task = await call('tasks:create', {
      kind: 'implement',
      inputPaths: [idea.relativePath],
      x: 0,
      y: 0,
      htmlResult: { mode: 'new', basePath: 'output/index.html' },
    });
    const run = await call('codex:start', {
      taskPath: task.relativePath,
      providerId,
      modelId: 'fixture-valid',
    });
    const result = await terminal(run.runId);
    assert.equal(result.status, 'completed', result.message);
    assert.equal(result.providerId, providerId);
    await otherClient.refresh();
    assert.equal(otherClient.state.aiRun!.providerId, providerId);
    const history = (await otherClient.history()).find(
      (entry) =>
        entry.taskPath === task.relativePath && entry.status === 'completed',
    );
    assert.equal(history!.providerId, providerId);
    assert.equal(history!.actorName, '앱 편집자');
  }
  await assert.rejects(
    call('history:restore', (await call('history:list'))[0].id),
    /관리자/,
  );
  await call('collaboration:leave');
  console.log(
    'PASS: desktop editor creates and executes its own AI but cannot restore history; leaving preserves the original local workspace',
  );
  for (const providerId of ['claude-cli', 'gemini-cli']) {
    const workflow = await call('tasks:create', {
      kind: 'organize',
      inputPaths: [idea.relativePath],
      x: 0,
      y: 0,
      documentResult: { mode: 'new' },
      thenImplement: {
        htmlResult: { mode: 'new', basePath: 'output/index.html' },
      },
    });
    const run = await call('codex:start', {
      taskPath: workflow.relativePath,
      providerId,
      modelId: 'fixture-gamejam-valid',
    });
    const result = await terminal(run.runId);
    assert.equal(result.status, 'completed', result.message);
    const raw = matter(
      await fs.readFile(path.join(root, workflow.relativePath), 'utf8'),
    );
    for (const relative of raw.data.expected_outputs)
      assert.ok(await fs.readFile(path.join(root, relative), 'utf8'));
    const errorTask = await call('tasks:create', {
      kind: 'implement',
      inputPaths: [idea.relativePath],
      x: 0,
      y: 0,
      htmlResult: { mode: 'new', basePath: 'output/index.html' },
    });
    const output = matter(
      await fs.readFile(path.join(root, errorTask.relativePath), 'utf8'),
    ).data.expected_outputs[0];
    const failed = await call('codex:start', {
      taskPath: errorTask.relativePath,
      providerId,
      modelId: 'fixture-provider-error',
    });
    assert.equal((await terminal(failed.runId)).status, 'failed');
    await assert.rejects(fs.access(path.join(root, output)));
    const stopped = await call('codex:start', {
      taskPath: errorTask.relativePath,
      providerId,
      modelId: 'fixture-valid',
    });
    await call('codex:cancel', stopped.runId);
    assert.equal((await terminal(stopped.runId)).status, 'cancelled');
    await assert.rejects(fs.access(path.join(root, output)));
    const imageTask = await call('tasks:create', {
      kind: 'implement',
      inputPaths: [importedImage.relativePath],
      x: 0,
      y: 0,
      htmlResult: { mode: 'new', basePath: 'output/index.html' },
    });
    const imageOutput = matter(
      await fs.readFile(path.join(root, imageTask.relativePath), 'utf8'),
    ).data.expected_outputs[0];
    const imageRun = await call('codex:start', {
      taskPath: imageTask.relativePath,
      providerId,
      modelId: 'fixture-asset-valid',
    });
    const imageResult = await terminal(imageRun.runId);
    assert.equal(imageResult.status, 'completed', imageResult.message);
    assert.ok(
      (await fs.readFile(path.join(root, imageOutput), 'utf8')).includes(
        `data:image/png;base64,${png.toString('base64')}`,
      ),
    );
  }
  console.log(
    'PASS: Claude/Gemini IPC adapters run shared editor tasks, sequential workflows, enforce file-only flags, embed selected assets and reject failures/cancellation publication (mock CLI, no paid AI)',
  );
  for (const mode of ['fixture-asset-valid', 'fixture-asset-tamper']) {
    const assetTask = await call('tasks:create', {
      kind: 'implement',
      inputPaths: [importedImage.relativePath],
      x: 0,
      y: 0,
      htmlResult: { mode: 'new', basePath: 'output/index.html' },
    });
    const assetOutput = matter(
      await fs.readFile(path.join(root, assetTask.relativePath), 'utf8'),
    ).data.expected_outputs[0];
    const assetRun = await call('codex:start', {
      taskPath: assetTask.relativePath,
      providerId: 'codex-cli',
      modelId: mode,
    });
    const result = await terminal(assetRun.runId);
    assert.deepEqual(
      await fs.readFile(path.join(root, importedImage.asset.path)),
      png,
    );
    if (mode === 'fixture-asset-valid') {
      assert.equal(result.status, 'completed', result.message);
      assert.ok(
        (await fs.readFile(path.join(root, assetOutput), 'utf8')).includes(
          `data:image/png;base64,${png.toString('base64')}`,
        ),
      );
    } else {
      assert.equal(result.status, 'failed', result.message);
      assert.equal(result.failure.code, 'GC-AI-003');
      await assert.rejects(fs.access(path.join(root, assetOutput)));
    }
  }
  console.log(
    'PASS: selected image bytes reach AI staging and embed in published HTML; altered input images reject publication and preserve originals',
  );
} finally {
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  otherClient?.stop();
  for (const listener of (await import('./mocks/electron')).app.listeners(
    'before-quit',
  ))
    listener();
  await collaborationServer?.close();
  await new Promise((resolve) => setTimeout(resolve, 450));
  await fs.rm(root, { recursive: true, force: true });
}
