import { build } from 'vite';
import electron from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { PlayClient } from '../src/multiplayer/client.ts';
import { COOP_REFERENCE_HTML } from '../src/multiplayer/reference-game.ts';

const root = path.resolve('out/multiplayer-qa');
await fs.mkdir(root, { recursive: true });
for (const name of [
  'host-running.json',
  'guest-running.json',
  'host-done.json',
  'guest-done.json',
  'host-failure.txt',
  'guest-failure.txt',
  'finish',
  'host-minimize.json',
])
  await fs.rm(path.join(root, name), { force: true });
await build({
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: 'tests/multiplayer.electron.ts',
    outDir: root,
    emptyOutDir: false,
    target: 'esnext',
    rollupOptions: {
      external: ['electron'],
      output: { format: 'es', entryFileNames: 'main.mjs' },
    },
  },
});
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    lib: {
      entry: 'src/multiplayer-player-preload.ts',
      formats: ['cjs'],
      fileName: () => 'multiplayer-player-preload.cjs',
    },
    outDir: root,
    emptyOutDir: false,
    rollupOptions: { external: ['electron'] },
  },
});
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-play-qa-'));
const server = await createCollaborationServer({
  dataDirectory: data,
  port: 0,
});
const children = [];
try {
  const url = `http://127.0.0.1:${server.port}`,
    gamePath = 'output/prototypes/coop/v001/index.html';
  const created = await CollaborationClient.create(
    url,
    '',
    'host',
    'multiplayer QA',
    {
      'project.md':
        '---\nid: project\ntitle: Multiplayer QA\ntype: idea\nstatus: draft\nsources: []\n---\nQA project',
      [gamePath]: COOP_REFERENCE_HTML,
    },
  );
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'guest',
  );
  const { room } = await PlayClient.control(created.credentials, {
    action: 'create',
    path: gamePath,
    sourceHash: createHash('sha256').update(COOP_REFERENCE_HTML).digest('hex'),
    requestId: randomUUID(),
  });
  for (const [role, user] of [
    ['host', created],
    ['guest', joined],
  ]) {
    const child = spawn(electron, [path.join(root, 'main.mjs')], {
      windowsHide: false,
      stdio: 'pipe',
      env: {
        ...process.env,
        GAMEJAM_QA_ROOT: root,
        GAMEJAM_QA_ROLE: role,
        GAMEJAM_QA_AUTH: JSON.stringify({
          credentials: user.credentials,
          memberId: user.result.state.memberId,
          roomId: room.id,
        }),
      },
    });
    let output = '';
    child.stdout.on('data', (bytes) => (output += bytes));
    child.stderr.on('data', (bytes) => (output += bytes));
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(
              Error(role + ' exited ' + code + '\n' + output.slice(-2500)),
            ),
      );
    });
    done.catch(() => {});
    children.push({ child, done });
  }
  let success = false;
  for (let n = 0; n < 1100; n++) {
    for (const entry of children)
      if (entry.child.exitCode !== null) {
        await entry.done;
        throw Error('QA app exited before coordinator finished.');
      }
    for (const role of ['host', 'guest']) {
      const failure = await fs
        .readFile(path.join(root, role + '-failure.txt'), 'utf8')
        .catch(() => null);
      if (failure) throw Error(failure);
    }
    const ready = await Promise.all(
      ['host-done.json', 'guest-done.json'].map((name) =>
        fs.stat(path.join(root, name)).catch(() => null),
      ),
    );
    if (ready.every(Boolean)) {
      success = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(success, 'independent native clients completed');
  const reports = await Promise.all(
    ['host-running.json', 'guest-running.json', 'host-minimize.json'].map(
      (name) => fs.readFile(path.join(root, name), 'utf8').then(JSON.parse),
    ),
  );
  assert.ok(
    reports[0].score.includes('1/3') && reports[1].score.includes('1/3'),
  );
  assert.equal(reports[0].sandbox, true);
  assert.equal(reports[1].sandbox, true);
  await fs.writeFile(path.join(root, 'finish'), 'done');
  await Promise.all(children.map((c) => c.done));
  console.log(
    'PASS: 2 independent native Electron apps, real authenticated server, shared pickup, solo/multi validation, opaque sandbox, 60s host minimization.',
  );
} finally {
  for (const entry of children)
    if (entry.child.exitCode === null) entry.child.kill();
  await server.close();
  await fs.rm(data, { recursive: true, force: true });
}
