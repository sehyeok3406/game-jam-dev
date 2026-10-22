import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CollaborationClient } from '../src/collaboration-client.ts';

const source = process.argv.includes('--source');
const runtime = path.resolve(
  'out/Game Jam!-win32-x64/resources/self-host-runtime',
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-r08-runtime-'));
const data = path.join(root, 'data');
await fs.mkdir(data);
const hash = (raw) => createHash('sha256').update(raw).digest('hex');
const id = randomUUID(),
  token = randomUUID(),
  key = randomUUID(),
  memberId = randomUUID();
const files = {
  'project.md': '---\nid: project\ntitle: 인공 원본\n---\n한글 DB 원본\n',
};
const p = {
  id,
  name: 'R08 인공 구형 프로젝트',
  revision: 1,
  files,
  revisions: { 'project.md': 1 },
  members: [
    {
      id: memberId,
      nickname: '인공 관리자',
      role: 'admin',
      owner: true,
      tokenHash: hash(token),
    },
  ],
  inviteHash: hash('LEGACY'),
  inviteExpiresAt: Date.now() + 600000,
  recoveryHash: hash(randomUUID()),
  history: [],
  applied: [],
  job: null,
  lastRun: null,
  authorship: {},
};
const filename = path.join(data, 'sync.sqlite');
const legacy = new DatabaseSync(filename);
legacy.exec(
  'CREATE TABLE blobs(hash TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE projects(id TEXT PRIMARY KEY, value TEXT NOT NULL)',
);
for (const raw of Object.values(files))
  legacy.prepare('INSERT INTO blobs VALUES (?,?)').run(hash(raw), raw);
legacy.prepare('INSERT INTO projects VALUES (?,?)').run(
  id,
  JSON.stringify({
    ...p,
    files: Object.fromEntries(
      Object.entries(files).map(([name, raw]) => [name, hash(raw)]),
    ),
  }),
);
legacy.close();
const reservation = net.createServer();
await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const url = `http://127.0.0.1:${port}`;
let child,
  diagnostic = '';
async function stop() {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
}
async function boot(expectFailure) {
  child = spawn(
    source ? process.execPath : path.join(runtime, 'node.exe'),
    [
      source
        ? path.resolve('src/collaboration-server-entry.ts')
        : path.join(runtime, 'server.mjs'),
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        GAME_CANVAS_HOST: '127.0.0.1',
        GAME_CANVAS_PORT: String(port),
        GAME_CANVAS_DATA: data,
        GAME_CANVAS_SERVER_KEY: key,
      },
    },
  );
  let current = '';
  child.stderr.on('data', (chunk) => {
    current += chunk;
    diagnostic += chunk;
  });
  const expires = Date.now() + 15000;
  while (Date.now() < expires) {
    if (child.exitCode !== null) {
      if (expectFailure) {
        assert.match(current, expectFailure);
        return;
      }
      throw new Error('Server exited: ' + current);
    }
    try {
      const response = await fetch(url + '/health', {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        assert.equal(expectFailure, undefined);
        return;
      }
    } catch {
      /* Await the bounded server startup. */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Startup timeout: ' + current);
}
const client = new CollaborationClient(
  { projectId: id, serverUrl: url, token },
  () => {},
);
const row = () => {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const found = db.prepare('SELECT value FROM projects WHERE id=?').get(id);
    return found ? JSON.parse(found.value) : null;
  } finally {
    db.close();
  }
};
try {
  await boot();
  await client.refresh();
  assert.deepEqual(client.files, files);
  let db = new DatabaseSync(filename);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(
    db.prepare('SELECT count(*) n FROM schema_migrations').get().n,
    1,
  );
  db.close();
  // An actual filesystem failure after COMMIT must still acknowledge and replay once.
  const blocked = path.join(data, id, 'runtime.tmp');
  await fs.mkdir(blocked, { recursive: true });
  const command = {
    id: randomUUID(),
    propertySyncVersion: 1,
    sessionId: randomUUID(),
    sequence: 1,
    channel: 'documents:create-idea',
    input: { title: '한 번만 생성', x: 20, y: 30 },
    revisions: client.revisions,
    canvasSheetsVersion: 1,
  };
  const committed = await client.request('command', command),
    replay = await client.request('command', command);
  assert.deepEqual(replay.result, committed.result);
  assert.equal(replay.historyId, committed.historyId);
  assert.equal(row().applied.filter((r) => r.id === command.id).length, 1);
  assert.equal(row().history.length, 1);
  assert.equal(row().revision, committed.state.revision);
  await fs.rmdir(blocked);
  await stop();
  // The first checkpoint never existed; the DB alone must recover acknowledged content.
  assert.equal(
    await fs.stat(path.join(data, id, 'head.json')).catch(() => null),
    null,
  );
  await boot();
  await client.refresh();
  assert.equal(Object.keys(client.files).length, 2);
  const replayAfterRestart = await client.request('command', command);
  assert.equal(replayAfterRestart.historyId, committed.historyId);
  assert.equal(row().history.length, 1);
  console.log(
    'PASS: legacy version 0 migration, actual post-commit runtime/checkpoint failure, same-ID replay and abrupt restart recover acknowledged files/history/receipts.',
  );
  await fs.writeFile(
    path.join(data, '.project-lifecycle'),
    'blocked marker directory',
  );
  const trashed = await client.request('trash', {
    typedName: p.name,
    confirmTeam: true,
    expectedVersion: 0,
  });
  assert.equal(trashed.status, 'trashed');
  assert.equal(row().lifecycle.status, 'trashed');
  await fs.unlink(path.join(data, '.project-lifecycle'));
  await stop();
  await boot();
  const restored = await client.request('trash-restore');
  assert.equal(restored.status, 'active');
  await client.refresh();
  assert.equal(Object.keys(client.files).length, 2);
  // Preserve an old export solely to challenge the tombstone guard after purge.
  const checkpoint = await fs.readdir(path.join(data, id));
  assert.ok(checkpoint.includes('head.json'));
  await fs.cp(path.join(data, id), path.join(root, 'stale-checkpoint'), {
    recursive: true,
  });
  await client.request('trash', {
    typedName: p.name,
    confirmTeam: true,
    expectedVersion: restored.version,
  });
  await fs.rename(
    path.join(data, '.project-lifecycle'),
    path.join(root, 'saved-markers'),
  );
  await fs.writeFile(
    path.join(data, '.project-lifecycle'),
    'blocked purge marker',
  );
  await client.request('trash-purge', { typedName: p.name });
  assert.equal(row(), null);
  await assert.rejects(
    client.request('state'),
    (e) => e.code === 'PROJECT_PURGED',
  );
  await fs.unlink(path.join(data, '.project-lifecycle'));
  await stop();
  await fs.cp(path.join(root, 'stale-checkpoint'), path.join(data, id), {
    recursive: true,
  });
  await boot();
  await assert.rejects(
    client.request('state'),
    (e) => e.code === 'PROJECT_PURGED',
  );
  assert.equal(row(), null);
  await stop();
  console.log(
    'PASS: lifecycle marker failures preserve committed trash/restore/purge, and a stale checkpoint cannot resurrect a tombstoned project.',
  );
  db = new DatabaseSync(filename);
  db.exec('PRAGMA user_version=999');
  db.close();
  const before = hash(await fs.readFile(filename));
  await boot(/스키마.*999/);
  assert.equal(hash(await fs.readFile(filename)), before);
  console.log(
    'PASS: unsupported future schema stops the actual server before database mutation.',
  );
  assert.match(diagnostic, /복구 파일 재시도 대기/);
  await fs.mkdir('out', { recursive: true });
  await fs.writeFile(
    source ? 'out/r08-source-runtime.json' : 'out/r08-package-runtime.json',
    JSON.stringify(
      {
        source,
        root,
        migration: true,
        postCommitReplay: true,
        restart: true,
        lifecycle: true,
        tombstone: true,
        futureSchema: true,
      },
      null,
      2,
    ),
  );
  console.log('Evidence: ' + root);
} finally {
  client.stop();
  await stop();
  await fs.writeFile(path.join(root, 'server-stderr.log'), diagnostic);
}
