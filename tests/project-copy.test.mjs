import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from '../src/markdown.ts';
import { projectCopyBundle } from '../src/project-copy.ts';
import {
  reduceCollaboration,
  snapshotDocuments,
  snapshotSections,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import {
  htmlSourcePath,
  htmlSourceId,
  sourceMetadata,
} from '../src/html-source.ts';
import { encodeAsset, decodeAsset } from '../src/file-assets.ts';
import {
  drawingPath,
  serializeDrawing,
  snapshotDrawings,
} from '../src/drawing-model.ts';
import { ProjectCopyService } from '../src/application/projects/project-copy-service.ts';
import { registerProjectCopyIpc } from '../src/desktop/projects/project-copy.ts';
import { DesktopProjectSessions } from '../src/desktop/project-session.ts';
import { materialize, captureProject } from '../src/project-store.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWRkAAAAASUVORK5CYII=',
  'base64',
);
const htmlPath = 'output/inbox/game/v001/index.html';
const environment = { now: () => 1234567, id: randomUUID };
const md = (id, data = {}, body = `${id} 원문\n`) =>
  matter.stringify(body, {
    id,
    title: id,
    type: 'idea',
    x: 20,
    y: 30,
    width: 340,
    height: 300,
    canvas_id: 'default',
    ...data,
  });
