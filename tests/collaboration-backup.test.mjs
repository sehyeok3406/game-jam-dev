import {
  freezeHostForTransfer,
  stageTransferredHost,
  checkTransferredHost,
  activateTransferredHost,
} from '../src/server/operations/transfer-host.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { SqliteProjectRepository } from '../src/adapters/sqlite/project-repository.ts';
import { LocalBackupTarget } from '../src/adapters/backup/local-target.ts';
import {
  BackupService,
  stoppedDatabaseBackup,
} from '../src/server/operations/backup.ts';
import { restoreBackup } from '../src/server/operations/restore.ts';
import {
  verifyArchive,
  extractArchive,
  writeArchive,
} from '../src/server/operations/archive.ts';
import { MaintenanceGate } from '../src/server/operations/maintenance.ts';
import { acquireWriter } from '../src/server/operations/writer-lock.ts';
import { inspectDatabase } from '../src/server/operations/backup-database.ts';
import {
  fileHash,
  portablePath,
  recoveryPath,
  scanRecoveryFiles,
  diskSpace,
} from '../src/server/operations/backup-files.ts';
import {
  prepareHostMigration,
  checkHostMigration,
  activateHostMigration,
  cancelHostMigration,
} from '../src/server/operations/migrate-host.ts';

const exec = promisify(execFile);
test('backup verifies decoded image checkpoint bytes and refuses missing binary recovery files', async (t) => {
  const f = await fixture(t);
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${f.server.port}`,
    '',
    '관리자',
    '이미지 원본',
    { 'project.md': '# 이미지', 'assets/images/test.png': image },
  );
  const result = await f.backup();
  const destination = path.join(f.root, 'image-restored');
  await restoreBackup(result.archive, destination);
  const restored = await f.open(destination, created.credentials);
  assert.equal(restored.client.files['assets/images/test.png'], image);
  const directory = path.join(f.data, created.credentials.projectId);
  const head = JSON.parse(
    await fs.readFile(path.join(directory, 'head.json'), 'utf8'),
  );
  const filename = path.join(
    directory,
    'checkpoints',
    head.checkpoint,
    'files/assets/images/test.png',
  );
  const bytes = await fs.readFile(filename);
  await fs.writeFile(filename, Buffer.from('corrupt'));
  await assert.rejects(f.backup(), /체크포인트 파일/);
  await fs.writeFile(filename, bytes);
  await fs.unlink(filename);
  await assert.rejects(f.backup(), /누락/);
});
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(t, backupOverrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-backup-test-'));
  const data = path.join(root, 'data'),
    spool = path.join(root, 'spool'),
    target = new LocalBackupTarget(path.join(root, 'remote'));
  const closing = [],
    clients = [],
    persisted = [];
  t.after(async () => {
    for (const client of clients) client.stop();
    for (const close of closing.reverse()) await close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const server = await createCollaborationServer({
    dataDirectory: data,
    port: 0,
    backup: { target, spoolDirectory: spool, ...backupOverrides },
  });
  let live = true;
  closing.push(async () => {
    if (live) await server.close();
  });
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${server.port}`,
    '',
    '관리자',
    '백업 인공 자료',
    { 'project.md': '# 한글 원본' },
  );
  const client = new CollaborationClient(
    created.credentials,
    () => {},
    async () => {
      persisted.push({
        outgoing: structuredClone(client.outgoing),
        offline: structuredClone(client.offline),
      });
    },
  );
  client.accept(created.result);
  clients.push(client);
  const backup = async () => {
    const object = await server.backup.run();
    return { object, archive: path.join(spool, object.key) };
  };
  const open = async (directory, credentials = client.credentials) => {
    const running = await createCollaborationServer({
      dataDirectory: directory,
      port: 0,
    });
    closing.push(() => running.close());
    const restored = new CollaborationClient(
      { ...credentials, serverUrl: `http://127.0.0.1:${running.port}` },
      () => {},
    );
    clients.push(restored);
    await restored.refresh();
    return { running, client: restored };
  };
  return {
    root,
    data,
    spool,
    target,
    server,
    client,
    backup,
    open,
    closing,
    clients,
    persisted,
    stop: async () => {
      await server.close();
      live = false;
    },
  };
}

