import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { CollaborationClient } from '../src/collaboration-client.ts';
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), 'gamejam-runtime-trash-'),
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
  assert.equal(health?.projectTrash, true);
  assert.equal(health.version, '0.15.0');
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
      input,
      created.credentials.token,
    );
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
  assert.equal((await api('state')).files['project.md'], '# bundled runtime');
  console.log(
    'PASS packaged Node/server runtime: projectTrash capability, team retention, access fence, restoration',
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