function fixture() {
  const object = {
    id: randomUUID(),
    generation: randomUUID(),
    kind: 'shape',
    geometry: { shape: 'rectangle' },
    transform: { x: 30, y: 40, width: 100, height: 80, rotation: 0 },
    style: {
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 2,
      opacity: 1,
      strokePattern: 'solid',
    },
    layer: 'annotation',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const files = {
    'project.md': md('project'),
    'ideas/a.md': md(
      'a',
      {
        background_color: 'mint',
        sources: [
          { id: 'b', path: 'docs/b.md' },
          { id: 'outside', path: 'docs/outside.md' },
        ],
      },
      '[내부](gamejam://document/b) [외부 원본](gamejam://document/outside)\n![image](assets/images/image.png)\n`gamejam://document/b`\n',
    ),
    'docs/b.md': md('b', {
      type: 'image',
      asset: {
        path: 'assets/images/image.png',
        purpose: 'asset',
        originalName: 'image.png',
        mime: 'image/png',
        bytes: png.length,
      },
      x: 400,
    }),
    'docs/outside.md': md('outside'),
    'sections/s.md': md('section', {
      type: 'section',
      members: [
        { id: 'a', path: 'ideas/a.md' },
        { id: 'b', path: 'docs/b.md' },
      ],
    }),
    'assets/images/image.png': encodeAsset('assets/images/image.png', png),
    [htmlPath]:
      '<!doctype html><html><head><title>game</title><link rel="stylesheet" href="style.css"></head><body><img src="art.png"><script src="game.js"></script></body></html>',
    [htmlSourcePath(htmlPath)]: sourceMetadata(htmlPath, '', {
      title: '결과',
      x: 600,
      y: 400,
    }),
    'output/inbox/game/v001/style.css': encodeAsset(
      'output/inbox/game/v001/style.css',
      Buffer.from('body { background: url("art.png") }'),
    ),
    'output/inbox/game/v001/game.js': encodeAsset(
      'output/inbox/game/v001/game.js',
      Buffer.from('console.log("copied");'),
    ),
    'output/inbox/game/v001/art.png': encodeAsset(
      'output/inbox/game/v001/art.png',
      png,
    ),
    [drawingPath('default')]: serializeDrawing({
      version: 1,
      canvasId: 'default',
      objects: [object],
    }),
  };
  return {
    files,
    object,
    selection: {
      canvasId: 'default',
      documents: [{ id: 'a', path: 'ideas/a.md' }],
      sections: [{ id: 'section', path: 'sections/s.md' }],
      previews: [htmlPath],
      drawings: [{ id: object.id, generation: object.generation }],
    },
  };
}
function input(bundle) {
  return { requestId: randomUUID(), canvasId: 'default', bundle };
}

test('project copy is independent, deduplicates section members, rewrites links/assets and retains layout/HTML files', () => {
  const f = fixture(),
    original = structuredClone(f.files);
  checkSnapshot(f.files);
  const bundle = projectCopyBundle(f.files, f.selection);
  assert.deepEqual(bundle.documents.sort(), ['docs/b.md', 'ideas/a.md']);
  assert.equal(bundle.files['docs/outside.md'], undefined);
  const target = { 'project.md': md('project', {}, '대상 원문') };
  const { files, result } = reduceCollaboration(
    target,
    'projects:import-copy',
    input(bundle),
    environment,
  );
  checkSnapshot(files);
  const docs = snapshotDocuments(files),
    a = docs.find((doc) => doc.title === 'a'),
    b = docs.find((doc) => doc.title === 'b');
  assert.notEqual(a.id, 'a');
  assert.notEqual(b.id, 'b');
  assert.equal(b.x - a.x, 380);
  assert.equal(b.y - a.y, 0);
  assert.ok(a.body.includes(`gamejam://document/${b.id}`));
  assert.ok(a.body.includes('원본 참조: outside'));
  assert.ok(a.body.includes('`gamejam://document/b`'));
  assert.deepEqual(decodeAsset(b.asset.path, files[b.asset.path]), png);
  assert.notEqual(b.asset.path, 'assets/images/image.png');
  assert.ok(
    a.body.includes(
      path.posix.relative(path.posix.dirname(a.relativePath), b.asset.path),
    ),
  );
  const section = snapshotSections(files)[0];
  assert.deepEqual(
    section.members.map((m) => m.id).sort(),
    [a.id, b.id].sort(),
  );
  const html = Object.keys(files).find((key) => key.endsWith('/index.html'));
  assert.notEqual(html, htmlPath);
  assert.equal(files[html], f.files[htmlPath]);
  assert.equal(matter(files[htmlSourcePath(html)]).data.id, htmlSourceId(html));
  for (const name of ['style.css', 'game.js', 'art.png'])
    assert.equal(
      files[html.replace('index.html', name)],
      f.files[htmlPath.replace('index.html', name)],
    );
  assert.notEqual(snapshotDrawings(files)[0].id, f.object.id);
  assert.equal(result.count, 5);
  assert.equal(files['project.md'], target['project.md']);
  assert.deepEqual(f.files, original);
});

test('copy rejects missing/replaced sources, missing HTML files, external paths and injected project settings before publication', () => {
  const f = fixture();
  assert.throws(
    () =>
      projectCopyBundle(f.files, {
        ...f.selection,
        documents: [{ id: 'replaced', path: 'ideas/a.md' }],
      }),
    /변경/,
  );
  assert.throws(
    () =>
      projectCopyBundle(
        { ...f.files, 'output/inbox/game/v001/game.js': undefined },
        f.selection,
      ),
    /파일/,
  );
  assert.throws(() =>
    projectCopyBundle(
      {
        ...f.files,
        [htmlPath]:
          '<html><body><img src="../../../../secret.png"></body></html>',
      },
      f.selection,
    ),
  );
  const bundle = projectCopyBundle(f.files, f.selection);
  bundle.files['.canvas/canvases.json'] =
    '{"version":1,"canvases":[{"id":"default","name":"injected"}]}';
  assert.throws(
    () => reduceCollaboration({}, 'projects:import-copy', input(bundle)),
    /선택 자료 외/,
  );
  assert.throws(
    () =>
      reduceCollaboration({}, 'projects:import-copy', {
        ...input(bundle),
        canvasId: 'deleted',
      }),
    /캔버스/,
  );
});

test('project overview and AI task documents become new ordinary copies without replacing target settings', () => {
  const files = {
    'project.md': md('project'),
    '.ai/tasks/task.md': md('task', {
      type: 'ai-task',
      run_id: 'active',
      task_id: 'old',
    }),
  };
  const bundle = projectCopyBundle(files, {
    canvasId: 'default',
    documents: [
      { id: 'project', path: 'project.md' },
      { id: 'task', path: '.ai/tasks/task.md' },
    ],
    sections: [],
    previews: [],
    drawings: [],
  });
  const { files: target } = reduceCollaboration(
    { 'project.md': md('target') },
    'projects:import-copy',
    input(bundle),
  );
  assert.equal(matter(target['project.md']).data.id, 'target');
  const task = snapshotDocuments(target).find((doc) => doc.title === 'task');
  assert.equal(task.type, 'reference');
  assert.ok(task.relativePath.startsWith('docs/'));
  assert.equal(matter(target[task.relativePath]).data.run_id, undefined);
});

test('color-only canvas batch handles more than ten cards as one atomic edit', () => {
  const files = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`ideas/${i}.md`, md(String(i))]),
  );
  const commands = Object.keys(files).map((relativePath) => ({
    channel: 'documents:set-color',
    input: { relativePath, color: 'blue' },
  }));
  const changed = reduceCollaboration(files, 'canvas:batch', { commands });
  assert.ok(
    snapshotDocuments(changed.files).every(
      (doc) => doc.backgroundColor === 'blue',
    ),
  );
  commands.at(-1).input.relativePath = 'ideas/missing.md';
  assert.throws(() => reduceCollaboration(files, 'canvas:batch', { commands }));
  assert.ok(
    snapshotDocuments(files).every((doc) => doc.backgroundColor !== 'blue'),
  );
});