test('backup/restore preserves DB files/history/receipt, access roles and same-ID replay on a different directory', async (t) => {
  const f = await fixture(t);
  const command = {
    id: randomUUID(),
    propertySyncVersion: 1,
    sessionId: randomUUID(),
    sequence: 1,
    channel: 'documents:create-idea',
    input: { title: '한 번 생성', x: 10, y: 20 },
    revisions: { ...f.client.revisions },
    canvasSheetsVersion: 1,
  };
  const receipt = await f.client.request('command', command);
  await f.client.refresh();
  const joined = await CollaborationClient.join(
    f.client.credentials.serverUrl,
    f.client.credentials.inviteCode,
    '뷰어',
  );
  await f.client.setRole(joined.result.state.memberId, 'viewer');
  const { archive, object } = await f.backup();
  const verified = await verifyArchive(archive);
  assert.equal(verified.sha256, object.sha256);
  assert.equal(
    verified.manifest.projects[0].id,
    f.client.credentials.projectId,
  );
  assert.ok(
    !verified.manifest.files.some((x) =>
      /writer|backup-status|\.codex|auth\.json/.test(x.path),
    ),
  );
  const downloaded = path.join(f.root, 'download.gjbackup');
  await f.target.get(object, downloaded);
  const destination = path.join(f.root, 'restored');
  const report = await restoreBackup(downloaded, destination);
  assert.equal(report.source.archive.sha256, object.sha256);
  const restored = (await f.open(destination)).client;
  assert.deepEqual(restored.files, f.client.files);
  const replay = await restored.request('command', command);
  assert.equal(replay.historyId, receipt.historyId);
  assert.deepEqual(replay.result, receipt.result);
  assert.equal(
    (await restored.history()).length,
    (await f.client.history()).length,
  );
  await assert.rejects(
    CollaborationClient.fetch(
      restored.credentials.serverUrl,
      `/projects/${restored.credentials.projectId}/command`,
      {
        ...command,
        id: randomUUID(),
        sequence: 2,
        filePropertiesVersion: 1,
        documentStatusesVersion: 1,
      },
      joined.credentials.token,
    ),
    /뷰어/,
  );
  await restored.command('documents:create-idea', {
    title: '복원 후 수정',
    x: 30,
    y: 40,
  });
  assert.equal(
    Object.keys(restored.files).length,
    Object.keys(f.client.files).length + 1,
  );
});

test('maintenance waits for accepted operations, rejects new work with 503 and always releases after timeout/failure', async () => {
  const gate = new MaintenanceGate(),
    first = defer(),
    entered = defer();
  const writing = gate.run(async () => {
    entered.resolve();
    await first.promise;
  });
  await entered.promise;
  let copied = false;
  const snapshot = gate.snapshot(
    async () => {},
    async () => {
      copied = true;
    },
  );
  await assert.rejects(
    gate.run(async () => {}),
    { status: 503, code: 'SERVER_MAINTENANCE' },
  );
  assert.equal(copied, false);
  first.resolve();
  await writing;
  await snapshot;
  assert.equal(copied, true);
  const hold = defer(),
    active = gate.run(() => hold.promise);
  await assert.rejects(
    gate.snapshot(
      async () => {},
      async () => {},
      5,
    ),
    /초과/,
  );
  assert.equal(gate.blocked, false);
  hold.resolve();
  await active;
  await assert.rejects(
    gate.snapshot(
      async () => {},
      async () => {
        throw Error('copy failed');
      },
    ),
    /copy failed/,
  );
  await gate.run(async () => {});
});

