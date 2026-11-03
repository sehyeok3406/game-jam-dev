import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildFixture, imagePath } from './helpers/game-build.mjs';
import { gameBuildCodec as codec } from '../src/adapters/node/game-build-codec.ts';
import { GameBuildLimits } from '../src/contracts/game-build.ts';
import {
  readGameBuild,
  readGameBuildIndex,
  assertGameBuildMutation,
  isGameBuildPath,
} from '../src/core/projects/game-build.ts';
import {
  captureProject,
  materialize,
  projectPath,
  applyChanges,
  saveHistory,
  restoreHistory,
  recoverInterruptedHistory,
  listHistory,
} from '../src/project-store.ts';
import {
  checkSnapshot,
  collaborationPath,
  reduceCollaboration,
} from '../src/collaboration-model.ts';
import { relocateResults } from '../src/result-structure.ts';
import { projectCopyBundle, importProjectCopy } from '../src/project-copy.ts';
import { planHistoryRestoration } from '../src/server/services/history-restoration.ts';
import { planOfflineChanges } from '../src/server/services/offline-changes.ts';
import { trashDeletedFiles } from '../src/result-deletion.ts';
import { installProjectLayout } from '../src/adapters/filesystem/layout-migration.ts';
import { planProjectLayout } from '../src/application/projects/layout-migration.ts';
import { layoutMarkdownCodec } from '../src/adapters/markdown/layout-snapshot.ts';
import { remapLayoutMarkdown } from '../src/adapters/markdown/layout-links.ts';
const environment = { id: randomUUID, now: () => 1234 };
const changes = (before, after) =>
  Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => before[key] !== after[key])
      .map((key) => [key, after[key] ?? null]),
  );
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-build-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('complete source/lock/notices/asset/HTML hashes and Windows paths are validated without a package name allowlist', () => {
  const f = buildFixture();
  checkSnapshot(f.files);
  assert.deepEqual(readGameBuild(f.files, f.artifact.buildId, codec).sources, {
    'main.js': f.source,
  });
  for (const suffix of [
    'source/../escape.js',
    'source/CON.js',
    'source/.hidden.js',
    'source/node_modules/pkg/index.js',
    'cache.bin',
    'source/MAIN.JS',
  ]) {
    const name = `${f.prefix}/${suffix}`;
    if (!suffix.includes('node_modules'))
      assert.equal(isGameBuildPath(name), false, name);
    assert.throws(
      () => checkSnapshot({ ...f.files, [name]: 'injected' }),
      undefined,
      name,
    );
  }
  for (const key of Object.keys(f.bundle)) {
    const missing = { ...f.files };
    delete missing[key];
    assert.throws(() => checkSnapshot(missing), undefined, key);
    assert.throws(
      () => checkSnapshot({ ...f.files, [key]: f.files[key] + 'tampered' }),
      undefined,
      key,
    );
  }
  assert.throws(
    () =>
      checkSnapshot({ ...f.files, [f.artifact.path]: '<html>changed</html>' }),
    /HTML hash/,
  );
  assert.throws(
    () =>
      checkSnapshot({ ...f.files, [imagePath]: f.files[imagePath] + 'bad' }),
    /에셋/,
  );
  const modified = { ...f.files, 'docs/rules.md': '# 사용자가 나중에 수정' };
  delete modified['docs/rules.md'];
  checkSnapshot(modified); // A baseline is historical evidence, not a lock on user documents.
  assert.throws(() => collaborationPath(f.prefix + '/source/aux.js'));
  assert.throws(
    () =>
      planOfflineChanges(f.files, {
        changes: { [`${f.prefix}/source/main.js`]: f.source },
      }),
    /온라인/,
  );
  const unpinned = JSON.parse(f.files[`${f.prefix}/dependencies.lock.json`]);
  unpinned.packages[0].version = '^1.2.3';
  const raw = JSON.stringify(unpinned),
    manifest = { ...f.manifest, dependenciesSha256: codec.digest(raw) };
  assert.throws(
    () =>
      checkSnapshot({
        ...f.files,
        [`${f.prefix}/dependencies.lock.json`]: raw,
        [`${f.prefix}/manifest.json`]: JSON.stringify(manifest),
      }),
    /exact/,
  );
  assert.equal(
    isGameBuildPath(`${f.prefix}/source/${'x'.repeat(200)}.js`),
    false,
  );
  for (const pair of [
    ['Folder/a.js', 'folder/b.js'],
    ['a.js', 'a.js/child.js'],
  ]) {
    const files = { ...f.files },
      manifest = structuredClone(f.manifest);
    for (const relative of pair) {
      files[`${f.prefix}/source/${relative}`] = 'export default 1;';
      manifest.sources.push({
        path: relative,
        bytes: codec.byteLength('export default 1;'),
        sha256: codec.digest('export default 1;'),
      });
    }
    files[`${f.prefix}/manifest.json`] = JSON.stringify(manifest);
    assert.throws(() => checkSnapshot(files), /충돌/);
  }
});

