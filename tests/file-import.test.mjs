import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import {
  buildFileImports,
  encodeAsset,
  decodeAsset,
  isAssetPath,
} from '../src/file-assets.ts';
import {
  snapshotDocuments,
  reduceCollaboration,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import {
  materialize,
  captureProject,
  applyChanges,
  saveHistory,
  readHistoryFile,
  restoreHistory,
} from '../src/project-store.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { resolveAssetLink } from '../src/asset-links.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGL538AAAAAA///5tjreAAAABklEQVQDAAQRAYTXKkMGAAAAAElFTkSuQmCC',
  'base64',
);
const project = {
  'project.md':
    '---\nid: project\ntitle: test\ntype: overview\nstatus: draft\nsources: []\n---\n# test',
};
const batch = (purpose = 'asset') => ({
  x: 100,
  y: 200,
  imagePurpose: purpose,
  files: [
    {
      name: '한글 참고.md',
      content:
        '---\nid: project\ntitle: 외부 기획서\nsources: [other-project]\n---\n\n|항목|값|\n|---|---|\n|체력|100|\n',
    },
    {
      name: 'player.png',
      content: encodeAsset('assets/images/source.png', png),
    },
  ],
});
test('relative Markdown image paths resolve inside the project and reject URLs or traversal', () => {
  assert.equal(
    resolveAssetLink('../../assets/images/player.png', 'docs/imported/ref.md'),
    'assets/images/player.png',
  );
  assert.equal(
    resolveAssetLink('assets/images/player.png', 'docs/imported/ref.md'),
    'assets/images/player.png',
  );
  for (const value of [
    '../../../assets/images/player.png',
    'https://example.com/x.png',
    'file:///x.png',
    'data:image/png;base64,abc',
    '/assets/images/x.png',
    '%2e%2e/x.png',
  ])
    assert.equal(resolveAssetLink(value, 'docs/imported/ref.md'), null);
});

test('imports allocate unique IDs and preserve external Markdown metadata without taking over canvas identity', () => {
  const imported = buildFileImports(batch('diagram'));
  const docs = snapshotDocuments(imported);
  assert.equal(docs.length, 2);
  assert.ok(docs.every((doc) => doc.id !== 'project'));
  const reference = docs.find((doc) => doc.type === 'reference');
  assert.equal(reference.title, '외부 기획서');
  assert.match(reference.body, /\|체력\|100\|/);
  assert.deepEqual(reference.sources, []);
  assert.equal(
    matter(imported[reference.relativePath]).data.imported_frontmatter.id,
    'project',
  );
  const image = docs.find((doc) => doc.type === 'image');
  assert.equal(image.asset.purpose, 'diagram');
  assert.equal(image.asset.originalName, 'player.png');
  assert.deepEqual(
    decodeAsset(image.asset.path, imported[image.asset.path]),
    png,
  );
  const again = buildFileImports(batch());
  assert.ok(
    Object.keys(again).every((relative) => imported[relative] === undefined),
  );
  checkSnapshot({ ...project, ...imported, ...again });
});

test('unsupported, malformed, oversized and executable-frontmatter imports fail before publication', () => {
  for (const entry of [
    { name: 'x.svg', content: '<svg onload="alert(1)" />' },
    { name: '../bad.md', content: 'x' },
    { name: 'x.md', content: '\0binary' },
    { name: 'x.md', content: 'x'.repeat(2_000_001) },
    { name: 'x.md', content: '---js\n({test: require("node:fs")})\n---' },
    {
      name: 'x.png',
      content:
        'data:image/png;base64,' + Buffer.from('fake').toString('base64'),
    },
  ])
    assert.throws(() => buildFileImports({ ...batch(), files: [entry] }));
  assert.equal(isAssetPath('assets/images/../private.png'), false);
  assert.throws(() =>
    decodeAsset(
      'assets/images/x.png',
      encodeAsset('assets/images/x.png', png) + ' ',
    ),
  );
  assert.throws(() =>
    buildFileImports({ ...batch(), files: Array(21).fill(batch().files[0]) }),
  );
  const before = JSON.stringify(project);
  assert.throws(() =>
    reduceCollaboration(project, 'files:import-batch', {
      ...batch(),
      files: [batch().files[0], { name: 'x.exe', content: 'bad' }],
    }),
  );
  assert.equal(JSON.stringify(project), before);
});