test('actual server maintenance preserves client outgoing request ID/draft and snapshot excludes rejected writes', async (t) => {
  const f = await fixture(t),
    entered = defer(),
    release = defer(),
    original = SqliteProjectRepository.prototype.backup;
  t.mock.method(
    SqliteProjectRepository.prototype,
    'backup',
    async function (destination) {
      entered.resolve();
      await release.promise;
      return original.call(this, destination);
    },
  );
  f.closing.push(async () => release.resolve());
  const job = f.backup();
  await entered.promise;
  const cached = f.persisted;
  await assert.rejects(
    f.client.command('documents:create-idea', {
      title: '재전송 생성',
      x: 0,
      y: 0,
    }),
  );
  const id = f.client.outgoing.command.id;
  assert.ok(id);
  assert.equal(cached.at(-1).outgoing.command.id, id);
  assert.equal(f.server.backup.status().phase, 'snapshot');
  release.resolve();
  const { archive } = await job;
  const destination = path.join(f.root, 'before-retry');
  await restoreBackup(archive, destination);
  const restored = (await f.open(destination)).client;
  assert.equal(Object.keys(restored.files).length, 1);
  await f.client.refresh();
  assert.equal(f.client.outgoing, null);
  assert.equal(Object.keys(f.client.files).length, 2);
  const db = new DatabaseSync(path.join(f.data, 'sync.sqlite'), {
    readOnly: true,
  });
  const p = JSON.parse(
    db
      .prepare('SELECT value FROM projects WHERE id=?')
      .get(f.client.credentials.projectId).value,
  );
  assert.equal(p.applied.filter((x) => x.id === id).length, 1);
  db.close();
});

test('backup upload runs after writes resume; upload failure is visible and local/remote retention are bounded', async (t) => {
  const f = await fixture(t),
    entered = defer(),
    release = defer(),
    put = f.target.put.bind(f.target);
  t.mock.method(f.target, 'put', async (...args) => {
    entered.resolve();
    await release.promise;
    return put(...args);
  });
  const job = f.backup();
  await entered.promise;
  await f.client.command('documents:create-idea', {
    title: '업로드 중 수정',
    x: 0,
    y: 0,
  });
  release.resolve();
  await job;
  t.mock.method(f.target, 'put', async () => {
    throw Error('upload-offline');
  });
  for (let i = 0; i < 3; i++)
    await assert.rejects(f.backup(), /upload-offline/);
  const status = JSON.parse(
    await fs.readFile(path.join(f.spool, 'backup-status.json'), 'utf8'),
  );
  assert.equal(status.phase, 'failed');
  assert.equal(status.error, 'BACKUP_UPLOAD_FAILED');
  assert.ok(status.lastSuccessAt);
  assert.equal((await new LocalBackupTarget(f.spool).list()).length, 2);
  assert.equal((await f.target.list()).length, 1);
  await f.client.command('documents:create-idea', {
    title: '실패 후 수정',
    x: 0,
    y: 0,
  });
});

test('DB-only acknowledged data backs up despite a failed first checkpoint', async (t) => {
  const f = await fixture(t);
  await f.stop();
  await fs.rm(path.join(f.data, f.client.credentials.projectId), {
    recursive: true,
    force: true,
  });
  const lease = await acquireWriter(f.data),
    service = new BackupService({
      dataDirectory: f.data,
      spoolDirectory: f.spool,
      target: f.target,
      database: stoppedDatabaseBackup(path.join(f.data, 'sync.sqlite')),
      gate: new MaintenanceGate(),
      quiesce: async () => {},
    });
  let object;
  try {
    object = await service.run();
  } finally {
    await service.close();
    lease.release();
  }
  const destination = path.join(f.root, 'db-only');
  await restoreBackup(path.join(f.spool, object.key), destination);
  assert.deepEqual((await f.open(destination)).client.files, f.client.files);
});

