import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import matter from '../src/markdown.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { planOfflineMerge } from '../src/offline-sync.ts';
import { ProjectLibrary } from '../src/project-library.ts';
import { findTextRanges } from '../src/canvas-find.ts';
import {
  reduceCollaboration,
  snapshotDocuments,
  checkSnapshot,
} from '../src/collaboration-model.ts';
import { describePreview } from '../src/html-source.ts';

const raw = (id, body = '원본', extra = {}) =>
  matter.stringify(`\n${body}\n`, {
    id,
    title: id,
    type: 'idea',
    x: 80,
    y: 80,
    width: 340,
    height: 300,
    updated_at: 1,
    ...extra,
  });
const files = () => ({
  'project.md': raw('project'),
  'ideas/a.md': raw('a'),
  'ideas/b.md': raw('b'),
});
const body = (client, relative = 'ideas/a.md') =>
  matter(client.files[relative]).content.trim();
const alter = (snapshot, relative, value, data = {}) => ({
  ...snapshot,
  [relative]: raw(matter(snapshot[relative]).data.id, value, {
    ...matter(snapshot[relative]).data,
    ...data,
  }),
});

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-offline-'));
  let server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    '',
    '관리자',
    '복귀 테스트',
    files(),
  );
  const joined = await CollaborationClient.join(
    url,
    created.credentials.inviteCode,
    '참여자',
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  const editor = new CollaborationClient(
    joined.credentials,
    () => {},
    async () => {},
  );
  owner.accept(created.result);
  editor.accept(joined.result);
  t.after(async () => {
    owner.stop();
    editor.stop();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const request = editor.request.bind(editor);
  return {
    owner,
    editor,
    request,
    async offline() {
      editor.request = async () => {
        throw new TypeError('offline fixture');
      };
      await assert.rejects(editor.refresh());
    },
    async restart() {
      const port = server.port;
      await server.close();
      server = await createCollaborationServer({
        dataDirectory: directory,
        port,
      });
    },
  };
}
async function save(client, value, relativePath = 'ideas/a.md') {
  await client.lock(relativePath);
  await client.command('documents:save', {
    relativePath,
    title: matter(client.files[relativePath]).data.title,
    body: value,
  });
  await client.unlock(relativePath);
}

test('three-way Markdown merge combines body, color, layout and unrelated files but requires a choice for competing text', () => {
  const base = files();
  const local = alter(base, 'ideas/a.md', '내 본문');
  const remote = alter(
    alter(base, 'ideas/a.md', '원본', {
      x: 800,
      background_color: 'blue',
      updated_at: 9,
    }),
    'ideas/b.md',
    '팀원의 메모',
  );
  const merged = planOfflineMerge(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(matter(merged.merged['ideas/a.md']).content.trim(), '내 본문');
  assert.equal(matter(merged.merged['ideas/a.md']).data.x, 800);
  assert.equal(
    matter(merged.merged['ideas/a.md']).data.background_color,
    'blue',
  );
  assert.equal(
    matter(merged.merged['ideas/b.md']).content.trim(),
    '팀원의 메모',
  );
  const conflict = planOfflineMerge(
    base,
    local,
    alter(remote, 'ideas/a.md', '팀원의 본문'),
  );
  assert.equal(conflict.conflicts.length, 1);
  assert.match(conflict.conflicts[0].local[0].content, /내 본문/);
  assert.match(conflict.conflicts[0].server[0].content, /팀원의 본문/);
  assert.deepEqual(files(), base);
});

test('offline save/new memo/color persist before acknowledgement and merge after actual server restart', async (t) => {
  const { owner, editor, request, offline, restart } = await setup(t);
  let persisted;
  editor.persist = async () => {
    persisted = structuredClone({
      files: editor.files,
      offline: editor.offline,
      outgoing: editor.outgoing,
      revisions: editor.revisions,
      state: editor.state,
    });
  };
  await offline();
  await save(editor, '서버가 꺼져도 기록');
  const created = await editor.command('documents:create-idea', {
    x: 400,
    y: 100,
  });
  await editor.command('documents:set-color', {
    relativePath: created.relativePath,
    color: 'green',
  });
  assert.equal(body(editor), '서버가 꺼져도 기록');
  assert.ok(persisted.offline);
  await save(owner, '다른 문서는 유지', 'ideas/b.md');
  await restart();
  const resumed = new CollaborationClient(editor.credentials, () => {});
  t.after(() => resumed.stop());
  resumed.seedCache(persisted);
  assert.equal(body(resumed), '서버가 꺼져도 기록');
  await resumed.refresh();
  assert.equal(resumed.offline, null);
  assert.equal(resumed.state.connected, true);
  assert.equal(body(resumed, 'ideas/b.md'), '다른 문서는 유지');
  assert.equal(
    matter(resumed.files[created.relativePath]).data.background_color,
    'green',
  );
  await owner.refresh();
  assert.equal(body(owner), '서버가 꺼져도 기록');
  assert.equal((await owner.history())[0].label, '오프라인 작업 동기화');
  assert.equal((await owner.history())[0].actorName, '참여자');
  editor.request = request;
});

for (const choice of ['local', 'server'])
  test(`competing edits wait for explicit ${choice} choice and keep the losing version in history/cache`, async (t) => {
    const { owner, editor, request, offline } = await setup(t);
    await offline();
    await save(editor, '내 편집');
    await save(owner, '팀원 편집');
    editor.request = request;
    await editor.refresh();
    const conflict = editor.state.conflicts[0];
    assert.equal(body(editor), '내 편집');
    assert.equal(body(owner), '팀원 편집');
    await editor.resolveConflict(conflict.id, choice);
    await owner.refresh();
    assert.equal(body(owner), choice === 'local' ? '내 편집' : '팀원 편집');
    assert.equal(editor.offline, null);
    if (choice === 'local')
      assert.match(
        await owner.readHistory(
          (await owner.history())[0].id,
          'ideas/a.md',
          'before',
        ),
        /팀원 편집/,
      );
  });

test('a newer remote conflict cannot be overwritten using an old confirmation', async (t) => {
  const { owner, editor, request, offline } = await setup(t);
  await offline();
  await save(editor, '내 초안');
  await save(owner, '원격1');
  editor.request = request;
  await editor.refresh();
  const id = editor.state.conflicts[0].id;
  await save(owner, '원격2');
  await assert.rejects(editor.resolveConflict(id, 'local'), /다시 확인/);
  assert.equal(body(owner), '원격2');
  assert.equal(body(editor), '내 초안');
  assert.notEqual(editor.state.conflicts[0].id, id);
});

test('section membership vs document deletion is resolved as a dependent group, never a partial invalid snapshot', () => {
  const base = files();
  const local = {
    ...base,
    'sections/s.md': raw('section-s', '# 묶음', {
      type: 'section',
      members: [{ id: 'a', path: 'ideas/a.md' }],
    }),
  };
  const remote = { ...base };
  delete remote['ideas/a.md'];
  const plan = planOfflineMerge(base, local, remote);
  assert.equal(plan.conflicts.length, 1);
  assert.ok(plan.conflicts[0].paths.includes('ideas/a.md'));
  assert.ok(plan.conflicts[0].paths.includes('sections/s.md'));
  checkSnapshot(plan.merged);
});

test('durable cache failure never reports an offline edit as saved', async (t) => {
  const { owner, editor, request, offline } = await setup(t);
  await offline();
  editor.persist = async () => {
    throw new Error('disk full fixture');
  };
  await assert.rejects(save(editor, '저장 실패'), /disk full/);
  assert.equal(body(editor), '원본');
  assert.equal(editor.offline, null);
  editor.persist = async () => {};
  await save(editor, '내 보관 작업');
  await save(owner, '서버 작업');
  editor.request = request;
  await editor.refresh();
  const previous = structuredClone(editor.offline);
  editor.persist = async () => {
    throw new Error('disk full fixture');
  };
  await assert.rejects(
    editor.resolveConflict(editor.state.conflicts[0].id, 'server'),
    /disk full/,
  );
  assert.deepEqual(editor.offline, previous);
  assert.equal(body(editor), '내 보관 작업');
});

test('lost sync acknowledgement replays the same ID across restart without duplicating history or later edits', async (t) => {
  const { owner, editor, request, offline } = await setup(t);
  await offline();
  await save(editor, '오프라인1');
  let firstId;
  editor.request = async (action, input) => {
    const result = await request(action, input);
    if (action === 'offline-sync') {
      firstId = input.id;
      throw new TypeError('lost acknowledgement');
    }
    return result;
  };
  await assert.rejects(editor.refresh());
  assert.equal(editor.offline.transaction.id, firstId);
  await save(editor, '오프라인2');
  assert.equal(editor.offline.transaction.id, firstId);
  let retryId;
  editor.request = async (action, input) => {
    if (action === 'offline-sync' && !retryId) retryId = input.id;
    return request(action, input);
  };
  await editor.refresh();
  await owner.refresh();
  assert.equal(retryId, firstId);
  assert.equal(body(owner), '오프라인2');
  assert.equal(editor.offline, null);
  assert.equal(
    (await owner.history()).filter(
      (item) => item.label === '오프라인 작업 동기화',
    ).length,
    2,
  );
});

test('lost online save response permits further local edits and replays the original operation before merging', async (t) => {
  const { owner, editor, request } = await setup(t);
  await editor.lock('ideas/a.md');
  editor.request = async (action, input) => {
    const result = await request(action, input);
    if (action === 'command') throw new TypeError('response lost');
    return result;
  };
  await editor.command('documents:save', {
    relativePath: 'ideas/a.md',
    title: 'a',
    body: '저장1',
  });
  assert.equal(editor.state.connected, false);
  assert.ok(editor.outgoing);
  assert.equal(body(editor), '저장1');
  await save(editor, '저장2');
  editor.request = request;
  await editor.refresh();
  await owner.refresh();
  assert.equal(body(owner), '저장2');
  assert.equal(editor.outgoing, null);
  assert.equal(editor.offline, null);
  assert.equal(editor.state.conflicts?.length ?? 0, 0);
});

test('viewer downgrade, revoked sessions, server locks and AI leases cannot bypass offline publication checks', async (t) => {
  const { owner, editor, request, offline } = await setup(t);
  const task = await owner.command('tasks:create', {
    kind: 'organize',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
  });
  await editor.refresh();
  await offline();
  await save(editor, '보관할 작업');
  editor.request = request;
  await owner.lock('ideas/a.md');
  await editor.refresh();
  assert.ok(editor.offline);
  assert.match(editor.state.syncMessage, /편집 중/);
  await owner.unlock('ideas/a.md');
  await owner.beginAi(task.relativePath);
  await editor.refresh();
  assert.ok(editor.offline);
  assert.match(editor.state.syncMessage, /AI 작업/);
  await assert.rejects(editor.beginAi(task.relativePath), /연결된/);
  await owner.cancelAi();
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  assert.ok(editor.offline);
  assert.match(editor.state.syncMessage, /뷰어/);
  await assert.rejects(save(editor, '권한 우회'), /권한/);
  await owner.setRole(editor.state.memberId, 'removed');
  await assert.rejects(editor.refresh());
  assert.equal(editor.state.accessDenied, true);
  assert.equal(body(editor), '보관할 작업');
  assert.equal(body(owner), '원본');
});

test('offline publication validates paths, protects project.md and AI/output files, and checks stale revisions atomically', async (t) => {
  const { owner, editor } = await setup(t);
  for (const changes of [
    { '../escape.md': raw('bad') },
    { 'project.md': null },
    { '.ai/tasks/evil.md': raw('ai') },
    { 'output/index.html': '<html></html>' },
  ])
    await assert.rejects(
      editor.request('offline-sync', {
        id: randomUUID(),
        changes,
        revisions: editor.revisions,
      }),
    );
  const revisions = { ...editor.revisions };
  await save(owner, '새 서버 작업');
  await assert.rejects(
    editor.request('offline-sync', {
      id: randomUUID(),
      changes: {
        'ideas/a.md': raw('a', '오래된 작업'),
        'ideas/b.md': raw('b', '부분 반영 금지'),
      },
      revisions,
    }),
    /다른 참여자/,
  );
  await editor.refresh();
  assert.equal(body(editor), '새 서버 작업');
  assert.equal(body(editor, 'ideas/b.md'), '원본');
});

test('card colors survive Markdown serialization, duplication, shared state and HTML window metadata', () => {
  const base = files();
  const colored = reduceCollaboration(base, 'documents:set-color', {
    relativePath: 'ideas/a.md',
    color: 'pink',
  }).files;
  assert.equal(
    snapshotDocuments(colored).find((item) => item.id === 'a').backgroundColor,
    'pink',
  );
  const copy = reduceCollaboration(colored, 'documents:duplicate', {
    documents: [{ id: 'a', path: 'ideas/a.md' }],
    offsetX: 20,
    offsetY: 20,
  });
  assert.equal(copy.result[0].backgroundColor, 'pink');
  assert.throws(() =>
    reduceCollaboration(base, 'documents:set-color', {
      relativePath: 'ideas/a.md',
      color: 'url(private)',
    }),
  );
  const html = reduceCollaboration(
    {
      ...base,
      'output/index.html': '<!doctype html><html><body>Game</body></html>',
    },
    'documents:set-color',
    { relativePath: 'output/index.html', color: 'blue' },
  ).files;
  assert.equal(
    describePreview(html, 'output/index.html').backgroundColor,
    'blue',
  );
  assert.equal(
    html['output/index.html'],
    '<!doctype html><html><body>Game</body></html>',
  );
  checkSnapshot(html);
});

test('Ctrl+F ranges handle Korean, inline Markdown boundaries, repeated hits and literal regex symbols without mutating DOM', () => {
  const dom = new JSDOM(
    '<div id="root">게임 <strong>아이</strong>디어 게임 아이디어 [a+b] <button>아이디어</button></div>',
  );
  const root = dom.window.document.getElementById('root'),
    before = root.innerHTML;
  const matches = findTextRanges(root, '아이디어', 'memo');
  assert.equal(matches.length, 2);
  assert.equal(matches[0].range.toString(), '아이디어');
  assert.equal(findTextRanges(root, '[a+b]', 'memo').length, 1);
  assert.equal(findTextRanges(root, '', 'memo').length, 0);
  assert.equal(root.innerHTML, before);
});

test('project registry remembers multiple sessions/roles and changed tunnel addresses without exposing tokens through IPC', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'canvas-projects-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 123),
    decryptString: (value) =>
      Buffer.from(value)
        .map((byte) => byte ^ 123)
        .toString(),
  };
  const library = new ProjectLibrary(directory, encryption);
  await library.load();
  await library.rememberLocal('C:/test/game', '게임');
  const credentials = {
    projectId: randomUUID(),
    serverUrl: 'https://old.example.com',
    token: 'private-fixture-token',
    recoveryKey: 'private-fixture-key',
  };
  await library.rememberShared(credentials, '함께', 'admin', 'C:/test/game');
  await library.rememberShared(
    { ...credentials, projectId: randomUUID(), token: 'editor-fixture-token' },
    '다른 프로젝트',
    'editor',
    null,
  );
  assert.equal(library.list().length, 3);
  assert.ok(!JSON.stringify(library.list()).includes('private-fixture'));
  assert.ok(
    !(await fs.readFile(path.join(directory, 'projects.enc'), 'utf8')).includes(
      'private-fixture',
    ),
  );
  const fresh = new ProjectLibrary(directory, encryption);
  await fresh.load();
  const id = `shared:${credentials.projectId}`;
  assert.equal(fresh.get(id).credentials.token, credentials.token);
  await fresh.updateServer(id, 'https://new.example.com');
  assert.equal(fresh.get(id).credentials.serverUrl, 'https://new.example.com');
  assert.equal(fresh.get(id).role, 'admin');
  await fresh.forgetSession(credentials.projectId);
  assert.equal(fresh.list().length, 2);
});

test('local project registry works without encryption while shared sessions fail before secrets are written', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'canvas-projects-local-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const unavailable = {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('must not encrypt');
    },
    decryptString: () => {
      throw new Error('must not decrypt');
    },
  };
  const library = new ProjectLibrary(directory, unavailable);
  await library.load();
  await library.rememberLocal('C:/local', '로컬');
  await assert.rejects(
    library.rememberShared(
      {
        projectId: randomUUID(),
        serverUrl: 'https://example.com',
        token: 'private',
      },
      '공동',
      'admin',
      null,
    ),
    /암호화/,
  );
  const fresh = new ProjectLibrary(directory, unavailable);
  await fresh.load();
  assert.equal(fresh.list().length, 1);
  assert.deepEqual(await fs.readdir(directory), ['local-projects.json']);
});