test('source capture and writes reject external directory junctions before touching their target', async (t) => {
  const root = await temporary(t),
    project = path.join(root, 'project'),
    outside = path.join(root, 'outside');
  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'sentinel.txt'), 'preserved');
  await fs.symlink(
    outside,
    path.join(project, '.game-builds'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(captureProject(project), /심볼릭 링크/);
  await assert.rejects(
    materialize(project, buildFixture().files),
    /심볼릭 링크/,
  );
  assert.equal(
    await fs.readFile(path.join(outside, 'sentinel.txt'), 'utf8'),
    'preserved',
  );
  assert.deepEqual(await fs.readdir(outside), ['sentinel.txt']);
});

test('append-only revisions preserve exact lock and stable artifact identity across moves and project copies', () => {
  const first = buildFixture();
  const second = buildFixture({
    before: first.files,
    artifactId: first.artifact.artifactId,
    html: '<html>두 번째</html>',
    source: 'export const version = 2;',
  });
  assertGameBuildMutation(first.files, second.files);
  assert.throws(
    () =>
      assertGameBuildMutation(first.files, {
        ...first.files,
        [`${first.prefix}/source/main.js`]: 'changed',
      }),
    /새 제작 버전/,
  );
  const destination = 'output/inbox/moved/v001/index.html';
  const moved = relocateResults(second.files, [
    { from: first.artifact.path, to: destination },
  ]);
  checkSnapshot(moved);
  assert.equal(readGameBuildIndex(moved).artifacts[0].path, destination);
  assert.equal(
    moved[`${first.prefix}/manifest.json`],
    first.files[`${first.prefix}/manifest.json`],
  );
  const bundle = projectCopyBundle(moved, {
    canvasId: 'default',
    documents: [],
    sections: [],
    previews: [destination],
    drawings: [],
  });
  const copied = importProjectCopy(
    { 'project.md': '# 대상' },
    { requestId: randomUUID(), canvasId: 'default', bundle },
    environment,
  ).files;
  checkSnapshot(copied);
  const artifact = readGameBuildIndex(copied).artifacts[0];
  assert.notEqual(artifact.artifactId, first.artifact.artifactId);
  assert.notEqual(artifact.buildId, second.artifact.buildId);
  assert.equal(copied[artifact.path], second.html);
  const manifests = Object.keys(copied).filter((key) =>
    key.endsWith('/manifest.json'),
  );
  assert.equal(manifests.length, 2);
  for (const key of manifests) {
    const m = JSON.parse(copied[key]);
    assert.equal(m.artifactId, artifact.artifactId);
    assert.notEqual(m.assets[0].path, imagePath);
    assert.equal(m.assets[0].key, 'hero');
    assert.equal(copied[m.assets[0].path], first.files[imagePath]);
    assert.equal(
      copied[key.replace('manifest.json', 'dependencies.lock.json')],
      first.files[`${first.prefix}/dependencies.lock.json`],
    );
  }
  const unrelated = buildFixture({
    before: moved,
    path: 'output/inbox/other/v001/index.html',
  });
  const selected = projectCopyBundle(unrelated.files, {
    canvasId: 'default',
    documents: [],
    sections: [],
    previews: [destination],
    drawings: [],
  });
  assert.equal(
    Object.hasOwn(selected.files, `${unrelated.prefix}/manifest.json`),
    false,
  );
});

