// Run separately from the concurrently executed unit suite: a near-limit real HTTP/DB/backup test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFixture } from './helpers/game-build.mjs';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { LocalBackupTarget } from '../src/adapters/backup/local-target.ts';
import { restoreBackup } from '../src/server/operations/restore.ts';
import { checkSnapshot } from '../src/collaboration-model.ts';
import { GAME_BUILD_INDEX } from '../src/contracts/game-build.ts';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-build-large-'));
let server, reopened, client;
try {
  let f = buildFixture({
    source: 'export const revision = 0;/*' + 'x'.repeat(1_899_950) + '*/',
  });
  for (let n = 1; n < 32; n++)
    f = buildFixture({
      before: f.files,
      artifactId: f.artifact.artifactId,
      source: `export const revision = ${n};/*` + 'x'.repeat(1_899_950) + '*/',
    });
  const bytes = Object.values(f.files).reduce(
    (sum, text) => sum + Buffer.byteLength(text),
    0,
  );
  assert.ok(bytes > 60_000_000 && bytes < 64_000_000);
  checkSnapshot(f.files);
  const over = {
    ...f.files,
    'docs/extra-a.md': 'a'.repeat(1_900_000),
    'docs/extra-b.md': 'b'.repeat(1_900_000),
  };
  assert.throws(() => checkSnapshot(over), /전송 한도/);
  const spool = path.join(root, 'spool');
  server = await createCollaborationServer({
    dataDirectory: path.join(root, 'data'),
    port: 0,
    backup: {
      target: new LocalBackupTarget(path.join(root, 'backups')),
      spoolDirectory: spool,
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    '',
    '관리자',
    '60MB 원본 저장 검사',
    f.files,
  );
  client = new CollaborationClient(created.credentials, () => {});
  client.accept(created.result);
  assert.deepEqual(client.files, f.files);
  const backup = await server.backup.run();
  const restored = path.join(root, 'restored');
  await restoreBackup(path.join(spool, backup.key), restored);
  client.stop();
  await server.close();
  server = null;
  reopened = await createCollaborationServer({
    dataDirectory: restored,
    port: 0,
  });
  client = new CollaborationClient(
    { ...created.credentials, serverUrl: `http://127.0.0.1:${reopened.port}` },
    () => {},
  );
  await client.refresh();
  assert.equal(client.state.connected, true);
  assert.deepEqual(client.files, f.files);
  assert.equal(client.files[GAME_BUILD_INDEX], f.files[GAME_BUILD_INDEX]);
  console.log(
    JSON.stringify({
      snapshotBytes: bytes,
      revisions: 32,
      http: 'passed',
      sqlite: 'passed',
      backupRestore: 'passed',
      rssBytes: process.memoryUsage().rss,
    }),
  );
} finally {
  client?.stop();
  await server?.close();
  await reopened?.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  await fs.rm(root, { recursive: true, force: true });
}