test('restored trash directory receives a new verified identity and supports restore/purge without resurrecting tombstones', async (t) => {
  const f = await fixture(t),
    id = f.client.credentials.projectId;
  await f.client.request('trash', {
    typedName: '백업 인공 자료',
    confirmTeam: true,
    expectedVersion: 0,
  });
  const { archive } = await f.backup(),
    destination = path.join(f.root, 'trash-restored');
  const report = await restoreBackup(archive, destination);
  assert.equal(report.transformations.length, 1);
  assert.notEqual(
    report.transformations[0].before,
    report.transformations[0].after,
  );
  const running = await createCollaborationServer({
    dataDirectory: destination,
    port: 0,
  });
  f.closing.push(() => running.close());
  const request = (action, input = {}) =>
    CollaborationClient.fetch(
      `http://127.0.0.1:${running.port}`,
      `/projects/${id}/${action}`,
      input,
      f.client.credentials.token,
    );
  await assert.rejects(request('state'), (e) => e.code === 'PROJECT_TRASHED');
  const restored = await request('trash-restore');
  assert.equal(restored.status, 'active');
  const state = await request('state');
  assert.deepEqual(state.files, f.client.files);
  await request('trash', {
    typedName: '백업 인공 자료',
    confirmTeam: true,
    expectedVersion: restored.version,
  });
  await request('trash-purge', { typedName: '백업 인공 자료' });
  await assert.rejects(request('state'), (e) => e.code === 'PROJECT_PURGED');
});

