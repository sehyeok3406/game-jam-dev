import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from '../src/markdown.ts';
import { initialProjectSnapshot } from '../src/core/projects/initial-project.ts';
import { PROJECT_LAYOUT_PATH } from '../src/contracts/project-layout.ts';
import { allocateDocumentPath } from '../src/core/projects/document-path.ts';
import { readProjectLayout } from '../src/core/projects/project-layout.ts';
import { planProjectLayout } from '../src/application/projects/layout-migration.ts';
import { ProjectLayoutService } from '../src/application/projects/layout-service.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { layoutMarkdownCodec } from '../src/adapters/markdown/layout-snapshot.ts';
import { remapLayoutMarkdown } from '../src/adapters/markdown/layout-links.ts';
import {
  installProjectLayout,
  recoverProjectLayout,
} from '../src/adapters/filesystem/layout-migration.ts';
import { filesystemHomeProjects } from '../src/adapters/filesystem/home-projects.ts';
import { filesystemProjectReader } from '../src/adapters/filesystem/project-reader.ts';
import { ensureProjectLayout } from '../src/adapters/filesystem/project-layout.ts';
import {
  captureProject,
  materialize,
  saveHistory,
  restoreHistory,
  applyChanges,
} from '../src/project-store.ts';
import {
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import { buildFileImports } from '../src/file-assets.ts';
import { createTaskPlan } from '../src/task-plan.ts';
import { documentSets, documentOutputRecords } from '../src/document-output.ts';
import { taskDocumentFormat } from '../src/document-format.ts';
import { writeClientCache, readClientCache } from '../src/client-cache.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { SharedProjectMirror } from '../src/application/editing/shared-project-mirror.ts';
import { filesystemSharedProjectFiles } from '../src/adapters/filesystem/shared-project-files.ts';
import { desktopSharedProjects } from '../src/desktop/projects/shared-projects.ts';

const doc = (id, title, body = '# 내용', data = {}) =>
  matter.stringify(body, {
    id,
    title,
    type: 'idea',
    status: 'draft',
    sources: [],
    ...data,
  });
const legacy = () => ({
  'project.md': doc('project', '프로젝트 소개', '# 작성한 소개'),
  'ideas/a.md': doc(
    'a',
    '규칙',
    '[다른 문서](gamejam://file/docs%2Fimported%2Fb.md)\n\n![그림](../assets/images/pic.png)',
    { unknown: { keep: true } },
  ),
  'docs/imported/b.md': doc('b', '규칙', '[메모](../../ideas/a.md)', {
    sources: [{ id: 'a', path: 'ideas/a.md' }],
  }),
  'sections/s.md': doc('s', '섹션', '', {
    members: [{ id: 'a', path: 'ideas/a.md' }],
    width: 800,
    height: 600,
  }),
});
const plan = (files) =>
  planProjectLayout(files, layoutMarkdownCodec, remapLayoutMarkdown);
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-layout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('new local projects stay empty across reopen and every user creation writes flat docs', async (t) => {
  const parent = await temporary(t);
  const root = await filesystemHomeProjects.create(parent, '빈 프로젝트');
  await ensureProjectLayout(root);
  await ensureProjectLayout(root);
  assert.deepEqual(await filesystemProjectReader(root).documents(), []);
  assert.deepEqual(Object.keys(await captureProject(root)), [
    PROJECT_LAYOUT_PATH,
  ]);
  assert.equal(
    await fs.stat(path.join(root, 'project.md')).catch(() => null),
    null,
  );
  assert.equal(await fs.stat(path.join(root, 'ideas')).catch(() => null), null);
  assert.equal(
    await fs.stat(path.join(root, 'output/README.md')).catch(() => null),
    null,
  );
  const files = await captureProject(root);
  const idea = reduceCollaboration(files, 'documents:create-idea', {
    x: 0,
    y: 0,
  });
  assert.match(idea.result.relativePath, /^docs\/[^/]+\.md$/);
  await applyChanges(root, files, {
    [idea.result.relativePath]: idea.files[idea.result.relativePath],
  });
  assert.equal((await filesystemProjectReader(root).documents()).length, 1);
  const imported = buildFileImports(
    {
      files: [
        { name: 'source.md', content: doc('external', '같은 제목') },
        { name: 'again.md', content: doc('external', '같은 제목') },
      ],
      imagePurpose: 'asset',
      x: 0,
      y: 0,
    },
    undefined,
    idea.files,
  );
  assert.equal(Object.keys(imported).length, 2);
  assert.ok(Object.keys(imported).every((p) => /^docs\/[^/]+\.md$/.test(p)));
  const copied = reduceCollaboration(idea.files, 'documents:duplicate', {
    documents: [{ id: idea.result.id, path: idea.result.relativePath }],
    offsetX: 32,
    offsetY: 32,
  });
  assert.ok(
    copied.result.every((d) => /^docs\/[^/]+\.md$/.test(d.relativePath)),
  );
});

test('flat document names reject Windows hazards and allocate case-insensitive collisions', () => {
  assert.equal(allocateDocumentPath('CON', [], 'id'), 'docs/문서-CON.md');
  assert.equal(allocateDocumentPath('../a:b?', [], 'id'), 'docs/--a-b-.md');
  assert.equal(
    allocateDocumentPath('Title', ['docs/title.md'], '123'),
    'docs/Title-123.md',
  );
});

test('modern AI custom documents use titles, attribute grouping and stable update paths', () => {
  const files = {
    ...initialProjectSnapshot('AI'),
    'docs/입력.md': doc('input', '입력'),
  };
  const templates = [
    {
      key: 'd1',
      title: '심사 규칙',
      type: 'system',
      instructions: '규칙 설명',
    },
  ];
  const input = {
    kind: 'organize',
    x: 0,
    y: 0,
    inputPaths: ['docs/입력.md'],
    documentResult: { mode: 'new', structure: 'custom', documents: templates },
  };
  const raw = createTaskPlan(input, 'first', files);
  const format = taskDocumentFormat(raw);
  assert.equal(format.documents[0].path, 'docs/심사-규칙.md');
  const generated = {
    ...files,
    [format.documents[0].path]: doc('rule', templates[0].title, '# 규칙', {
      type: 'system',
      document_bundle_id: format.id,
      document_output: { key: 'd1', instructions: '규칙 설명' },
      system_id: `${format.id}:d1`,
    }),
  };
  const sets = documentSets(
    Object.keys(generated),
    documentOutputRecords(generated),
  );
  assert.equal(sets.length, 1);
  const update = taskDocumentFormat(
    createTaskPlan(
      {
        ...input,
        documentResult: {
          ...input.documentResult,
          mode: 'update',
          baseDir: sets[0].baseDir,
        },
      },
      'second',
      generated,
    ),
  );
  assert.equal(update.id, format.id);
  assert.equal(update.documents[0].path, format.documents[0].path);
  const next = taskDocumentFormat(createTaskPlan(input, 'third', generated));
  assert.match(next.documents[0].path, /^docs\/심사-규칙-[^/]+\.md$/);
});

test('migration preserves IDs, unknown attributes, section membership and parsed links', () => {
  const before = legacy();
  const after = plan(before);
  checkSnapshot(after);
  const aliases = readProjectLayout(after).aliases;
  assert.notEqual(aliases['ideas/a.md'], aliases['docs/imported/b.md']);
  const a = matter(after[aliases['ideas/a.md']]),
    b = matter(after[aliases['docs/imported/b.md']]);
  assert.equal(a.data.id, 'a');
  assert.deepEqual(a.data.unknown, { keep: true });
  assert.ok(
    a.content.includes(
      `gamejam://file/${encodeURIComponent(aliases['docs/imported/b.md'])}`,
    ),
  );
  assert.ok(a.content.includes('../assets/images/pic.png'));
  assert.equal(b.data.sources[0].path, aliases['ideas/a.md']);
  assert.equal(
    matter(after['sections/s.md']).data.members[0].path,
    aliases['ideas/a.md'],
  );
  assert.deepEqual(plan(after), after);
  try {
    assert.equal(
      readProjectLayout(invertEdit(after, before, after, 'undo')).version,
      2,
    );
  } catch (error) {
    assert.match(error.message, /되돌릴 파일 변경/);
  }
});

test('physical migration preserves local history and cache and restoration uses current paths', async (t) => {
  const root = await temporary(t),
    before = legacy();
  await materialize(root, before);
  const prior = { ...before, 'ideas/a.md': doc('a', '규칙', '# 예전 내용') };
  await saveHistory(root, prior, before, {
    id: 'old-edit',
    kind: 'user',
    label: '문서 편집',
    status: 'completed',
    createdAt: 1,
  });
  await writeClientCache(root, {
    files: before,
    state: { projectName: 'old' },
    revisions: {},
  });
  const after = plan(before);
  await installProjectLayout(root, after);
  assert.deepEqual(await captureProject(root), after);
  assert.ok(await fs.stat(path.join(root, '.gamejam/project/sections/s.md')));
  assert.ok(
    await fs.stat(
      path.join(root, '.gamejam/local/history/old-edit/entry.json'),
    ),
  );
  assert.equal(
    await fs.stat(path.join(root, '.history')).catch(() => null),
    null,
  );
  assert.deepEqual(
    (await readClientCache(path.join(root, 'server-cache.json'))).files,
    before,
  );
  await restoreHistory(root, 'old-edit', 'ideas/a.md', 'before');
  const current = await captureProject(root),
    target = readProjectLayout(after).aliases['ideas/a.md'];
  assert.equal(matter(current[target]).content.trim(), '# 예전 내용');
  assert.equal(current['ideas/a.md'], undefined);
  await recoverProjectLayout(root);
});

test('interrupted physical migration resumes from a durable journal and rejects external changes', async (t) => {
  const root = await temporary(t),
    before = legacy();
  await materialize(root, before);
  const after = plan(before);
  let interrupted = false;
  await assert.rejects(
    installProjectLayout(root, after, () => {
      if (interrupted) throw Error('session changed');
      // Interrupt after the first new internal file has been prepared.
      if (fsSyncExists(path.join(root, '.gamejam/project/sections/s.md'))) {
        interrupted = true;
        throw Error('session changed');
      }
    }),
    /session changed/,
  );
  assert.ok(
    await fs.stat(path.join(root, '.gamejam/local/migrations/pending.json')),
  );
  await recoverProjectLayout(root);
  assert.deepEqual(await captureProject(root), after);
});

import { existsSync as fsSyncExists } from 'node:fs';

test('shared upgrade is explicit, durable, admin-only, idempotent and blocks old writers', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-layout-server-'),
  );
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    creationKey: 'test',
    port: 0,
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    'test',
    '호환 검사',
    'owner',
    legacy(),
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  clients.push(owner);
  await owner.refresh();
  assert.equal(owner.files[PROJECT_LAYOUT_PATH], undefined);
  await owner.lock('ideas/a.md');
  const originalNote = matter(owner.files['ideas/a.md']);
  await owner.command('documents:save', {
    relativePath: 'ideas/a.md',
    documentId: 'a',
    title: originalNote.data.title,
    body: originalNote.content.trim() + '\n\nowner note',
  });
  const oldEditId = owner.lastCommandHistoryId;
  await owner.unlock('ideas/a.md');
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'editor',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  clients.push(editor);
  await editor.refresh();
  const previous = { ...editor.files };
  await assert.rejects(
    editor.request('layout-upgrade', { revision: editor.state.revision }),
    /관리자/,
  );
  const result = await owner.request('layout-upgrade', {
    revision: owner.state.revision,
    deltaVersion: undefined,
  });
  assert.equal(readProjectLayout(result.files).version, 2);
  const again = await owner.request('layout-upgrade', {
    revision: 0,
    deltaVersion: undefined,
  });
  assert.equal(again.state.revision, result.state.revision);
  const response = await fetch(
    `${url}/projects/${created.credentials.projectId}/command`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${created.credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: randomUUID(),
        channel: 'documents:create-idea',
        input: { x: 0, y: 0 },
        revisions: {},
      }),
    },
  );
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /업데이트/);
  const mirrorRoot = path.join(root, 'mirror');
  await fs.mkdir(mirrorRoot);
  const mirror = new SharedProjectMirror(
    filesystemSharedProjectFiles(
      mirrorRoot,
      { pauseWatcher: async () => async () => {}, trashItem: async () => {} },
      () => {},
    ),
    () => {},
  );
  await mirror.sync(result.files);
  assert.deepEqual(await captureProject(mirrorRoot), result.files);
  const migratedPath = readProjectLayout(result.files).aliases['ideas/a.md'];
  await editor.lock(migratedPath);
  await assert.rejects(
    owner.request('history-change', {
      id: oldEditId,
      direction: 'undo',
      operationId: randomUUID(),
    }),
    /편집/,
  );
  await editor.unlock(migratedPath);
  const edited = {
    ...previous,
    'ideas/a.md': doc('a', '규칙', '# 오프라인에서 작성', {
      unknown: { keep: true },
    }),
  };
  const extra = reduceCollaboration(edited, 'documents:create-idea', {
    x: 0,
    y: 0,
  });
  editor.offline = { base: previous, local: extra.files };
  editor.files = extra.files;
  await editor.refresh();
  assert.equal(editor.offline, null);
  assert.ok(
    Object.values(editor.files).some((raw) =>
      raw.includes('# 오프라인에서 작성'),
    ),
  );
  const newPath = Object.keys(editor.files).find(
    (p) =>
      p.endsWith('.md') && matter(editor.files[p]).data.id === extra.result.id,
  );
  assert.match(newPath, /^docs\/[^/]+\.md$/);
  assert.ok(!Object.keys(editor.files).some((p) => p.startsWith('ideas/')));
});

