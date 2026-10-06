import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  advanceAuthorship,
  rebuildAuthorship,
  resolveAuthorship,
} from '../src/file-authorship.ts';
import { authorLabel } from '../src/author-label.ts';
import { expectedArtifacts } from '../src/ai-artifacts.ts';
import {
  saveHistory,
  materialize,
  captureProject,
  localFileAuthorship,
} from '../src/project-store.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const file = 'ideas/a.md';
const content = (body, id = 'memo-a') =>
  `---\nid: ${id}\ntitle: 메모\ntype: idea\nstatus: draft\nsources: []\ncreated_by: forged\n---\n${body}`;
const entry = (name, time = 100, extra = {}) => ({
  id: `event-${time}`,
  kind: 'user',
  status: 'completed',
  label: '문서 저장',
  actorId: name,
  actorName: name,
  createdAt: time,
  finishedAt: time,
  files: [],
  ...extra,
});

test('creator survives hundreds of edits while last editor follows authoritative actor, not document claims', () => {
  let before = {},
    after = { [file]: content('first') };
  let ledger = advanceAuthorship({}, before, after, entry('작성자'));
  for (let i = 0; i < 350; i++) {
    before = after;
    after = { [file]: content(`edit ${i}`) };
    ledger = advanceAuthorship(ledger, before, after, entry('편집자', 200 + i));
  }
  const info = resolveAuthorship(ledger, file, after[file]);
  assert.equal(info.createdBy.name, '작성자');
  assert.equal(info.lastEditedBy.name, '편집자');
  assert.equal(info.createdAt, 100);
  assert.equal(info.lastEditedAt, 549);
  assert.equal(
    resolveAuthorship(ledger, file, content('external')).lastEditedBy,
    undefined,
  );
  assert.equal(
    resolveAuthorship(ledger, file, content('external')).createdBy.name,
    '작성자',
  );
  assert.deepEqual(
    resolveAuthorship(ledger, file, content('replacement', 'other-id')),
    {},
  );
});

test('restoration preserves original creators, duplication has its own creator and failed AI writes do not claim attribution', () => {
  const initial = { [file]: content('first') };
  let ledger = advanceAuthorship({}, {}, initial, entry('작성자'));
  ledger = advanceAuthorship(ledger, initial, {}, entry('삭제자', 200));
  ledger = advanceAuthorship(
    ledger,
    {},
    initial,
    entry('복원자', 300, { kind: 'restore' }),
  );
  assert.equal(ledger[file].createdBy.name, '작성자');
  assert.equal(ledger[file].lastEditedBy.name, '복원자');
  const copied = 'ideas/copy.md';
  ledger = advanceAuthorship(
    ledger,
    initial,
    { ...initial, [copied]: content('first', 'copy-id') },
    entry('복제자', 400),
  );
  assert.equal(ledger[copied].createdBy.name, '복제자');
  assert.deepEqual(
    advanceAuthorship(
      ledger,
      initial,
      { [file]: content('bad') },
      entry('AI 실행자', 500, { kind: 'ai', status: 'failed' }),
    ),
    ledger,
  );
  const unknown = rebuildAuthorship([
    {
      entry: entry('복원자', 600, { kind: 'restore' }),
      before: {},
      after: initial,
    },
  ]);
  assert.equal(unknown[file].createdBy, undefined);
  const old = rebuildAuthorship([
    {
      entry: entry('편집자'),
      before: initial,
      after: { [file]: content('edited') },
    },
  ]);
  assert.equal(old[file].createdBy, undefined);
});

test('local attribution persists independently of snapshots, detects external edits and rebuilds legacy history', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-author-local-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const initial = { [file]: content('first') };
  await materialize(root, initial);
  await saveHistory(root, {}, initial, entry('작성자'));
  const changed = { [file]: content('edit') };
  await materialize(root, changed);
  await saveHistory(
    root,
    initial,
    changed,
    entry('AI 실행자', 200, { kind: 'ai' }),
  );
  const info = await localFileAuthorship(root, file);
  assert.equal(info.createdBy.name, '작성자');
  assert.equal(info.lastEditedBy.kind, 'ai');
  assert.deepEqual(await captureProject(root), changed);
  await fs.unlink(path.join(root, '.canvas/authorship.json'));
  assert.deepEqual(await localFileAuthorship(root, file), info);
  await materialize(root, { [file]: content('external') });
  const external = await localFileAuthorship(root, file);
  assert.equal(external.createdBy.name, '작성자');
  assert.equal(external.lastEditedBy, undefined);
});