test('writer lease excludes server/CLI/restore writers and is released on an abrupt owner exit', async (t) => {
  const f = await fixture(t);
  await assert.rejects(acquireWriter(f.data), /사용 중/);
  await assert.rejects(
    createCollaborationServer({ dataDirectory: f.data, port: 0 }),
    /사용 중/,
  );
  await assert.rejects(
    exec(
      process.execPath,
      [
        'scripts/backup-collaboration.mjs',
        '--data',
        f.data,
        '--spool',
        path.join(f.root, 'cli-spool'),
        '--target-dir',
        path.join(f.root, 'cli-target'),
      ],
      { windowsHide: true },
    ),
    /사용 중/,
  );
  const other = path.join(f.root, 'killed-owner'),
    child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {acquireWriter} from './src/server/operations/writer-lock.ts';const lock=await acquireWriter(${JSON.stringify(other)});console.log('LOCKED');setInterval(()=>{},1000);`,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('LOCKED')) resolve();
    });
    child.once('error', reject);
  });
  await assert.rejects(acquireWriter(other), /사용 중/);
  const exited = new Promise((r) => child.once('exit', r));
  child.kill();
  await exited;
  const next = await acquireWriter(other);
  next.release();
});

test('archive rejects truncation, added bytes, corrupt hashes, duplicate/escaping/cross-platform paths and symlinks', async (t) => {
  const f = await fixture(t),
    { archive } = await f.backup(),
    raw = await fs.readFile(archive);
  for (const [name, bytes] of [
    ['truncated', raw.subarray(0, -1)],
    ['added', Buffer.concat([raw, Buffer.from('x')])],
    ['corrupt', Buffer.from(raw)],
  ]) {
    if (name === 'corrupt') bytes[bytes.length - 1] ^= 1;
    const filename = path.join(f.root, name + '.gjbackup');
    await fs.writeFile(filename, bytes);
    await assert.rejects(verifyArchive(filename), /백업|SHA/);
  }
  for (const p of [
    '../outside',
    'C:/outside',
    'a\\b',
    '/absolute',
    'a//b',
    'a/CON',
    'a/trailing.',
    'a/name:stream',
  ])
    assert.throws(() => portablePath(p));
  assert.throws(() => recoveryPath('.codex/auth.json'));
  const stage = await fs.mkdtemp(path.join(f.root, 'extract-'));
  const manifest = await extractArchive(archive, stage);
  await assert.rejects(
    writeArchive(stage, path.join(f.root, 'duplicate.gjbackup'), {
      ...manifest,
      files: [...manifest.files, manifest.files[0]],
    }),
    /중복/,
  );
  await fs.symlink(
    f.root,
    path.join(f.data, f.client.credentials.projectId, 'junction'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(f.backup(), /링크/);
});

test('restore refuses live/nonempty folders; failed restore marker blocks startup without overwriting the source', async (t) => {
  const f = await fixture(t),
    { archive } = await f.backup();
  await assert.rejects(restoreBackup(archive, f.data), /비어/);
  const raw = await fs.readFile(archive),
    corrupt = path.join(f.root, 'bad.gjbackup');
  raw[raw.length - 1] ^= 1;
  await fs.writeFile(corrupt, raw);
  const dest = path.join(f.root, 'failed');
  await assert.rejects(restoreBackup(corrupt, dest), /SHA/);
  await assert.rejects(
    createCollaborationServer({ dataDirectory: dest, port: 0 }),
    /복원이 완료되지/,
  );
  assert.deepEqual(
    (await f.client.request('state', { knownRevision: undefined })).files,
    f.client.files,
  );
  await assert.rejects(diskSpace(f.root, Number.MAX_SAFE_INTEGER), /공간/);
});

test('migration freezes the source, checks isolated sessions and activates exactly one authority', async (t) => {
  const f = await fixture(t);
  await f.stop();
  const destination = path.join(f.root, 'new-host');
  const prepared = await prepareHostMigration({
    source: f.data,
    destination,
    spoolDirectory: f.spool,
    target: f.target,
  });
  await assert.rejects(
    createCollaborationServer({ dataDirectory: f.data, port: 0 }),
    /이전/,
  );
  await assert.rejects(
    createCollaborationServer({ dataDirectory: destination, port: 0 }),
    /이전/,
  );
  await checkHostMigration(
    f.data,
    destination,
    prepared.migrationId,
    async (url) => {
      const c = new CollaborationClient(
        { ...f.client.credentials, serverUrl: url },
        () => {},
      );
      f.clients.push(c);
      await c.refresh();
      assert.deepEqual(c.files, f.client.files);
      await c.command('documents:create-idea', {
        title: '이전 검증',
        x: 0,
        y: 0,
      });
      assert.equal((await c.history()).length, 1);
    },
  );
  await activateHostMigration(f.data, destination, prepared.migrationId);
  await assert.rejects(
    createCollaborationServer({ dataDirectory: f.data, port: 0 }),
    /이전/,
  );
  await assert.rejects(
    cancelHostMigration(f.data, destination, prepared.migrationId),
    /활성화/,
  );
  const restored = (await f.open(destination)).client;
  assert.equal(Object.keys(restored.files).length, 2);
});

test('migration cancellation only reopens the source while the staged destination stays blocked', async (t) => {
  const f = await fixture(t);
  await f.stop();
  const destination = path.join(f.root, 'cancel-target');
  const p = await prepareHostMigration({
    source: f.data,
    destination,
    spoolDirectory: f.spool,
    target: f.target,
  });
  await checkHostMigration(f.data, destination, p.migrationId);
  await assert.rejects(
    activateHostMigration(f.data, destination, p.migrationId),
    /검증/,
  );
  await cancelHostMigration(f.data, destination, p.migrationId);
  await assert.rejects(
    createCollaborationServer({ dataDirectory: destination, port: 0 }),
    /이전/,
  );
  assert.deepEqual((await f.open(f.data)).client.files, f.client.files);
});

test('stopped-server CLI backs up, verifies and restores an archive with no credentials on the command line', async (t) => {
  const f = await fixture(t);
  await f.stop();
  const result = await exec(
    process.execPath,
    [
      'scripts/backup-collaboration.mjs',
      '--data',
      f.data,
      '--spool',
      f.spool,
      '--target-dir',
      path.join(f.root, 'cli-target'),
    ],
    { windowsHide: true },
  );
  const object = JSON.parse(result.stdout),
    archive = path.join(f.spool, object.key);
  await exec(
    process.execPath,
    ['scripts/verify-collaboration-backup.mjs', '--archive', archive],
    { windowsHide: true },
  );
  const destination = path.join(f.root, 'cli-restored');
  await exec(
    process.execPath,
    [
      'scripts/restore-collaboration.mjs',
      '--archive',
      archive,
      '--destination',
      destination,
    ],
    { windowsHide: true },
  );
  assert.equal(
    inspectDatabase(path.join(destination, 'sync.sqlite')).summaries[0].id,
    f.client.credentials.projectId,
  );
  assert.deepEqual((await fileHash(archive)).sha256, object.sha256);
  assert.ok((await scanRecoveryFiles(destination)).files.length > 0);
});

async function stoppedArchive(f) {
  const writer = await acquireWriter(f.data),
    service = new BackupService({
      dataDirectory: f.data,
      spoolDirectory: f.spool,
      target: f.target,
      database: stoppedDatabaseBackup(path.join(f.data, 'sync.sqlite')),
      gate: new MaintenanceGate(),
      quiesce: async () => {},
    });
  try {
    const object = await service.run();
    return path.join(f.spool, object.key);
  } finally {
    await service.close();
    writer.release();
  }
}

test('restored interrupted trashing/restoring/purging phases resume without overwriting another folder or resurrecting a purge', async (t) => {
  for (const phase of ['trashing', 'restoring', 'purging']) {
    const f = await fixture(t),
      id = f.client.credentials.projectId;
    await f.client.request('trash', {
      typedName: '백업 인공 자료',
      confirmTeam: true,
      expectedVersion: 0,
    });
    await f.stop();
    const db = new DatabaseSync(path.join(f.data, 'sync.sqlite'));
    const p = JSON.parse(
      db.prepare('SELECT value FROM projects WHERE id=?').get(id).value,
    );
    p.lifecycle.status = phase;
    const retained = path.join(
      f.data,
      '.project-trash',
      p.lifecycle.trashId,
      'project',
    );
    if (phase === 'restoring') await fs.rename(retained, path.join(f.data, id));
    if (phase === 'purging')
      await fs.rm(retained, { recursive: true, force: true });
    db.prepare('UPDATE projects SET value=? WHERE id=?').run(
      JSON.stringify(p),
      id,
    );
    db.close();
    const archive = await stoppedArchive(f),
      destination = path.join(f.root, 'phase-restored');
    await restoreBackup(archive, destination);
    const running = await createCollaborationServer({
      dataDirectory: destination,
      port: 0,
    });
    f.closing.push(() => running.close());
    const request = (action, input = {}) =>
      CollaborationClient.fetch(
        `http://127.0.0.1:${running.port}`,
        `/projects/${id}/${action}`,
        input,
        f.client.credentials.token,
      );
    if (phase === 'purging')
      await assert.rejects(
        request('state'),
        (e) => e.code === 'PROJECT_PURGED',
      );
    else if (phase === 'trashing') {
      assert.equal((await request('lifecycle')).status, 'trashed');
      await request('trash-restore');
      assert.deepEqual((await request('state')).files, f.client.files);
    } else assert.deepEqual((await request('state')).files, f.client.files);
  }
});

