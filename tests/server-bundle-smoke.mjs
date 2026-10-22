import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { CollaborationClient } from '../src/collaboration-client.ts';
import {
  stoppedDatabaseBackup,
  BackupService,
} from '../src/server/operations/backup.ts';
import { MaintenanceGate } from '../src/server/operations/maintenance.ts';
import { LocalBackupTarget } from '../src/adapters/backup/local-target.ts';
import { restoreBackup } from '../src/server/operations/restore.ts';
import { measureServerLoad } from './server-load.mjs';
import { fileHash } from '../src/server/operations/backup-files.ts';
import {
  exerciseRecoveryWarnings,
  assertRecoveryWarnings,
} from './recovery-warnings.mjs';
import {
  assertWindowsFixture,
  assertTransferredSnapshot,
  verifyTransferredRuntime,
} from './transferred-backup.mjs';

export async function verifyServerBundle({
  bundle,
  node = process.execPath,
  windowsFixture,
  load = false,
}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-server-bundle-'),
  );
  const executable = path.join(root, 'server.mjs');
  await fs.copyFile(bundle, executable); // Outside the repository, without node_modules.
  const windowsHarness = path.join(root, 'signal-harness.mjs');
  if (process.platform === 'win32')
    await fs.writeFile(
      windowsHarness,
      "process.on('message', message => { if (message === 'test-sigterm') process.emit('SIGTERM'); });\nawait import('./server.mjs');\n",
    );
  const data = path.join(root, 'data'),
    key = randomUUID(),
    children = [],
    clients = [];
  let logs = '',
    stdout = '',
    stderr = '';
  async function until(check, label, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw Error('Server bundle timeout: ' + label);
  }
  async function boot(directory) {
    const reservation = net.createServer();
    await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    const env = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME'])
      if (process.env[name]) env[name] = process.env[name];
    Object.assign(env, {
      GAME_CANVAS_DATA: directory,
      GAME_CANVAS_HOST: '127.0.0.1',
      PORT: String(port),
      GAME_CANVAS_SERVER_KEY: key,
      GAME_CANVAS_PUBLIC: '1',
      GAMEJAM_SERVICE_MODE: 'managed-beta',
    });
    const child = spawn(
      node,
      [process.platform === 'win32' ? windowsHarness : executable],
      {
        cwd: root,
        env,
        windowsHide: true,
        stdio:
          process.platform === 'win32'
            ? ['ignore', 'pipe', 'pipe', 'ipc']
            : ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(child);
    child.on('error', (error) => {
      logs += error.code;
    });
    child.stdout.on('data', (chunk) => {
      logs += chunk.toString();
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      logs += chunk.toString();
      stderr += chunk.toString();
    });
    const url = `http://127.0.0.1:${port}`;
    await until(async () => {
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error('Server bundle exited before readiness');
      return fetch(url + '/ready')
        .then((r) => r.status === 200)
        .catch(() => false);
    }, 'ready');
    return { child, url };
  }
  async function stop(child, graceful = true) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    if (graceful && process.platform === 'win32') child.send('test-sigterm');
    else child.kill(graceful ? 'SIGTERM' : 'SIGKILL');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 28000);
    try {
      const [code] = await exited;
      if (graceful)
        assert.equal(code, 0, 'SIGTERM must run cleanup successfully');
    } finally {
      clearTimeout(deadline);
    }
  }
  function client(created, url) {
    const c = new CollaborationClient(
      { ...created.credentials, serverUrl: url },
      () => {},
    );
    clients.push(c);
    return c;
  }
  let sse, ws;
  try {
    let running = await boot(data);
    const health = await fetch(running.url + '/health').then((r) => r.json());
    assert.equal(health.protocol, 1);
    const denied = await fetch(running.url + '/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paid: true, selfHost: true }),
    });
    assert.equal(denied.status, 403);
    const recoveryScenario = await exerciseRecoveryWarnings({
      directory: data,
      url: running.url,
      key,
    });
    const files = {
      'project.md': '---\nid: project\ntitle: 한글 프로젝트\n---\n한글 원문\n',
      'ideas/한글.md': '---\nid: ko\ntitle: 한글\n---\n원본',
      'assets/images/sample.png':
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    };
    const created = await CollaborationClient.create(
      running.url,
      key,
      '관리자',
      '번들 검증',
      files,
    );
    const owner = client(created, running.url);
    owner.accept(created.result);
    const joined = await CollaborationClient.join(
      running.url,
      created.result.code,
      '편집자',
    );
    const editor = client(joined, running.url);
    editor.accept(joined.result);
    const viewerJoined = await CollaborationClient.join(
      running.url,
      created.result.code,
      '조회자',
    );
    const viewer = client(viewerJoined, running.url);
    viewer.accept(viewerJoined.result);
    await owner.refresh();
    await owner.setRole(viewer.state.memberId, 'viewer');
    await viewer.refresh();
    await assert.rejects(
      viewer.command('documents:create-idea', { x: 1, y: 2 }),
      /뷰어/,
    );
    sse = new AbortController();
    const response = await fetch(
      `${running.url}/projects/${created.credentials.projectId}/events`,
      {
        headers: { Authorization: `Bearer ${created.credentials.token}` },
        signal: sse.signal,
      },
    );
    assert.equal(response.status, 200);
    let frames = '';
    const stream = (async () => {
      try {
        for await (const bytes of response.body)
          frames += Buffer.from(bytes).toString();
      } catch (error) {
        if (!sse.signal.aborted) throw error;
      }
    })();
    ws = new WebSocket(
      `${running.url.replace('http', 'ws')}/projects/${created.credentials.projectId}/play-socket`,
      { headers: { Authorization: `Bearer ${created.credentials.token}` } },
    );
    await once(ws, 'open');
    await editor.refresh();
    await editor.command('documents:create-idea', { x: 77, y: 88 });
    await owner.refresh();
    await until(
      () =>
        frames.includes(String(owner.state.revision)) &&
        frames.includes('event:'),
      'SSE commit',
    );
    const command = {
      id: randomUUID(),
      sessionId: randomUUID(),
      sequence: 1,
      propertySyncVersion: 1,
      canvasSheetsVersion: 1,
      documentStatusesVersion: 1,
      filePropertiesVersion: 1,
      properties: structuredClone(owner.properties),
      revisions: { ...owner.revisions },
      channel: 'documents:create-idea',
      input: { x: 20, y: 30 },
    };
    const submit = (url) =>
      CollaborationClient.fetch(
        url,
        `/projects/${created.credentials.projectId}/command`,
        command,
        created.credentials.token,
      );
    const receipt = await submit(running.url);
    const loadResult = load
      ? await measureServerLoad(running.url, key)
      : undefined;
    const history = await owner.history();
    sse.abort();
    await stream;
    const wsClosed = once(ws, 'close');
    await stop(running.child);
    await wsClosed;
    const loadStatus = loadResult
      ? JSON.parse(
          await fs.readFile(path.join(data, 'operations-status.json'), 'utf8'),
        )
      : undefined;
    running = await boot(data);
    const replay = await submit(running.url);
    assert.equal(replay.historyId, receipt.historyId);
    assert.deepEqual(replay.result, receipt.result);
    const reconnected = client(created, running.url);
    await reconnected.refresh();
    assert.equal(reconnected.files['ideas/한글.md'], files['ideas/한글.md']);
    assert.equal(
      reconnected.files['assets/images/sample.png'],
      files['assets/images/sample.png'],
    );
    assert.equal((await reconnected.history()).length, history.length);
    // Force loss of the process, then verify the same durable command receipt.
    await stop(running.child, false);
    running = await boot(data);
    assert.equal((await submit(running.url)).historyId, receipt.historyId);
    await stop(running.child);
    const service = new BackupService({
      dataDirectory: data,
      spoolDirectory: path.join(root, 'spool'),
      target: new LocalBackupTarget(path.join(root, 'remote')),
      database: stoppedDatabaseBackup(path.join(data, 'sync.sqlite')),
      gate: new MaintenanceGate(),
      quiesce: async () => {},
    });
    const object = await service.run();
    await service.close();
    const archive = path.join(root, 'spool', object.key);
    const destination = path.join(root, 'restored');
    await restoreBackup(archive, destination);
    running = await boot(destination);
    const restored = client(created, running.url);
    await restored.refresh();
    assert.equal(restored.files['ideas/한글.md'], files['ideas/한글.md']);
    assert.equal((await submit(running.url)).historyId, receipt.historyId);
    const restoredViewer = client(viewerJoined, running.url);
    await restoredViewer.refresh();
    await assert.rejects(
      restoredViewer.command('documents:create-idea', { x: 1, y: 2 }),
      /뷰어/,
    );
    await stop(running.child);
    let windowsFixtureChecks;
    if (windowsFixture) {
      const expected = JSON.parse(
        await fs.readFile(path.join(windowsFixture, 'expected.json'), 'utf8'),
      );
      assertWindowsFixture(expected);
      const transferred = path.join(root, 'windows-restored');
      assert.equal(
        (await fileHash(path.join(windowsFixture, expected.archive))).sha256,
        expected.sha256,
      );
      const report = await restoreBackup(
        path.join(windowsFixture, expected.archive),
        transferred,
      );
      await assertTransferredSnapshot(
        transferred,
        expected,
        report,
        windowsFixture,
      );
      running = await boot(transferred);
      await verifyTransferredRuntime({
        url: running.url,
        directory: transferred,
        expected,
      });
      await stop(running.child);
      running = await boot(transferred);
      windowsFixtureChecks = await verifyTransferredRuntime({
        url: running.url,
        directory: transferred,
        expected,
        restarted: true,
      });
      await stop(running.child);
    }
    const status = JSON.parse(
      await fs.readFile(
        path.join(destination, 'operations-status.json'),
        'utf8',
      ),
    );
    assert.equal(status.ready, false);
    assert.ok(status.diskFreeBytes > 0);
    const records = [stdout, stderr].flatMap((stream) =>
      stream.split(/\r?\n/).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      }),
    );
    assertRecoveryWarnings(
      records.filter((record) => record.event === 'recovery-pending'),
      records.filter((record) => record.event === 'request'),
      recoveryScenario,
    );
    for (const secret of [
      key,
      created.credentials.token,
      joined.credentials.token,
      created.result.code,
      created.result.recoveryKey,
      '한글 원문',
      created.credentials.projectId,
      recoveryScenario.projectId,
      recoveryScenario.token,
      recoveryScenario.body,
    ])
      if (secret)
        assert.ok(
          !logs.includes(secret),
          'Server logs must omit credentials/content/project IDs',
        );
    return {
      platform: process.platform,
      node: process.versions.node,
      isolatedBundle: true,
      health: true,
      readiness: true,
      roles: true,
      sse: true,
      websocket: true,
      receiptRestart: true,
      forcedRestart: true,
      backupRestore: true,
      windowsArchiveRestored: windowsFixture ? process.platform : false,
      windowsFixtureChecks,
      recoveryWarningsRedacted: true,
      logsRedacted: true,
      load: loadResult
        ? {
            ...loadResult,
            rssBytes: loadStatus.rssBytes,
            saveP95Ms: loadStatus.saveP95Ms,
            eventLoopP95Ms: loadStatus.eventLoopP95Ms,
            dbBytes: (await fs.stat(path.join(destination, 'sync.sqlite')))
              .size,
            backupBytes: object.size,
          }
        : undefined,
      sigterm:
        process.platform !== 'win32'
          ? 'passed'
          : 'simulated SIGTERM event via external test harness; real OS signal requires Linux',
      externalS3: false,
      actualRender: false,
    };
  } finally {
    sse?.abort();
    ws?.terminate();
    clients.forEach((c) => c.stop());
    for (const child of children) await stop(child, false);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('gamejam-server-bundle-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}
