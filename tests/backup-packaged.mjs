import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { startBackupS3Server } from './backup-s3-server.mjs';

const exec = promisify(execFile),
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-r09-package-'));
const runtime = path.resolve(
    'out/Game Jam!-win32-x64/resources/self-host-runtime',
  ),
  node = path.join(runtime, 'node.exe'),
  bundle = path.join(runtime, 'server.mjs');
const cert = path.join(root, 'test-ca.pem'),
  key = path.join(root, 'test-key.pem');
await exec(
  'C:/Program Files/Git/usr/bin/openssl.exe',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ],
  { windowsHide: true },
);
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const arrived = defer(),
  release = defer();
const storage = await startBackupS3Server({
  key: await fs.readFile(key),
  cert: await fs.readFile(cert),
  beforePut: async () => {
    arrived.resolve();
    await release.promise;
  },
});
const data = path.join(root, 'original'),
  spool = path.join(root, 'spool'),
  serverKey = randomUUID();
const cleanEnv = { ...process.env, NODE_EXTRA_CA_CERTS: cert };
for (const name of Object.keys(cleanEnv))
  if (name.startsWith('GAMEJAM_BACKUP_')) delete cleanEnv[name];
const backupEnv = {
  ...cleanEnv,
  GAMEJAM_BACKUP_S3_ENDPOINT: storage.url,
  GAMEJAM_BACKUP_S3_BUCKET: 'private-bucket',
  GAMEJAM_BACKUP_S3_REGION: 'test-1',
  GAMEJAM_BACKUP_S3_ACCESS_KEY_ID: 'FAKE_PACKAGE_ACCESS',
  GAMEJAM_BACKUP_S3_SECRET_ACCESS_KEY: 'FAKE_PACKAGE_SECRET',
  GAMEJAM_BACKUP_S3_PREFIX: 'r09-test',
  GAMEJAM_BACKUP_INTERVAL_HOURS: String(1 / 60),
  GAMEJAM_BACKUP_SPOOL: spool,
};
const clients = [],
  children = [];