test('filesystem capture, explicit layout migration, atomic rollback and interrupted recovery keep complete build revisions', async (t) => {
  const root = await temporary(t),
    first = buildFixture();
  await materialize(root, first.files);
  assert.deepEqual(await captureProject(root), first.files);
  const second = buildFixture({
    before: first.files,
    artifactId: first.artifact.artifactId,
    source: 'export const changed = true;',
    html: '<html>변경</html>',
  });
  let attempts = 0;
  await assert.rejects(
    applyChanges(
      root,
      first.files,
      changes(first.files, second.files),
      () => ++attempts > 4,
    ),
    /중지/,
  );
  assert.deepEqual(await captureProject(root), first.files);
  await saveHistory(root, first.files, second.files, {
    id: 'interrupted',
    label: '제작',
    kind: 'ai',
    status: 'validating',
    createdAt: 1,
  });
  // Simulate a process exit between individual atomic renames, not just a clean failure.
  await fs.writeFile(await projectPath(root, first.artifact.path), second.html);
  const sourcePath = `${second.prefix}/source/main.js`;
  await fs.mkdir(path.dirname(await projectPath(root, sourcePath)), {
    recursive: true,
  });
  await fs.writeFile(await projectPath(root, sourcePath), second.source);
  await recoverInterruptedHistory(root);
  assert.deepEqual(await captureProject(root), first.files);
  assert.equal(
    (await listHistory(root)).find((h) => h.id === 'interrupted').status,
    'failed',
  );
  const plan = planProjectLayout(
    first.files,
    layoutMarkdownCodec,
    remapLayoutMarkdown,
  );
  await installProjectLayout(root, plan, () => {});
  assert.deepEqual(await captureProject(root), plan);
  assert.match(
    await projectPath(root, `${first.prefix}/manifest.json`),
    /\.gamejam[\\/]project[\\/]builds/,
  );
  const unexpected = await projectPath(
    root,
    `${first.prefix}/node_modules/cache.bin`,
  );
  await fs.mkdir(path.dirname(unexpected), { recursive: true });
  await fs.writeFile(unexpected, 'cache');
  await assert.rejects(captureProject(root), /허용되지 않은/);
});

test('result deletion/trash and whole-history restore keep sources together, including restoration after a move', async (t) => {
  const root = await temporary(t),
    f = buildFixture();
  await materialize(root, f.files);
  const deleted = reduceCollaboration(
    f.files,
    'documents:delete',
    { relativePath: f.artifact.path },
    environment,
  ).files;
  checkSnapshot(deleted);
  assert.equal(
    Object.keys(deleted).some((key) => key.startsWith(f.prefix + '/')),
    false,
  );
  const targets = [];
  await trashDeletedFiles(root, f.files, deleted, async (target) =>
    targets.push(target),
  );
  assert.ok(targets.includes(await projectPath(root, f.prefix)));
  await saveHistory(root, f.files, deleted, {
    id: 'deleted',
    kind: 'user',
    status: 'completed',
    label: '삭제',
    createdAt: 2,
  });
  await applyChanges(root, f.files, changes(f.files, deleted));
  await assert.rejects(
    restoreHistory(root, 'deleted', `${f.prefix}/source/main.js`),
    /전체 기록/,
  );
  await restoreHistory(root, 'deleted');
  const restored = await captureProject(root);
  checkSnapshot(restored);
  assert.equal(restored[`${f.prefix}/source/main.js`], f.source);
  const second = buildFixture({
    before: f.files,
    artifactId: f.artifact.artifactId,
    html: '<html>v2</html>',
  });
  const record = {
    entry: {
      files: Object.keys(changes(f.files, second.files)).map(
        (relativePath) => ({ relativePath }),
      ),
    },
    before: f.files,
    after: second.files,
  };
  const to = 'output/inbox/relocated/v001/index.html';
  const moved = relocateResults(second.files, [{ from: f.artifact.path, to }]);
  const prior = planHistoryRestoration(moved, record, { version: 'before' });
  assert.equal(prior[to], f.html);
  assert.equal(readGameBuildIndex(prior).artifacts[0].path, to);
  checkSnapshot(prior);
});

test('source and project technical bounds stay separate from legacy HTML size', () => {
  const f = buildFixture();
  assert.equal(GameBuildLimits.sourceFiles, 64);
  const oversized = {
    ...f.files,
    [`${f.prefix}/source/main.js`]: 'a'.repeat(GameBuildLimits.sourceBytes + 1),
  };
  assert.throws(() => checkSnapshot(oversized), /파일 크기/);
  assert.throws(
    () => checkSnapshot({ [f.artifact.path]: 'a'.repeat(8_000_001) }),
    /HTML은 8MB/,
  );
});
