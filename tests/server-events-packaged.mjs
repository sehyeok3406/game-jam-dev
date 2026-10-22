import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CollaborationClient } from '../src/collaboration-client.ts';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-server-events-'));
const runtime = path.resolve(
  'out/Game Jam!-win32-x64/resources/self-host-runtime',
);
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const url = `http://127.0.0.1:${port}`,
  key = randomUUID();
const child = spawn(
  path.join(runtime, 'node.exe'),
  [path.join(runtime, 'server.mjs')],
  {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      GAME_CANVAS_HOST: '127.0.0.1',
      GAME_CANVAS_PORT: String(port),
      GAME_CANVAS_DATA: root,
      GAME_CANVAS_SERVER_KEY: key,
    },
  },
);
let diagnostic = '';
child.stderr.on('data', (chunk) => (diagnostic += chunk.toString()));
const streams = [],
  clients = [];
async function until(check, label, timeout = 15000) {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) {
    if (await check()) return;
    if (child.exitCode !== null) throw Error('Server exited: ' + diagnostic);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error('Timeout: ' + label + '\n' + diagnostic);
}
async function stream(credentials) {
  const controller = new AbortController();
  const response = await fetch(
    `${url}/projects/${credentials.projectId}/events`,
    {
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: controller.signal,
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const state = { frames: [], done: false, controller, task: null };
  streams.push(state);
  state.task = (async () => {
    const decoder = new TextDecoder();
    let pending = '';
    try {
      for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          state.frames.push(pending.slice(0, end));
          pending = pending.slice(end + 2);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      state.done = true;
    }
  })();
  await until(() => state.frames.length >= 2, 'initial events');
  return state;
}
const revisions = (s) =>
  s.frames
    .filter((x) => x.startsWith('data: '))
    .map((x) => JSON.parse(x.slice(6)).revision)
    .filter(Number.isFinite);
async function create(name) {
  const created = await CollaborationClient.create(url, key, '관리자', name, {
    'project.md': `---\nid: project\ntitle: ${name}\n---\n한글 원본\n`,
  });
  const client = new CollaborationClient(created.credentials, () => {});
  client.accept(created.result);
  clients.push(client);
  return client;
}
try {
  await until(async () => {
    try {
      return (await fetch(url + '/health')).ok;
    } catch {
      return false;
    }
  }, 'server ready');
  const owner = await create('first'),
    other = await create('second');
  const joined = await CollaborationClient.join(
    url,
    owner.credentials.inviteCode,
    '편집자',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  clients.push(editor);
  const first = await stream(editor.credentials),
    second = await stream(other.credentials);
  assert.equal(first.frames[0], 'data: {}');
  assert.ok(first.frames[1].startsWith('event: play-lobby\ndata: '));
  const beforeOther = structuredClone(other.files),
    secondCount = second.frames.length;
  await owner.command('documents:create-idea', {
    title: 'SSE 첫 문서',
    x: 10,
    y: 20,
  });
  const revision = owner.state.revision;
  await until(() => revisions(first).includes(revision), 'committed revision');
  assert.equal(second.frames.length, secondCount);
  await other.refresh();
  assert.deepEqual(other.files, beforeOther);
  // Both project queues stay independent, including their receipts and results.
  await Promise.all([
    owner.command('documents:create-idea', { x: 50, y: 60 }),
    other.command('documents:create-idea', { x: 70, y: 80 }),
  ]);
  await until(
    () => revisions(second).includes(other.state.revision),
    'other project commit',
  );
  const historyBefore = (await owner.history()).length;
  const command = {
    id: randomUUID(),
    propertySyncVersion: 1,
    sessionId: randomUUID(),
    sequence: 1,
    properties: structuredClone(owner.properties),
    canvasSheetsVersion: 1,
    documentStatusesVersion: 1,
    filePropertiesVersion: 1,
    channel: 'documents:create-idea',
    input: { x: 90, y: 100 },
    revisions: { ...owner.revisions },
  };
  const submit = (payload, token = owner.credentials.token) =>
    CollaborationClient.fetch(
      url,
      `/projects/${owner.credentials.projectId}/command`,
      payload,
      token,
    );
  const [receipt, repeated] = await Promise.all([
    submit(command),
    submit(command),
  ]);
  assert.deepEqual(repeated.result, receipt.result);
  assert.equal(repeated.historyId, receipt.historyId);
  assert.equal(repeated.state.revision, receipt.state.revision);
  assert.equal((await owner.history()).length, historyBefore + 1);
  await assert.rejects(
    submit(command, editor.credentials.token),
    /작업 ID가 충돌/,
  );
  // A rejected operation leaves no receipt; fixing the same request ID can succeed.
  const retry = {
    ...command,
    id: randomUUID(),
    sequence: 2,
    channel: 'unsupported:command',
  };
  await assert.rejects(submit(retry), /허용되지 않은/);
  retry.channel = command.channel;
  const recovered = await submit(retry);
  assert.ok(recovered.historyId);
  await owner.refresh();
  await owner.setRole(editor.state.memberId, 'viewer');
  const spoofed = {
    ...command,
    id: randomUUID(),
    memberId: owner.state.memberId,
    role: 'admin',
  };
  await assert.rejects(submit(spoofed, editor.credentials.token), /뷰어/);
  assert.equal((await owner.history()).length, historyBefore + 3); // Two commands and the role change.
  await owner.setRole(editor.state.memberId, 'editor');
  console.log(
    'PASS: packaged project queues preserve concurrent project commits, duplicate receipts, actor collision rejection, corrected retry and server-side role checks despite spoofed payloads.',
  );
  // Abort the real bundled server's SQLite transaction after blob inserts, before
  // the project row is committed. No product fault-injection endpoint is needed.
  await until(
    () => revisions(first).includes(owner.state.revision),
    'role commit received',
  );
  const receivedBefore = [...revisions(first)];
  const db = new DatabaseSync(path.join(root, 'sync.sqlite'));
  const projectId = owner.credentials.projectId;
  assert.match(projectId, /^[a-f0-9-]{36}$/);
  const valueBefore = db
    .prepare('SELECT value FROM projects WHERE id=?')
    .get(projectId).value;
  const blobsBefore = Number(
    db.prepare('SELECT count(*) AS n FROM blobs').get().n,
  );
  const failedCommand = { ...command, id: randomUUID(), sequence: 3 };
  const historyBeforeAbort = (await owner.history()).length;
  try {
    db.exec(
      `CREATE TRIGGER r07_command_abort BEFORE INSERT ON projects WHEN NEW.id='${projectId}' BEGIN SELECT RAISE(ABORT, 'r07-native-commit-abort'); END;`,
    );
    await assert.rejects(submit(failedCommand), /r07-native-commit-abort/);
    assert.equal(
      db.prepare('SELECT value FROM projects WHERE id=?').get(projectId).value,
      valueBefore,
    );
    assert.equal(
      Number(db.prepare('SELECT count(*) AS n FROM blobs').get().n),
      blobsBefore,
    );
    await owner.refresh();
    assert.equal((await owner.history()).length, historyBeforeAbort);
    assert.deepEqual(revisions(first), receivedBefore);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS r07_command_abort');
    db.close();
  }
  const retried = await submit(failedCommand),
    replayed = await submit(failedCommand);
  assert.deepEqual(replayed.result, retried.result);
  assert.equal(replayed.historyId, retried.historyId);
  assert.equal((await owner.history()).length, historyBeforeAbort + 1);
  await until(
    () => revisions(first).includes(retried.state.revision),
    'retry commit event',
  );
  console.log(
    'PASS: bundled server SQLite abort rolls back blobs/project/history/receipt without publishing success; same-ID retry/replay commits and announces once.',
  );
  // Exercise offline publication through the actual packaged route and persistence adapter.
  await owner.refresh();
  await until(
    () => revisions(first).includes(owner.state.revision),
    'before offline commit',
  );
  const offlineInput = {
    id: randomUUID(),
    changes: {
      'project.md': owner.files['project.md'] + '\n오프라인 공동 수정\n',
      'ideas/offline-native.md':
        '---\nid: native-offline\ntitle: 오프라인 파일\n---\n신규 한글 문서\n',
    },
    revisions: { ...owner.revisions },
  };
  const offlineDb = new DatabaseSync(path.join(root, 'sync.sqlite'));
  const offlineRow = () =>
    offlineDb.prepare('SELECT value FROM projects WHERE id=?').get(projectId)
      .value;
  const offlineBefore = offlineRow();
  const offlineBlobs = Number(
    offlineDb.prepare('SELECT count(*) AS n FROM blobs').get().n,
  );
  const offlineFiles = structuredClone(owner.files);
  const offlineHistory = (await owner.history()).length;
  const offlineEvents = [...revisions(first)];
  try {
    offlineDb.exec(
      `CREATE TRIGGER r07_offline_abort BEFORE INSERT ON projects WHEN NEW.id='${projectId}' BEGIN SELECT RAISE(ABORT, 'r07-native-offline-abort'); END;`,
    );
    try {
      await assert.rejects(
        owner.request('offline-sync', offlineInput),
        /r07-native-offline-abort/,
      );
      assert.equal(offlineRow(), offlineBefore);
      assert.equal(
        Number(offlineDb.prepare('SELECT count(*) AS n FROM blobs').get().n),
        offlineBlobs,
      );
      await owner.refresh();
      assert.deepEqual(owner.files, offlineFiles);
      assert.equal((await owner.history()).length, offlineHistory);
      assert.deepEqual(revisions(first), offlineEvents);
    } finally {
      offlineDb.exec('DROP TRIGGER IF EXISTS r07_offline_abort');
    }
    const accepted = await owner.request('offline-sync', offlineInput);
    await until(
      () => revisions(first).includes(accepted.state.revision),
      'offline committed event',
    );
    const publishedEvents = [...revisions(first)];
    const offlineReplay = await owner.request('offline-sync', offlineInput);
    assert.equal(offlineReplay.state.revision, accepted.state.revision);
    assert.deepEqual(revisions(first), publishedEvents);
    assert.equal(
      JSON.parse(offlineRow()).applied.filter(
        (item) => item.id === offlineInput.id,
      ).length,
      1,
    );
    await assert.rejects(
      editor.request('offline-sync', {
        ...offlineInput,
        memberId: owner.state.memberId,
        role: 'admin',
      }),
      /작업 ID가 충돌/,
    );
    await assert.rejects(
      owner.request('offline-sync', {
        ...offlineInput,
        id: randomUUID(),
        changes: { 'project.md': 'stale draft' },
      }),
      /다른 참여자가 변경/,
    );
    await owner.refresh();
    assert.equal((await owner.history()).length, offlineHistory + 1);
    assert.equal(owner.files['project.md'], offlineInput.changes['project.md']);
    assert.equal(
      owner.files['ideas/offline-native.md'],
      offlineInput.changes['ideas/offline-native.md'],
    );
  } finally {
    offlineDb.close();
  }
  console.log(
    'PASS: packaged offline route rolls back SQLite files/blobs/history/receipt with no success SSE; same-ID retry/replay publishes once, rejects actor spoofing and stale revisions, and preserves Unicode documents.',
  );
  await owner.refresh();
  first.controller.abort();
  await first.task;
  // A disconnected subscriber recovers from revision/state, rather than replaying SSE.
  await owner.command('documents:create-idea', {
    title: '끊긴 동안 생성',
    x: 30,
    y: 40,
  });
  await editor.refresh();
  assert.equal(editor.state.revision, owner.state.revision);
  assert.deepEqual(editor.files, owner.files);
  const reconnected = await stream(editor.credentials);
  await owner.setRole(editor.state.memberId, 'removed');
  await until(() => reconnected.done, 'revoked stream heartbeat close');
  const denied = await fetch(
    `${url}/projects/${owner.credentials.projectId}/events`,
    { headers: { Authorization: `Bearer ${editor.credentials.token}` } },
  );
  assert.equal(denied.status, 403);
  await assert.rejects(
    editor.command('documents:create-idea', { title: '금지', x: 0, y: 0 }),
    /권한|참여|인증/,
  );
  assert.equal(second.done, false);
  const blocked = await fetch(url + '/health', {
    headers: { Origin: 'https://example.test' },
  });
  assert.equal(blocked.status, 403);
  console.log(
    'PASS: packaged Node/server preserves SSE frames, project isolation, committed revisions, reconnect fallback and revoked-member closure/denial.',
  );
  console.log('Isolated evidence: ' + root);
} finally {
  for (const client of clients) client.stop();
  for (const s of streams) s.controller.abort();
  await Promise.allSettled(streams.map((s) => s.task));
  if (child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
  await fs.writeFile(path.join(root, 'server-stderr.log'), diagnostic);
}