let stderr = '';
const hash = (raw) => createHash('sha256').update(raw).digest('hex');
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Timeout: ' + label + '\n' + stderr);
}
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill();
    await done;
  }
}
async function boot(directory, env = cleanEnv) {
  const port = await freePort(),
    url = `http://127.0.0.1:${port}`;
  const child = spawn(node, [bundle], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...env,
      GAME_CANVAS_HOST: '127.0.0.1',
      GAME_CANVAS_PORT: String(port),
      GAME_CANVAS_DATA: directory,
      GAME_CANVAS_SERVER_KEY: serverKey,
    },
  });
  children.push(child);
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  await until(async () => {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error('Server exited: ' + stderr);
    return fetch(url + '/health')
      .then((r) => r.ok)
      .catch(() => false);
  }, 'boot');
  return { child, url };
}
async function create(url, name) {
  const created = await CollaborationClient.create(
      url,
      serverKey,
      '검사 관리자',
      name,
      { 'project.md': '# 패키지 백업 한글 원문' },
    ),
    client = new CollaborationClient(created.credentials, () => {});
  client.accept(created.result);
  clients.push(client);
  return client;
}
async function restoreClient(credentials, url) {
  const client = new CollaborationClient(
    { ...credentials, serverUrl: url },
    () => {},
  );
  clients.push(client);
  await client.refresh();
  return client;
}
try {
  const source = await boot(data, backupEnv),
    owner = await create(source.url, '백업 프로젝트');
  const joined = await CollaborationClient.join(
    source.url,
    owner.credentials.inviteCode,
    '검사 뷰어',
  );
  await owner.setRole(joined.result.state.memberId, 'viewer');
  const command = {
    id: randomUUID(),
    propertySyncVersion: 1,
    sessionId: randomUUID(),
    sequence: 1,
    channel: 'documents:create-idea',
    input: { title: '한 번 생성', x: 20, y: 30 },
    revisions: { ...owner.revisions },
    canvasSheetsVersion: 1,
  };
  const receipt = await owner.request('command', command);
  await owner.refresh();
  const taskInput = {
    kind: 'implement',
    inputPaths: ['project.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new' },
    queueVersion: 1,
  };
  const task1 = await owner.command('tasks:create', taskInput),
    task2 = await owner.command('tasks:create', taskInput);
  const first = await owner.enqueueAi({
      taskPath: task1.relativePath,
      providerId: 'codex-cli',
      modelId: null,
    }),
    second = await owner.enqueueAi({
      taskPath: task2.relativePath,
      providerId: 'codex-cli',
      modelId: null,
    });
  await owner.claimAi(first.taskId);
  const trash = await create(source.url, '보관 프로젝트');
  await trash.request('trash', {
    typedName: '보관 프로젝트',
    confirmTeam: true,
    expectedVersion: 0,
  });
  const purge = await create(source.url, '삭제 프로젝트');
  await purge.request('trash', {
    typedName: '삭제 프로젝트',
    confirmTeam: true,
    expectedVersion: 0,
  });
  await purge.request('trash-purge', { typedName: '삭제 프로젝트' });
  await assert.rejects(
    exec(
      node,
      [
        'scripts/backup-collaboration.mjs',
        '--data',
        data,
        '--spool',
        path.join(root, 'blocked-spool'),
        '--target-dir',
        path.join(root, 'blocked-target'),
      ],
      { windowsHide: true, env: cleanEnv },
    ),
    /사용 중/,
  );
  let arrivedFlag = false;
  void arrived.promise.then(() => {
    arrivedFlag = true;
  });
  await until(() => arrivedFlag, 'scheduled upload', 80000);
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(spool, 'backup-status.json'), 'utf8'),
    ).phase,
    'upload',
  );
  const uploadDocument = await owner.command('documents:create-idea', {
    title: '업로드 동안 편집',
    x: 40,
    y: 50,
  });
  release.resolve();
  await until(
    async () =>
      JSON.parse(
        await fs.readFile(path.join(spool, 'backup-status.json'), 'utf8'),
      ).phase === 'complete',
    'verified upload',
  );
  const status = JSON.parse(
      await fs.readFile(path.join(spool, 'backup-status.json'), 'utf8'),
    ),
    object = status.backup,
    bytes = storage.objects.get('r09-test/' + object.key);
  assert.equal(hash(bytes), object.sha256);
  assert.equal(bytes.length, object.size);
  assert.ok(
    storage.requests.some((r) =>
      r.authorization?.includes('FAKE_PACKAGE_ACCESS'),
    ),
  );
  console.log(
    'PASS: final bundled Node/server schedules a TLS S3-protocol upload, verifies SHA-256/size, resumes writes before upload completion and rejects a second writer.',
  );
  await stop(source.child);
  const destination = path.join(root, 'relocated');
  const restoredOutput = await exec(
    node,
    [
      'scripts/restore-collaboration.mjs',
      '--key',
      object.key,
      '--destination',
      destination,
    ],
    { windowsHide: true, env: backupEnv },
  );
  assert.equal(JSON.parse(restoredOutput.stdout).backupId, object.backupId);
  const report = JSON.parse(
    await fs.readFile(path.join(destination, '.restore-report.json'), 'utf8'),
  );
  assert.equal(report.source.archive.sha256, object.sha256);
  assert.ok(report.transformations.some((item) => item.before !== item.after));
  const restored = await boot(destination),
    client = await restoreClient(owner.credentials, restored.url);
  assert.equal(client.files['project.md'], '# 패키지 백업 한글 원문');
  assert.equal(client.files[uploadDocument.relativePath], undefined);
  const replay = await client.request('command', command);
  assert.equal(replay.historyId, receipt.historyId);
  assert.deepEqual(replay.result, receipt.result);
  assert.equal(
    client.state.aiQueue.find((task) => task.taskId === first.taskId).status,
    'failed',
  );
  assert.equal(
    client.state.aiQueue.find((task) => task.taskId === second.taskId).status,
    'queued',
  );
  const viewer = await restoreClient(joined.credentials, restored.url);
  await assert.rejects(
    viewer.command('documents:create-idea', { title: '금지', x: 0, y: 0 }),
    /뷰어/,
  );
  const request = (credentials, action, input = {}) =>
    CollaborationClient.fetch(
      restored.url,
      `/projects/${credentials.projectId}/${action}`,
      input,
      credentials.token,
    );
  await assert.rejects(
    request(trash.credentials, 'state'),
    (e) => e.code === 'PROJECT_TRASHED',
  );
  await request(trash.credentials, 'trash-restore');
  assert.equal(
    (await request(trash.credentials, 'state')).files['project.md'],
    '# 패키지 백업 한글 원문',
  );
  await assert.rejects(
    request(purge.credentials, 'state'),
    (e) => e.code === 'PROJECT_PURGED',
  );
  const restoredDocument = await client.command('documents:create-idea', {
    title: '복구 후 수정',
    x: 60,
    y: 70,
  });
  const restoredDocumentRaw = client.files[restoredDocument.relativePath];
  assert.ok(restoredDocumentRaw);
  await stop(restored.child);
  const restarted = await boot(destination);
  const reconnected = await restoreClient(owner.credentials, restarted.url);
  assert.equal(
    reconnected.files[restoredDocument.relativePath],
    restoredDocumentRaw,
  );
  console.log(
    'PASS: downloaded remote object restores to a new folder; bundled server retains sessions/roles/history/receipts, rebinds trash identity, preserves tombstones, fails an orphan AI lease once, retains queued reservations and survives another restart.',
  );
  storage.objects.set(
    'r09-test/' + object.key,
    Buffer.from('x'.repeat(bytes.length)),
  );
  await assert.rejects(
    exec(
      node,
      ['scripts/verify-collaboration-backup.mjs', '--key', object.key],
      { windowsHide: true, env: backupEnv },
    ),
    /SHA-256|Checksum/,
  );
  console.log(
    'PASS: remote content corruption is rejected before restoration. External S3 accounts and Linux remain unverified.',
  );
  await fs.writeFile(
    'out/r09-package-backup.json',
    JSON.stringify(
      {
        root,
        backupId: object.backupId,
        sha256: object.sha256,
        size: object.size,
        tlsS3Fixture: true,
        scheduledUpload: true,
        liveEditing: true,
        writerExclusion: true,
        restore: true,
        identityRebind: true,
        roles: true,
        receipt: true,
        history: true,
        aiRecovery: true,
        tombstones: true,
        restart: true,
        corruptionRejected: true,
        externalS3: false,
        linux: false,
      },
      null,
      2,
    ),
  );
} finally {
  release.resolve();
  for (const client of clients) client.stop();
  for (const child of children) await stop(child);
  await storage.close();
  await fs.writeFile(path.join(root, 'stderr.log'), stderr);
  console.log('Evidence: ' + root);
}