test('restored active AI lease expires once while queued reservations and run IDs remain durable', async (t) => {
  const f = await fixture(t),
    input = {
      kind: 'implement',
      inputPaths: ['project.md'],
      x: 0,
      y: 0,
      htmlResult: { mode: 'new' },
      queueVersion: 1,
    };
  const one = await f.client.command('tasks:create', input),
    two = await f.client.command('tasks:create', input);
  const first = await f.client.enqueueAi({
    taskPath: one.relativePath,
    providerId: 'codex-cli',
    modelId: null,
  });
  const second = await f.client.enqueueAi({
    taskPath: two.relativePath,
    providerId: 'codex-cli',
    modelId: null,
  });
  await f.client.claimAi(first.taskId);
  const { archive } = await f.backup(),
    destination = path.join(f.root, 'ai-restored');
  await restoreBackup(archive, destination);
  const restored = (await f.open(destination)).client;
  assert.equal(restored.state.aiRun.status, 'failed');
  const queue = restored.state.aiQueue;
  assert.equal(queue.find((x) => x.taskId === first.taskId).status, 'failed');
  assert.equal(queue.find((x) => x.taskId === first.taskId).runId, first.runId);
  assert.equal(queue.find((x) => x.taskId === second.taskId).status, 'queued');
  assert.equal(
    queue.find((x) => x.taskId === second.taskId).runId,
    second.runId,
  );
  assert.equal(
    Object.keys(restored.files).filter((x) => x.endsWith('.html')).length,
    0,
  );
  const revision = restored.state.revision;
  await restored.refresh();
  assert.equal(restored.state.revision, revision);
});

