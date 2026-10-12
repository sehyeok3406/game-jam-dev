import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { CollaborationClient } from '../src/collaboration-client.ts';
import matter from '../src/markdown.ts';
import { rectDistance } from '../src/canvas-placement.ts';
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-runtime-workflow-'),
);
const runtime = path.resolve(
  'out/Game Jam!-win32-x64/resources/self-host-runtime',
);
const listener = net.createServer();
await new Promise((r) => listener.listen(0, '127.0.0.1', r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const child = spawn(
  path.join(runtime, 'node.exe'),
  [path.join(runtime, 'server.mjs')],
  {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      GAME_CANVAS_PORT: String(port),
      GAME_CANVAS_DATA: directory,
    },
  },
);
try {
  const url = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 100; i++) {
    try {
      health = await fetch(url + '/health').then((r) => r.json());
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(health?.documentStatusesVersion, 1);
  assert.equal(health?.projectTrash, true);
  assert.equal(health.version, '0.17.0');
  const created = await CollaborationClient.create(
    url,
    '',
    'runtime-owner',
    'runtime trash',
    { 'project.md': '# bundled runtime' },
  );
  const api = (action, input = {}) =>
    CollaborationClient.fetch(
      url,
      `/projects/${created.credentials.projectId}/${action}`,
      { documentStatusesVersion: 1, syncClientVersion: 1, ...input },
      created.credentials.token,
    );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  await owner.command('documents:set-workflow', {
    relativePath: 'project.md',
    objectId: 'project.md',
    statusId: 'in-progress',
  });
  const state = await api('state');
  assert.ok(state.files['.canvas/document-statuses.json']);
  assert.match(state.files['project.md'], /workflow_status_id: in-progress/);
  owner.accept(await api('state'));
  await owner.command('canvases:change', {
    action: 'add',
    id: 'nearby',
    name: 'nearby',
    expected: owner.files['.canvas/canvases.json'] ?? null,
  });
  await owner.command('documents:create-idea', {
    canvasId: 'nearby',
    x: 100,
    y: 100,
  });
  await owner.command('documents:create-idea', {
    canvasId: 'nearby',
    x: 480,
    y: 100,
  });
  await owner.command('canvases:change', {
    action: 'move',
    id: 'default',
    targetId: 'nearby',
    paths: ['project.md'],
    expected: owner.files['.canvas/canvases.json'] ?? null,
  });
  const moved = matter(owner.files['project.md']).data;
  assert.equal(moved.canvas_id, 'nearby');
  assert.equal(
    Math.min(
      ...[
        { x: 100, y: 100, width: 340, height: 300 },
        { x: 480, y: 100, width: 340, height: 300 },
      ].map((r) => rectDistance({ ...moved, width: 340, height: 300 }, r)),
    ),
    40,
  );
  owner.stop();
  assert.equal(
    (
      await api('trash', {
        typedName: 'runtime trash',
        confirmTeam: true,
        expectedVersion: 0,
      })
    ).status,
    'trashed',
  );
  await assert.rejects(api('state'), (e) => e.code === 'PROJECT_TRASHED');
  assert.equal((await api('trash-restore')).status, 'active');
  assert.match(
    (await api('state')).files['project.md'],
    /workflow_status_id: in-progress/,
  );
  console.log(
    'PASS packaged Node/server runtime: status transaction, project retention/restore and shared destination cluster placement',
  );
} finally {
  child.kill();
  await new Promise((r) =>
    child.exitCode !== null ? r() : child.once('exit', r),
  );
  assert.ok(directory.startsWith(os.tmpdir() + path.sep));
  await fs.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
