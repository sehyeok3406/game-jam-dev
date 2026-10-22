import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { LocalBackupTarget } from '../src/adapters/backup/local-target.ts';
import { inspectDatabase } from '../src/server/operations/backup-database.ts';

// Only synthetic, ephemeral credentials and content. No operator environment or S3.
assert.equal(
  process.platform,
  'win32',
  'The producer must execute on actual Windows',
);
const { values } = parseArgs({ options: { output: { type: 'string' } } });
const output = path.resolve(values.output ?? 'out/ci/windows-backup');
await fs.mkdir(output, { recursive: true });
assert.equal(
  (await fs.readdir(output)).length,
  0,
  'Fixture output must be a new empty directory',
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-ci-windows-'));
const spool = path.join(root, 'spool');
const dataDirectory = path.join(root, 'data');
const server = await createCollaborationServer({
  dataDirectory,
  port: 0,
  backup: {
    target: new LocalBackupTarget(path.join(root, 'remote')),
    spoolDirectory: spool,
  },
});
const url = `http://127.0.0.1:${server.port}`;
const clients = [];
try {
  const files = {
    'project.md': '---\nid: project\ntitle: Windows 원본\n---\n한글 복구 내용',
    'ideas/한글.md': '---\nid: korean\ntitle: 문서\n---\n원문',
    'assets/images/test.png':
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  };
  const owner = await CollaborationClient.create(
    url,
    '',
    '관리자',
    'Windows 복원 fixture',
    files,
  );
  const viewer = await CollaborationClient.join(
    url,
    owner.result.code,
    '조회자',
  );
  const admin = new CollaborationClient(owner.credentials, () => {});
  clients.push(admin);
  admin.accept(owner.result);
  await admin.refresh();
  await admin.setRole(viewer.result.state.memberId, 'viewer');
  await admin.command('documents:create-idea', { x: 10, y: 20 });
  await admin.refresh();
  const command = {
    id: randomUUID(),
    sessionId: randomUUID(),
    sequence: 1,
    propertySyncVersion: 1,
    canvasSheetsVersion: 1,
    documentStatusesVersion: 1,
    filePropertiesVersion: 1,
    properties: structuredClone(admin.properties),
    revisions: { ...admin.revisions },
    channel: 'documents:create-idea',
    input: { x: 30, y: 40 },
  };
  const receipt = await admin.request('command', command);
  admin.accept(receipt);
  const taskInput = {
    kind: 'implement',
    inputPaths: ['project.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new' },
    queueVersion: 1,
  };
  const task1 = await admin.command('tasks:create', taskInput),
    task2 = await admin.command('tasks:create', taskInput);
  const first = await admin.enqueueAi({
    taskPath: task1.relativePath,
    providerId: 'codex-cli',
    modelId: null,
  });
  const second = await admin.enqueueAi({
    taskPath: task2.relativePath,
    providerId: 'codex-cli',
    modelId: null,
  });
  assert.ok((await admin.claimAi(first.taskId)).lease);
  const trash = await CollaborationClient.create(
    url,
    '',
    '관리자',
    'Windows 휴지통',
    files,
  );
  const trashClient = new CollaborationClient(trash.credentials, () => {});
  clients.push(trashClient);
  trashClient.accept(trash.result);
  const trashed = await trashClient.request('trash', {
    typedName: 'Windows 휴지통',
    confirmTeam: true,
    expectedVersion: 0,
  });
  assert.equal(trashed.status, 'trashed');
  const purge = await CollaborationClient.create(
    url,
    '',
    '관리자',
    'Windows 삭제',
    files,
  );
  const purgeClient = new CollaborationClient(purge.credentials, () => {});
  clients.push(purgeClient);
  purgeClient.accept(purge.result);
  // Preserve an old export outside the archive to challenge Linux startup's tombstone guard.
  await fs.cp(
    path.join(dataDirectory, purge.credentials.projectId),
    path.join(output, 'stale-checkpoint'),
    { recursive: true },
  );
  await purgeClient.request('trash', {
    typedName: 'Windows 삭제',
    confirmTeam: true,
    expectedVersion: 0,
  });
  await purgeClient.request('trash-purge', { typedName: 'Windows 삭제' });
  const source = inspectDatabase(path.join(dataDirectory, 'sync.sqlite'));
  const sourceMain = source.projects.find(
    (project) => project.id === owner.credentials.projectId,
  );
  const sourceTrash = source.projects.find(
    (project) => project.id === trash.credentials.projectId,
  );
  assert.equal(
    sourceMain.applied.filter((entry) => entry.id === command.id).length,
    1,
  );
  assert.ok(
    ['starting', 'running'].includes(
      sourceMain.aiQueue.find((task) => task.taskId === first.taskId).status,
    ),
  );
  assert.equal(
    sourceMain.aiQueue.find((task) => task.taskId === second.taskId).status,
    'queued',
  );
  const object = await server.backup.run();
  await fs.copyFile(
    path.join(spool, object.key),
    path.join(output, object.key),
  );
  await fs.writeFile(
    path.join(output, 'expected.json'),
    JSON.stringify(
      {
        schema: 2,
        sourcePlatform: process.platform,
        node: process.versions.node,
        archive: object.key,
        sha256: object.sha256,
        owner: { credentials: owner.credentials },
        viewer: { credentials: viewer.credentials },
        files: sourceMain.files,
        history: sourceMain.history,
        revision: sourceMain.revision,
        ai: {
          running: sourceMain.aiQueue.find(
            (task) => task.taskId === first.taskId,
          ),
          queued: sourceMain.aiQueue.find(
            (task) => task.taskId === second.taskId,
          ),
          job: sourceMain.job,
        },
        replay: {
          command,
          result: receipt.result,
          historyId: receipt.historyId,
        },
        trash: {
          credentials: trash.credentials,
          files: sourceTrash.files,
          lifecycle: sourceTrash.lifecycle,
        },
        purged: {
          credentials: purge.credentials,
          version: new Map(source.tombstones).get(purge.credentials.projectId),
        },
      },
      null,
      2,
    ),
  );
  console.log('Generated synthetic Windows archive for cross-OS verification');
} finally {
  clients.forEach((c) => c.stop());
  await server.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('gamejam-ci-windows-'));
  await fs.rm(root, { recursive: true, force: true });
}