test('shared author identities synchronize, resist spoofing and survive role removal, history pruning, migration and restart', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'canvas-author-server-'),
  );
  let server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'fixture',
  });
  t.after(async () => {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const port = server.port;
  const project = { 'project.md': content('project', 'project') };
  const created = await CollaborationClient.create(
    `http://127.0.0.1:${port}`,
    'fixture',
    '관리자',
    '작성자 테스트',
    project,
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    created.credentials.serverUrl,
    created.credentials.inviteCode,
    '메모 생성자',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  const doc = await editor.command('documents:create-idea', {
    x: 0,
    y: 0,
    createdBy: { name: '위조 사용자' },
  });
  await owner.refresh();
  await owner.lock(doc.relativePath);
  await owner.command('documents:save', {
    relativePath: doc.relativePath,
    title: '편집됨',
    body: '관리자가 편집',
    actorName: '위조 사용자',
  });
  await owner.unlock(doc.relativePath);
  await editor.refresh();
  const record = owner.authorship[doc.relativePath];
  assert.equal(record.createdBy.name, '메모 생성자');
  assert.equal(record.createdBy.id, editor.state.memberId);
  assert.equal(record.lastEditedBy.name, '관리자');
  assert.deepEqual(editor.authorship[doc.relativePath], record);
  assert.deepEqual(
    resolveAuthorship(
      owner.authorship,
      'project.md',
      owner.files['project.md'],
    ),
    {},
  );
  await owner.setRole(editor.state.memberId, 'removed');
  assert.equal(
    owner.authorship[doc.relativePath].createdBy.name,
    '메모 생성자',
  );
  const restart = async (mutate) => {
    await server.close();
    const head = JSON.parse(
      await fs.readFile(
        path.join(root, created.credentials.projectId, 'head.json'),
        'utf8',
      ),
    );
    const statePath = path.join(
      root,
      created.credentials.projectId,
      'checkpoints',
      head.checkpoint,
      'state.json',
    );
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    mutate(state);
    await fs.writeFile(statePath, JSON.stringify(state));
    server = await createCollaborationServer({
      port,
      dataDirectory: root,
      creationKey: 'fixture',
    });
    await owner.refresh();
  };
  await restart((state) => {
    delete state.authorship;
  });
  assert.equal(
    owner.authorship[doc.relativePath].createdBy.name,
    '메모 생성자',
  );
  await owner.rotateInvite(); // Persist migrated ledger before trimming old history.
  await restart((state) => {
    state.history = [];
  });
  assert.equal(
    owner.authorship[doc.relativePath].createdBy.name,
    '메모 생성자',
  );
  const cache = new CollaborationClient(created.credentials, () => {});
  cache.seedCache({
    files: owner.files,
    revisions: owner.revisions,
    state: owner.state,
    authorship: owner.authorship,
  });
  assert.equal(cache.state.connected, false);
  assert.equal(cache.authorship[doc.relativePath].lastEditedBy.name, '관리자');
  const task = await owner.command('tasks:create', {
    kind: 'implement',
    inputPaths: [doc.relativePath],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new' },
  });
  await owner.beginAi(task.relativePath);
  const output = expectedArtifacts(owner.files[task.relativePath])[0];
  await owner.finishAi(
    'completed',
    { [output]: '<html><body><button>play</button></body></html>' },
    'fixture',
  );
  assert.equal(owner.authorship[output].createdBy.kind, 'ai');
  assert.equal(owner.authorship[output].createdBy.name, '관리자');
});

test('author labels distinguish unknown, local users and AI initiators without unsafe values', () => {
  assert.equal(authorLabel(), '확인할 수 없음');
  assert.equal(
    authorLabel({ name: '로컬 사용자', kind: 'local' }),
    '로컬 사용자',
  );
  assert.equal(authorLabel({ name: '세혁', kind: 'ai' }), 'AI · 실행자 세혁');
  assert.equal(
    authorLabel({ name: { invalid: 1 }, kind: 'member' }),
    '확인할 수 없음',
  );
});