test('retention keeps only verified recent objects and a configured scheduler runs inside the server', async (t) => {
  const f = await fixture(t, { retention: 1, localRetention: 2 });
  const a = f.server.backup.run(),
    b = f.server.backup.run();
  assert.equal(a, b);
  await a;
  await f.backup();
  const last = await f.backup();
  const remote = await f.target.list();
  assert.equal(remote.length, 1);
  assert.equal(remote[0].key, last.object.key);
  assert.equal((await new LocalBackupTarget(f.spool).list()).length, 2);
  const scheduled = await fixture(t, { intervalMs: 300 });
  const until = Date.now() + 5000;
  while (
    Date.now() < until &&
    scheduled.server.backup.status().phase !== 'complete'
  )
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(scheduled.server.backup.status().phase, 'complete');
});

test('host credentials are excluded and unexpected checkpoint files fail closed rather than being uploaded', async (t) => {
  const f = await fixture(t),
    secret = 'PERSONAL_AUTH_MUST_NEVER_LEAVE_THE_HOST';
  await fs.mkdir(path.join(f.data, '.codex'));
  await fs.writeFile(path.join(f.data, '.codex', 'auth.json'), secret);
  const first = await f.backup();
  assert.equal(
    (await fs.readFile(first.archive)).includes(Buffer.from(secret)),
    false,
  );
  const folder = path.join(f.data, f.client.credentials.projectId),
    head = JSON.parse(
      await fs.readFile(path.join(folder, 'head.json'), 'utf8'),
    );
  const unexpected = path.join(
    folder,
    'checkpoints',
    head.checkpoint,
    'files',
    '.codex',
  );
  await fs.mkdir(unexpected);
  await fs.writeFile(path.join(unexpected, 'auth.json'), secret);
  await assert.rejects(f.backup(), /등록되지 않은/);
  assert.equal((await f.target.list()).length, 1);
});

