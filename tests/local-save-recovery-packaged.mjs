import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { extractAll, extractFile } from '@electron/asar';
import electron from 'electron';
import { DEFAULT_SHAPE_STYLE, shapeFromDrag } from '../src/drawing-geometry.ts';
import {
  boot,
  game,
  js,
  profile,
  root,
  stop,
} from './helpers/packaged-canvas.mjs';

const note = 'ideas/recovery.md';
const drawing = '.canvas/drawings/default.json';
const marker = path.join(game, '.gamejam/local/edit-batch.json');
const baseDrawing = JSON.stringify({
  version: 1,
  canvasId: 'default',
  objects: [],
});
const original = (body) =>
  `---\nid: recovery-memo\ntitle: Recovery memo\ntype: idea\n---\n${body}\n`;
const api = (name, ...args) =>
  js(`window.gameCanvas[${JSON.stringify(name)}](...${JSON.stringify(args)})`);
const batchVersions = async () =>
  (await api('listHistory')).filter(
    (entry) => entry.label === '편집 내용 저장',
  );

try {
  const packageDir = path.resolve('out/Game Jam!-win32-x64');
  const archive = path.join(packageDir, 'resources/app.asar');
  const engine = (
    await fs.readFile(path.join(packageDir, 'version'), 'utf8')
  ).trim();
  assert.equal(
    engine,
    JSON.parse(await fs.readFile('node_modules/electron/package.json', 'utf8'))
      .version,
  );
  const instrumented = path.join(root, 'instrumented');
  extractAll(archive, instrumented);
  const manifest = JSON.parse(extractFile(archive, 'package.json'));
  const bridge = 'baseline-main.cjs';
  await fs.copyFile(
    new URL('./helpers/local-save-baseline-main.cjs', import.meta.url),
    path.join(instrumented, bridge),
  );
  await fs.writeFile(
    path.join(instrumented, 'package.json'),
    JSON.stringify({ ...manifest, main: bridge }),
  );
  await fs.mkdir(path.join(game, 'ideas'));
  await fs.writeFile(path.join(game, note), original('Base text'));
  await fs.mkdir(path.dirname(path.join(game, drawing)), { recursive: true });
  await fs.writeFile(path.join(game, drawing), baseDrawing);
  const signal = path.join(root, 'interrupted');
  const registration = path.join(profile, 'local-projects.json');
  const localRegistry = await fs.readFile(registration);

  await boot(
    true,
    {
      ...process.env,
      GC_BASELINE_PROJECT: game,
      GC_BASELINE_PROFILE: profile,
      GC_BASELINE_TRACE: path.join(root, 'trace.json'),
      GC_RECOVERY_PAUSE_AFTER_RENAME: drawing,
      GC_RECOVERY_SIGNAL: signal,
      NODE_PATH: path.resolve('node_modules'),
    },
    { executable: electron, appArgs: [instrumented] },
  );
  const workspace = await api('getWorkspace');
  const scope = workspace.saveScope;
  const oldSession = workspace.session.sessionId;
  const title = 'Recovery memo';
  const key = `game-canvas-draft:${game}:recovery-memo`;
  const req = {
    scope,
    key,
    relativePath: note,
    documentId: 'recovery-memo',
    title,
    body: 'Latest draft before crash',
    base: { title, body: 'Base text' },
    sequence: 1,
    workspaceSessionId: oldSession,
  };
  await api('enqueueDocumentSave', req);
  const id = randomUUID();
  await api(
    'applyDrawingCommand',
    {
      action: 'create',
      canvasId: 'default',
      scope,
      objects: [
        {
          id,
          generation: randomUUID(),
          kind: 'shape',
          layer: 'background',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          style: DEFAULT_SHAPE_STYLE,
          ...shapeFromDrag('rectangle', { x: 100, y: 100 }, { x: 200, y: 200 }),
        },
      ],
    },
    oldSession,
  );
  await js(
    `void window.gameCanvas.flushDocumentSaves(${JSON.stringify(scope)}, undefined, ${JSON.stringify(oldSession)}).catch(() => {})`,
  );
  let paused = false;
  for (let attempt = 0; attempt < 120 && !paused; attempt++) {
    paused = await fs.access(signal).then(
      () => true,
      () => false,
    );
    if (!paused) await delay(50);
  }
  assert.ok(
    paused,
    'The package must pause after committing the first original',
  );
  assert.equal(
    JSON.parse(await fs.readFile(path.join(game, drawing), 'utf8')).objects[0]
      .id,
    id,
  );
  assert.equal(
    await fs.readFile(path.join(game, note), 'utf8'),
    original('Base text'),
  );
  await fs.access(marker);
  assert.deepEqual(await batchVersions(), []);
  await fs.writeFile(path.join(game, note), original('External text'));
  await stop();

  // The standalone Electron harness and branded EXE use different Windows
  // encryption identities. Re-seed only the synthetic project registration.
  await fs.rm(path.join(profile, 'projects.enc'), { force: true });
  await fs.writeFile(registration, localRegistry);
  await boot();
  const newSession = (await api('getWorkspace')).session.sessionId;
  assert.notEqual(newSession, oldSession);
  await assert.rejects(
    api('flushDocumentSaves', scope, null, oldSession),
    /프로젝트/,
  );
  await assert.rejects(
    api('discardDocumentSave', scope, key, 1, oldSession),
    /프로젝트/,
  );
  assert.equal(
    await fs.readFile(path.join(game, drawing), 'utf8'),
    baseDrawing,
  );
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  assert.equal(
    await fs.readFile(path.join(game, note), 'utf8'),
    original('External text'),
  );
  assert.equal(
    (await api('getDocumentSaveStates')).find((state) => state.key === key)
      .latest.body,
    req.body,
  );
  await api('recoverDrawingBatch', scope, newSession, 'restore');
  await assert.rejects(
    api('flushDocumentSaves', scope, null, newSession),
    /다른 곳에서 변경/,
  );
  assert.equal(
    (await api('getDocumentSaveStates')).find((state) => state.key === key)
      .phase,
    'conflict',
  );
  assert.deepEqual(await batchVersions(), []);

  // Resolve the conflict against the explicitly reviewed external base.
  await api('discardDocumentSave', scope, key, 1, newSession);
  await api('enqueueDocumentSave', {
    ...req,
    workspaceSessionId: newSession,
    sequence: 2,
    base: { title, body: 'External text' },
  });
  await api('flushDocumentSaves', scope, null, newSession);
  await api('flushDocumentSaves', scope, null, newSession);
  assert.equal((await api('getDocument', note)).body, req.body);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(game, drawing), 'utf8')).objects[0]
      .id,
    id,
  );
  const versions = await batchVersions();
  assert.equal(versions.length, 1);
  assert.deepEqual(versions[0].files.map((file) => file.relativePath).sort(), [
    drawing,
    note,
  ]);
  await stop(true);
  console.log(
    'PASS: interrupted batch, external edit, latest drafts, stale session and one history version after retry',
  );
} finally {
  await stop();
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.equal(
    path.dirname(path.resolve(profile)),
    path.resolve(process.env.APPDATA, 'Game Canvas', 'test-users'),
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true });
}