test('binary assets survive snapshots, AI staging, history, undo-like deletion and atomic restoration byte-for-byte', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-assets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const additions = buildFileImports(batch());
  const next = { ...project, ...additions };
  await materialize(root, next);
  assert.deepEqual(await captureProject(root), next);
  const image = snapshotDocuments(next).find((doc) => doc.type === 'image');
  assert.deepEqual(await fs.readFile(path.join(root, image.asset.path)), png);
  await saveHistory(root, project, next, {
    id: 'import-assets',
    label: '파일 불러오기',
    kind: 'user',
    status: 'completed',
    createdAt: Date.now(),
  });
  assert.equal(
    await readHistoryFile(root, 'import-assets', image.asset.path, 'after'),
    next[image.asset.path],
  );
  await assert.rejects(
    restoreHistory(root, 'import-assets', image.relativePath),
    /전체 기록/,
  );
  await applyChanges(
    root,
    next,
    Object.fromEntries(
      Object.keys(additions).map((relative) => [relative, null]),
    ),
  );
  await restoreHistory(root, 'import-assets', undefined, 'after');
  assert.deepEqual(await fs.readFile(path.join(root, image.asset.path)), png);
  const stage = path.join(root, 'stage');
  await fs.mkdir(stage);
  await materialize(stage, await captureProject(root));
  assert.deepEqual(await fs.readFile(path.join(stage, image.asset.path)), png);
});

test('image descriptors belong to sections, share assets on duplication and preserve assets when their card is deleted', () => {
  let files = reduceCollaboration(project, 'files:import-batch', batch()).files;
  const image = snapshotDocuments(files).find((doc) => doc.type === 'image');
  const section = reduceCollaboration(files, 'sections:create', {
    title: '플레이어',
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    members: [{ id: image.id, path: image.relativePath }],
  });
  files = section.files;
  const copied = reduceCollaboration(files, 'documents:duplicate', {
    documents: [{ id: image.id, path: image.relativePath }],
    offsetX: 30,
    offsetY: 30,
  });
  assert.equal(copied.result[0].asset.path, image.asset.path);
  const removed = reduceCollaboration(copied.files, 'documents:delete', {
    documentId: image.id,
    relativePath: image.relativePath,
  });
  assert.ok(removed.files[image.asset.path]);
  const bad = { ...removed.files };
  delete bad[image.asset.path];
  assert.throws(() => checkSnapshot(bad), /원본 이미지/);
  const task = reduceCollaboration(copied.files, 'tasks:create', {
    kind: 'implement',
    inputPaths: [image.relativePath],
    x: 600,
    y: 0,
    htmlResult: { mode: 'new' },
  });
  assert.match(task.result.body, /asset.path/);
  assert.match(task.result.body, /data URI/);
  assert.match(task.result.body, /참고 자료/);
});

test('real collaboration imports are synchronized, actor-attributed, idempotent and allowed during AI while selected images stay protected and viewers stay blocked', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'canvas-import-server-'),
  );
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    'fixture',
    '관리자',
    '파일 테스트',
    project,
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    created.credentials.serverUrl,
    created.credentials.inviteCode,
    '편집자',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  const imported = await editor.command('files:import-batch', batch());
  await owner.refresh();
  const image = imported.find((doc) => doc.type === 'image');
  assert.deepEqual(
    decodeAsset(image.asset.path, owner.files[image.asset.path]),
    png,
  );
  const history = await owner.history();
  assert.equal(history[0].actorName, '편집자');
  assert.equal(history[0].files.length, 3);
  await assert.rejects(
    owner.restore(history[0].id, image.relativePath),
    /전체 기록/,
  );
  await editor.changeHistory(history[0].id, 'undo');
  await owner.refresh();
  assert.equal(owner.files[image.asset.path], undefined);
  await editor.changeHistory(history[0].id, 'redo');
  await owner.refresh();
  assert.deepEqual(
    decodeAsset(image.asset.path, owner.files[image.asset.path]),
    png,
  );
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(editor.command('files:import-batch', batch()), /뷰어/);
  await owner.setRole(editor.state.memberId, 'editor');
  await editor.refresh();
  const task = await owner.command('tasks:create', {
    kind: 'implement',
    inputPaths: [image.relativePath],
    x: 500,
    y: 100,
    htmlResult: { mode: 'new' },
  });
  await owner.beginAi(task.relativePath);
  const concurrent = await editor.command('files:import-batch', batch());
  assert.ok(concurrent.length);
  const originalAsset = owner.files[image.asset.path];
  await assert.rejects(
    editor.request('offline-sync', {
      id: randomUUID(),
      changes: {
        [image.asset.path]: encodeAsset(
          image.asset.path,
          Buffer.concat([
            decodeAsset(image.asset.path, originalAsset),
            Buffer.from([0]),
          ]),
        ),
      },
      revisions: editor.revisions,
    }),
    /AI 작업/,
  );
  await editor.refresh();
  assert.equal(editor.files[image.asset.path], originalAsset);
  await assert.rejects(
    editor.command('documents:delete', {
      documentId: image.id,
      relativePath: image.relativePath,
    }),
    /AI 작업/,
  );
  await owner.cancelAi();
});