test('version 0 backup stays read-only until restored server startup migrates the destination', async (t) => {
  const f = await fixture(t);
  await f.stop();
  let db = new DatabaseSync(path.join(f.data, 'sync.sqlite'));
  db.exec('PRAGMA user_version=0; DROP TABLE schema_migrations');
  db.close();
  const archive = await stoppedArchive(f);
  assert.equal((await verifyArchive(archive)).manifest.schemaVersion, 0);
  db = new DatabaseSync(path.join(f.data, 'sync.sqlite'), { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  db.close();
  const dest = path.join(f.root, 'v0-restored');
  await restoreBackup(archive, dest);
  assert.deepEqual((await f.open(dest)).client.files, f.client.files);
  db = new DatabaseSync(path.join(dest, 'sync.sqlite'), { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  db.close();
});

test('purged projects keep tombstones but stale exported private contents are omitted from a new backup', async (t) => {
  const f = await fixture(t),
    id = f.client.credentials.projectId;
  const old = path.join(f.root, 'old-export');
  await fs.cp(path.join(f.data, id), old, { recursive: true });
  await f.client.request('trash', {
    typedName: '백업 인공 자료',
    confirmTeam: true,
    expectedVersion: 0,
  });
  await f.client.request('trash-purge', { typedName: '백업 인공 자료' });
  await fs.cp(old, path.join(f.data, id), { recursive: true });
  const { archive } = await f.backup(),
    manifest = (await verifyArchive(archive)).manifest;
  assert.ok(manifest.tombstones.some(([key]) => key === id));
  assert.equal(
    manifest.files.some((file) => file.path.startsWith(id + '/')),
    false,
  );
  const dest = path.join(f.root, 'purged-restored');
  await restoreBackup(archive, dest);
  const running = await createCollaborationServer({
    dataDirectory: dest,
    port: 0,
  });
  f.closing.push(() => running.close());
  await assert.rejects(
    CollaborationClient.fetch(
      `http://127.0.0.1:${running.port}`,
      `/projects/${id}/state`,
      {},
      f.client.credentials.token,
    ),
    (e) => e.code === 'PROJECT_PURGED',
  );
});

test('untrusted archive manifests cannot extract traversal paths or duplicate entries', async (t) => {
  const f = await fixture(t),
    { archive } = await f.backup(),
    raw = await fs.readFile(archive),
    magic = Buffer.from('GAMEJAM-BACKUP/1\n'),
    length = raw.readUInt32BE(magic.length);
  const manifest = JSON.parse(
      raw.subarray(magic.length + 4, magic.length + 4 + length),
    ),
    payload = raw.subarray(magic.length + 4 + length);
  for (const [name, mutate] of [
    [
      'escape',
      (m) => {
        m.files[0].path = '../outside';
      },
    ],
    [
      'duplicate',
      (m) => {
        m.directories.push(m.directories[0]);
      },
    ],
    [
      'absolute',
      (m) => {
        m.files[0].path = 'C:/outside';
      },
    ],
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    const json = Buffer.from(JSON.stringify(changed)),
      size = Buffer.alloc(4);
    size.writeUInt32BE(json.length);
    const filename = path.join(f.root, name + '.gjbackup');
    await fs.writeFile(filename, Buffer.concat([magic, size, json, payload]));
    await assert.rejects(verifyArchive(filename), /경로|중복/);
  }
  assert.equal(
    await fs.stat(path.join(f.root, 'outside')).catch(() => null),
    null,
  );
});

test('cross-host handoff uses a verified archive digest without requiring a shared source path', async (t) => {
  const f = await fixture(t);
  await f.stop();
  const { handoff } = await freezeHostForTransfer({
    source: f.data,
    spoolDirectory: f.spool,
    target: f.target,
  });
  assert.equal(JSON.stringify(handoff).includes(f.data), false);
  await assert.rejects(
    createCollaborationServer({ dataDirectory: f.data, port: 0 }),
    /이전/,
  );
  const archive = path.join(f.spool, handoff.backup.key),
    dest = path.join(f.root, 'other-host');
  await assert.rejects(
    stageTransferredHost(archive, dest, {
      ...handoff,
      backup: { ...handoff.backup, sha256: '0'.repeat(64) },
    }),
    /지문/,
  );
  await stageTransferredHost(archive, dest, handoff);
  await checkTransferredHost(dest, handoff.migrationId, async (url) => {
    const c = new CollaborationClient(
      { ...f.client.credentials, serverUrl: url },
      () => {},
    );
    f.clients.push(c);
    await c.refresh();
    await c.command('documents:create-idea', {
      title: '다른 호스트 수정 검사',
      x: 0,
      y: 0,
    });
    assert.equal((await c.history()).length, 1);
  });
  await assert.rejects(
    activateTransferredHost(dest, handoff.migrationId, {
      sourceFrozen: false,
      sessionsVerified: true,
    }),
    /동결/,
  );
  await activateTransferredHost(dest, handoff.migrationId, {
    sourceFrozen: true,
    sessionsVerified: true,
  });
  assert.equal(Object.keys((await f.open(dest)).client.files).length, 2);
  await assert.rejects(
    createCollaborationServer({ dataDirectory: f.data, port: 0 }),
    /이전/,
  );
});

test('temporary maintenance keeps an active client AI lease for heartbeat retry after the snapshot', async (t) => {
  const f = await fixture(t),
    task = await f.client.command('tasks:create', {
      kind: 'implement',
      inputPaths: ['project.md'],
      x: 0,
      y: 0,
      htmlResult: { mode: 'new' },
      queueVersion: 1,
    });
  const queued = await f.client.enqueueAi({
    taskPath: task.relativePath,
    providerId: 'codex-cli',
    modelId: null,
  });
  await f.client.claimAi(queued.taskId);
  const lease = f.client.lease;
  assert.ok(lease);
  const entered = defer(),
    release = defer(),
    original = SqliteProjectRepository.prototype.backup;
  f.closing.push(async () => release.resolve());
  t.mock.method(
    SqliteProjectRepository.prototype,
    'backup',
    async function (destination) {
      entered.resolve();
      await release.promise;
      return original.call(this, destination);
    },
  );
  const job = f.backup();
  await entered.promise;
  await assert.rejects(
    f.client.refresh(),
    (error) => error.details?.status === 503,
  );
  assert.equal(f.client.lease, lease);
  release.resolve();
  await job;
  await f.client.refresh();
  assert.equal(f.client.lease, lease);
  assert.equal(
    f.client.state.aiQueue.find((x) => x.taskId === queued.taskId).status,
    'starting',
  );
});
