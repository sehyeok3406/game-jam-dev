import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import matter from '../src/markdown.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { EditorDraftStore } from '../src/editor-drafts.ts';
import { PropertyQueue } from '../src/property-queue.ts';
import { SyncStore } from '../src/sync-store.ts';
import { CanvasView } from '../src/canvas-view.ts';
import { writeClientCache, readClientCache } from '../src/client-cache.ts';
import { invertEdit } from '../src/edit-journal.ts';
import { planOfflineMerge } from '../src/offline-sync.ts';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const raw = (extra = {}, body = '\n원문  \n\n끝\n') =>
  matter.stringify(body, {
    id: 'a',
    title: '메모',
    type: 'idea',
    x: 80,
    y: 90,
    width: 340,
    height: 300,
    sources: [],
    ...extra,
  });
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'property-sync-'));
  let server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.stop();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(url, '', '관리자', 'test', {
    'ideas/a.md': raw(),
    'output/index.html':
      '<html><body>' + 'x'.repeat(500_000) + '</body></html>',
  });
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    '팀원',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  clients.push(owner, editor);
  return {
    directory,
    url,
    owner,
    editor,
    clients,
    restart: async () => {
      const port = server.port;
      await server.close();
      server = await createCollaborationServer({
        dataDirectory: directory,
        port,
      });
    },
  };
}
test('content lock permits teammate color/position, keeps original whitespace, and detects competing content revisions', async (t) => {
  const { owner, editor } = await setup(t);
  await owner.lock('ideas/a.md');
  const before = matter(owner.files['ideas/a.md']).content;
  await editor.command('documents:set-color', {
    relativePath: 'ideas/a.md',
    color: 'green',
  });
  await editor.command('documents:update-layout', {
    relativePath: 'ideas/a.md',
    x: 700,
    y: 900,
    width: 340,
    height: 300,
    size: false,
  });
  assert.equal(matter(editor.files['ideas/a.md']).content, before);
  await owner.command('documents:save', {
    relativePath: 'ideas/a.md',
    contentRevision: 0,
    title: '새 제목',
    body: '한글 입력 중 계속 작성',
  });
  const confirmed = matter(owner.files['ideas/a.md']);
  assert.equal(confirmed.data.background_color, 'green');
  assert.equal(confirmed.data.x, 700);
  assert.equal(confirmed.content.trim(), '한글 입력 중 계속 작성');
  await assert.rejects(
    owner.command('documents:save', {
      relativePath: 'ideas/a.md',
      contentRevision: 0,
      title: '과거',
      body: '과거 응답',
    }),
    /내용이 변경/,
  );
  await assert.rejects(
    editor.command('documents:delete', {
      relativePath: 'ideas/a.md',
      documentId: 'a',
    }),
    /최신|편집/,
  );
});
test('group undo preserves teammate text/color while content editing is locked; same-group successor conflicts', async (t) => {
  const { owner, editor } = await setup(t);
  await owner.command('documents:update-layout', {
    relativePath: 'ideas/a.md',
    x: 333,
    y: 444,
    width: 340,
    height: 300,
    size: false,
  });
  const historyId = owner.lastCommandHistoryId;
  await editor.refresh();
  await editor.lock('ideas/a.md');
  await editor.command('documents:save', {
    relativePath: 'ideas/a.md',
    title: '팀원 내용',
    body: '팀원의 새 본문',
  });
  await editor.command('documents:set-color', {
    relativePath: 'ideas/a.md',
    color: 'yellow',
  });
  await owner.changeHistory(historyId, 'undo');
  const confirmed = matter(owner.files['ideas/a.md']);
  assert.equal(confirmed.data.x, 80);
  assert.equal(confirmed.data.y, 90);
  assert.equal(confirmed.content.trim(), '팀원의 새 본문');
  assert.equal(confirmed.data.background_color, 'yellow');
  await owner.changeHistory(historyId, 'redo');
  await editor.command('documents:update-layout', {
    relativePath: 'ideas/a.md',
    x: 999,
    y: 999,
    width: 340,
    height: 300,
    size: false,
  });
  await assert.rejects(owner.changeHistory(historyId, 'undo'), /속성|충돌/);
});
test('delta acknowledgements omit unrelated HTML and stable operation IDs survive restart; old clients and stale sequences cannot overwrite', async (t) => {
  const { owner, url, restart } = await setup(t);
  const command = {
    id: randomUUID(),
    propertySyncVersion: 1,
    canvasSheetsVersion: 1,
    sessionId: randomUUID(),
    sequence: 2,
    channel: 'documents:update-layout',
    input: {
      relativePath: 'ideas/a.md',
      x: 200,
      y: 300,
      width: 340,
      height: 300,
      size: false,
    },
    revisions: owner.revisions,
    objects: { 'ideas/a.md': 'a' },
    properties: {},
    deltaVersion: 1,
    knownRevision: owner.state.revision,
  };
  const ack = await owner.request('command', command);
  assert.equal(ack.files, undefined);
  assert.deepEqual(Object.keys(ack.delta.changes), ['ideas/a.md']);
  assert.ok(JSON.stringify(ack).length < 6000);
  owner.accept(ack);
  await restart();
  const replay = await owner.request('command', command);
  assert.equal(replay.historyId, ack.historyId);
  assert.equal((await owner.history()).length, 1);
  await assert.rejects(
    owner.request('command', {
      ...command,
      id: randomUUID(),
      sequence: 1,
      input: { ...command.input, x: 1 },
    }),
    /오래된/,
  );
  await assert.rejects(
    CollaborationClient.fetch(
      url,
      `/projects/${owner.credentials.projectId}/command`,
      {
        id: randomUUID(),
        channel: command.channel,
        input: { ...command.input, x: 1 },
        revisions: owner.revisions,
      },
      owner.credentials.token,
    ),
    /v0.12.0/,
  );
  await owner.command('documents:delete', {
    relativePath: 'ideas/a.md',
    documentId: 'a',
  });
  await owner.restore(owner.lastCommandHistoryId);
  await assert.rejects(
    owner.request('command', {
      ...command,
      id: randomUUID(),
      sequence: 3,
      input: { ...command.input, x: 1 },
    }),
    /생성 버전|소속/,
  );
});
test('SSE refreshes peers without waiting for fallback polling and independent heartbeat renews held text locks', async (t) => {
  const { owner, editor } = await setup(t);
  owner.start();
  await wait(180);
  owner.nextPollAt = Date.now() + 60_000;
  await editor.command('documents:set-color', {
    relativePath: 'ideas/a.md',
    color: 'purple',
  });
  for (
    let i = 0;
    i < 40 &&
    matter(owner.files['ideas/a.md']).data.background_color !== 'purple';
    i++
  )
    await wait(25);
  assert.equal(
    matter(owner.files['ideas/a.md']).data.background_color,
    'purple',
  );
  await owner.lock('ideas/a.md');
  let release;
  const busy = owner.serial(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await wait(0);
  let renewed = false;
  const beat = owner.heartbeat().then(() => {
    renewed = true;
  });
  await wait(80);
  assert.equal(renewed, true, 'lease heartbeat must bypass the command queue');
  release();
  await busy;
  await beat;
  await assert.rejects(editor.lock('ideas/a.md'), /편집 중/);
});
test('local draft copies are atomic and old acknowledgements cannot clear a newer draft; unsent property queue compacts and drains before undo', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'draft-sync-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new EditorDraftStore(directory);
  await store.set('project:a', { title: 'a', body: '새 초안', sequence: 2 }, 2);
  await store.set('project:a', null, 1);
  assert.equal(
    (await new EditorDraftStore(directory).get('project:a')).body,
    '새 초안',
  );
  const queue = new PropertyQueue(),
    writes = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = queue.submit('a:position', async () => {
    writes.push(1);
    await gate;
  });
  await wait(0);
  const second = queue.submit('a:position', async () => writes.push(2));
  const third = queue.submit('a:position', async () => writes.push(3));
  release();
  await queue.flush();
  await Promise.all([first, second, third]);
  assert.deepEqual(writes, [1, 3]);
  await Promise.race([
    queue
      .submit('a:position', async () => 4)
      .then(() => queue.submit('a:position', async () => 5)),
    wait(500).then(() => {
      throw new Error('queue stranded an acknowledgement continuation');
    }),
  ]);
});
test('group merge never combines coordinates or title/body from competing edits; conditional inverse preserves raw untouched body', () => {
  const base = { 'ideas/a.md': raw() };
  const local = { 'ideas/a.md': raw({ x: 100 }) },
    remote = { 'ideas/a.md': raw({ y: 200 }) };
  assert.equal(planOfflineMerge(base, local, remote).conflicts.length, 1);
  const after = { 'ideas/a.md': raw({ x: 100, y: 110 }) },
    current = {
      'ideas/a.md': raw(
        { x: 100, y: 110, background_color: 'green' },
        '새 본문  \n\n',
      ),
    };
  const inverse = invertEdit(current, base, after, 'undo');
  assert.equal(
    matter(inverse['ideas/a.md']).content,
    matter(current['ideas/a.md']).content,
  );
  assert.equal(matter(inverse['ideas/a.md']).data.background_color, 'green');
  assert.equal(
    planOfflineMerge(
      base,
      { 'ideas/a.md': raw({ title: '내 제목' }) },
      { 'ideas/a.md': raw({}, '팀원 본문') },
    ).conflicts.length,
    1,
  );
});
test('canvas delta sends only changed items and client cache reuses large blobs across layout writes', async (t) => {
  const { owner, directory } = await setup(t);
  const view = new CanvasView(),
    first = view.read(
      owner.files,
      owner.revisions,
      owner.properties,
      new Map(),
      {},
    );
  await owner.command('documents:update-layout', {
    relativePath: 'ideas/a.md',
    x: 222,
    y: 333,
    width: 340,
    height: 300,
    size: false,
  });
  const next = view.read(
    owner.files,
    owner.revisions,
    owner.properties,
    new Map(),
    first.signatures,
  );
  assert.equal(next.documents.length, 1);
  assert.equal(next.previews.length, 0);
  const cache = {
    files: owner.files,
    revisions: owner.revisions,
    properties: owner.properties,
    state: owner.state,
  };
  await writeClientCache(directory, cache);
  const bytes = (await fs.stat(path.join(directory, 'server-cache.json'))).size;
  assert.ok(bytes < 6000);
  const restored = await readClientCache(
    path.join(directory, 'server-cache.json'),
  );
  assert.deepEqual(restored.files, owner.files);
});
test('FULL WAL commit recovers acknowledged files/history/request receipts after abrupt process termination before a checkpoint', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wal-crash-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'sync.sqlite'),
    id = randomUUID();
  const source = `import { SyncStore } from ${JSON.stringify(pathToFileURL(path.resolve('src/sync-store.ts')).href)}; const store=new SyncStore(${JSON.stringify(filename)}); store.save({id:${JSON.stringify(id)}, files:{'ideas/a.md':'한글 확정'}, history:[{before:{},after:{'ideas/a.md':'한글 확정'}}], applied:[{id:'same-request'}], revisions:{'ideas/a.md':1}}); console.log('ACK'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let error = '';
  child.stderr.on('data', (chunk) => {
    error += chunk;
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('ACK')) resolve();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null) reject(new Error(error));
    });
  });
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  const store = new SyncStore(filename);
  try {
    const [restored] = store.load();
    assert.equal(restored.files['ideas/a.md'], '한글 확정');
    assert.equal(restored.applied[0].id, 'same-request');
    assert.equal(restored.history[0].after['ideas/a.md'], '한글 확정');
  } finally {
    store.close();
  }
});