test('shared folder preparation preserves pending edits, works offline and rejects revoked or replaced projects', async (t) => {
  const profile = await temporary(t),
    projectId = randomUUID();
  const entry = {
    id: 'shared-card',
    kind: 'shared',
    projectId,
    credentials: {
      serverUrl: 'https://example.com',
      projectId,
      token: 'token',
    },
  };
  const envelope = {
    files: legacy(),
    state: { projectId, projectName: '공유 폴더', role: 'viewer' },
    revisions: {},
  };
  let fetched = 0,
    prepared = 0,
    failure = null;
  const adapter = desktopSharedProjects({
    library: { get: () => entry },
    userData: profile,
    active: () => null,
    internalServerUrl: async () => '',
    drainCache: async () => {},
    fetch: async () => {
      fetched++;
      if (failure) throw failure;
      return envelope;
    },
    prepareFiles: async (root, files, guard) => {
      prepared++;
      await new SharedProjectMirror(
        filesystemSharedProjectFiles(
          root,
          {
            pauseWatcher: async () => async () => {},
            trashItem: async () => {},
          },
          guard,
        ),
        guard,
      ).sync(files);
    },
  });
  const online = await adapter.directory(entry.id);
  assert.equal(online.offline, false);
  assert.equal(fetched, 1);
  assert.deepEqual(await captureProject(online.root), envelope.files);
  const local = {
    ...envelope.files,
    'ideas/a.md': doc('a', '규칙', '# 아직 전송하지 않은 내용'),
  };
  await writeClientCache(online.root, {
    ...envelope,
    offline: { base: envelope.files, local },
  });
  const offline = await adapter.directory(entry.id);
  assert.equal(offline.offline, true);
  assert.equal(fetched, 1);
  assert.equal(
    (await captureProject(online.root))['ideas/a.md'],
    local['ideas/a.md'],
  );
  await writeClientCache(online.root, envelope);
  failure = Object.assign(Error('revoked'), { status: 403 });
  const count = prepared;
  await assert.rejects(adapter.directory(entry.id), /revoked/);
  assert.equal(prepared, count);
  failure = new TypeError('offline');
  assert.equal((await adapter.directory(entry.id)).offline, true);
  entry.kind = 'local';
  await assert.rejects(adapter.directory(entry.id), /변경/);
});

test('layout service never upgrades automatically and rejects unsupported or stale sessions', async () => {
  let files = legacy(),
    installed = 0,
    current = true;
  const shared = { supported: false, connected: true, admin: true };
  const service = new ProjectLayoutService({
    capture: async () => files,
    assertCurrent: () => {
      if (!current) throw Error('session changed');
    },
    blocked: () => undefined,
    shared: () => shared,
    preserve: async () => {},
    pause: async () => async () => {},
    install: async (next) => {
      installed++;
      files = next;
    },
    record: async () => {},
    validate: checkSnapshot,
    changed: () => {},
    markdown: layoutMarkdownCodec,
    links: remapLayoutMarkdown,
  });
  assert.equal((await service.status()).canUpgrade, false);
  assert.equal(installed, 0);
  await assert.rejects(service.upgrade(), /서버/);
  current = false;
  await assert.rejects(service.status(), /session changed/);
});
