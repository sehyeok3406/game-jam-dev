import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  root,
  profile,
  game,
  boot,
  stop,
  wait,
  js,
} from './helpers/packaged-canvas.mjs';
import { buildFixture } from './helpers/game-build.mjs';
import { materialize } from '../src/project-store.ts';
import { physicalProjectPath } from '../src/core/projects/project-layout.ts';
import { GAME_BUILD_INDEX } from '../src/contracts/game-build.ts';

const f = buildFixture();
const call = (method, ...args) =>
  js(
    `window.gameCanvas[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
  );
const first = 'output/systems/source/v001/index.html',
  second = 'output/content/shared/v001/index.html';
try {
  await materialize(game, f.files);
  await boot();
  assert.ok(
    (await call('listPreviews')).some(
      (p) => p.relativePath === f.artifact.path,
    ),
  );
  const layout = await call('getProjectLayout');
  await call('upgradeProjectLayout', layout.session);
  const local = (key) => path.join(game, physicalProjectPath(key, true));
  assert.equal(
    await fs.readFile(local(`${f.prefix}/source/main.js`), 'utf8'),
    f.source,
  );
  await call('moveResult', {
    relativePath: f.artifact.path,
    category: 'systems',
    feature: 'source',
  });
  assert.equal(
    JSON.parse(await fs.readFile(local(GAME_BUILD_INDEX), 'utf8')).artifacts[0]
      .path,
    first,
  );
  await js(
    'window.__buildWatchCount = 0; window.__stopBuildWatch = window.gameCanvas.onWorkspaceChanged(() => window.__buildWatchCount++)',
  );
  await fs.writeFile(local(`${f.prefix}/source/main.js`), f.source);
  await wait('window.__buildWatchCount > 0');
  await js('window.__stopBuildWatch()');
  const server = await call('startLocalCollaborationServer');
  await call('createCollaboration', {
    serverUrl: server.serverUrl,
    serverKey: '',
    nickname: '원본 보관 패키지 검사',
  });
  const sharedWorkspace = await call('getWorkspace');
  const mirrored = (key) =>
    path.join(sharedWorkspace.root, physicalProjectPath(key, true));
  const sharedEntry = (await call('listProjects')).find(
    (p) => p.kind === 'shared',
  );
  assert.ok(sharedEntry);
  await call('moveResult', {
    relativePath: first,
    category: 'content',
    feature: 'shared',
  });
  assert.equal(
    JSON.parse(await fs.readFile(mirrored(GAME_BUILD_INDEX), 'utf8'))
      .artifacts[0].path,
    second,
  );
  assert.equal(
    await fs.readFile(mirrored(`${f.prefix}/manifest.json`), 'utf8'),
    f.files[`${f.prefix}/manifest.json`],
  );
  await call('undo');
  assert.ok((await call('listPreviews')).some((p) => p.relativePath === first));
  await call('redo');
  await call('listPreviews');
  await call('deleteDocument', { documentId: second, relativePath: second });
  await call('listPreviews');
  await assert.rejects(fs.access(mirrored(`${f.prefix}/source/main.js`)), {
    code: 'ENOENT',
  });
  await call('undo');
  // Undo updates the authoritative server first. The next native mutation prepares its mirror.
  await call('moveResult', {
    relativePath: second,
    category: 'content',
    feature: 'restored',
  });
  const restored = 'output/content/restored/v001/index.html';
  assert.equal(
    await fs.readFile(mirrored(`${f.prefix}/source/main.js`), 'utf8'),
    f.source,
  );
  await stop(true);
  await boot(false);
  await call('openProject', sharedEntry.id);
  await call('listPreviews');
  assert.equal(
    await fs.readFile(mirrored(`${f.prefix}/source/main.js`), 'utf8'),
    f.source,
  );
  assert.equal(
    JSON.parse(await fs.readFile(mirrored(GAME_BUILD_INDEX), 'utf8'))
      .artifacts[0].path,
    restored,
  );
  console.log(
    'PASS: actual Windows package preserves source/lock/manifest through explicit layout migration, watcher, local/shared moves, Undo/Redo, deletion/restoration and full app/server restart',
  );
} finally {
  await stop();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(profile),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