test('copy service expires a changed source session and never publishes an unrelated selection', async () => {
  const f = fixture();
  let current = true,
    published = 0;
  const service = new ProjectCopyService({
    assertSource() {
      if (!current) throw Error('stale');
    },
    source: async () => {
      current = false;
      return f.files;
    },
    assertReadable() {},
    destination: async () => ({
      info: {},
      close() {},
      publish: async () => {
        published++;
      },
    }),
  });
  await assert.rejects(
    service.copy({
      session: {},
      requestId: randomUUID(),
      targetId: 'target',
      canvasId: 'default',
      selection: f.selection,
    }),
    /stale/,
  );
  assert.equal(published, 0);
});

test('desktop copy supports all four local/shared directions, server synchronization, receipts, permissions and target Undo', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-copy-'));
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'test-copy-key',
  });
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const f = fixture();
  const createdA = await CollaborationClient.create(
    url,
    'test-copy-key',
    'source',
    'source',
    f.files,
  );
  const createdB = await CollaborationClient.create(
    url,
    'test-copy-key',
    'target',
    'target',
    { 'project.md': md('project') },
  );
  const sourceClient = new CollaborationClient(createdA.credentials, () => {}),
    targetObserver = new CollaborationClient(createdB.credentials, () => {});
  t.after(() => {
    sourceClient.stop();
    targetObserver.stop();
  });
  const sourceRoot = path.join(root, 'source'),
    localTarget = path.join(root, 'target');
  await fs.mkdir(sourceRoot);
  await fs.mkdir(localTarget);
  await materialize(sourceRoot, f.files);
  await materialize(localTarget, { 'project.md': md('project') });
  const sessions = new DesktopProjectSessions();
  const entries = new Map([
    [
      'local-target',
      {
        id: 'local-target',
        kind: 'local',
        root: localTarget,
        name: 'local target',
      },
    ],
    [
      'shared-target',
      {
        id: 'shared-target',
        kind: 'shared',
        credentials: createdB.credentials,
        name: 'shared target',
      },
    ],
  ]);
  const handlers = new Map(),
    journals = new Map();
  registerProjectCopyIpc((channel, handler) => handlers.set(channel, handler), {
    sessions,
    library: { get: (id) => entries.get(id) },
    userData: root,
    journals,
    internalServerUrl: async () => url,
    trashed: () => false,
    assertReadable() {},
    assertSender() {},
    changed() {},
  });
  const copy = handlers.get('projects:copy-selection');
  await sessions.activate(sourceRoot);
  const localRequest = {
    session: sessions.ref,
    requestId: randomUUID(),
    targetId: 'local-target',
    canvasId: 'default',
    selection: f.selection,
  };
  const first = await copy({}, localRequest);
  const once = await captureProject(localTarget);
  assert.deepEqual(await copy({}, localRequest), first);
  assert.deepEqual(await captureProject(localTarget), once);
  assert.ok(journals.get(await fs.realpath(localTarget)).state.undo);
  await copy(
    {},
    { ...localRequest, requestId: randomUUID(), targetId: 'shared-target' },
  );
  await targetObserver.refresh();
  assert.equal(snapshotSections(targetObserver.files).length, 1);
  const historyId = journals
    .get(
      `shared:${createdB.credentials.projectId}:${createdB.credentials.token}`,
    )
    .peek('undo').id;
  await targetObserver.changeHistory(historyId, 'undo');
  assert.equal(snapshotSections(targetObserver.files).length, 0);
  await targetObserver.changeHistory(historyId, 'redo');
  assert.equal(snapshotSections(targetObserver.files).length, 1);
  await sourceClient.refresh();
  await sessions.activate(sourceRoot, sourceClient);
  await copy(
    {},
    {
      ...localRequest,
      session: sessions.ref,
      requestId: randomUUID(),
      targetId: 'local-target',
    },
  );
  assert.equal(snapshotSections(await captureProject(localTarget)).length, 2);
  const sharedRequest = {
    ...localRequest,
    session: sessions.ref,
    requestId: randomUUID(),
    targetId: 'shared-target',
  };
  await copy({}, sharedRequest);
  await targetObserver.refresh();
  assert.equal(snapshotSections(targetObserver.files).length, 2);
  assert.equal(snapshotSections(sourceClient.files).length, 1);
  const viewer = await CollaborationClient.join(
    url,
    createdB.credentials.inviteCode,
    'viewer',
  );
  const viewerClient = new CollaborationClient(viewer.credentials, () => {});
  t.after(() => viewerClient.stop());
  await targetObserver.setRole(viewer.result.state.memberId, 'viewer');
  await viewerClient.refresh();
  await assert.rejects(
    viewerClient.command(
      'projects:import-copy',
      input(projectCopyBundle(f.files, f.selection)),
    ),
    /뷰어/,
  );
});
