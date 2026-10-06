import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import matter from 'gray-matter';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import {
  CollaborationClient,
  serverAddress,
} from '../src/collaboration-client.ts';
import { checkSnapshot } from '../src/collaboration-model.ts';
import { setMarkdownTaskChecked } from '../src/markdown-editing.ts';

test('Markdown checkbox edits synchronize, keep author history, respect locks/viewers/AI and survive restart', async (t) => {
  const { owner, editor, restart } = await setup(t);
  const relativePath = 'ideas/a.md';
  const body =
    '# 할 일\n\n- [ ] 같은 이름\n- [ ] 같은 이름\n\n|항목|값|\n|---|---|\n|감자|3|';
  await owner.lock(relativePath);
  await owner.command('documents:save', {
    relativePath,
    title: '체크리스트',
    body,
  });
  await owner.unlock(relativePath);
  await editor.refresh();
  await editor.lock(relativePath);
  await assert.rejects(owner.lock(relativePath), /편집 중/);
  const checked = setMarkdownTaskChecked(body, body.lastIndexOf('- [ ]'), true);
  await editor.command('documents:save', {
    relativePath,
    title: '체크리스트',
    body: checked,
  });
  await editor.unlock(relativePath);
  await owner.refresh();
  assert.equal(matter(owner.files[relativePath]).content.trim(), checked);
  assert.match((await owner.history())[0].actorName, /편집자/);
  await restart();
  await owner.refresh();
  assert.equal(matter(owner.files[relativePath]).content.trim(), checked);
  const task = await owner.command('tasks:create', {
    kind: 'organize',
    inputPaths: [relativePath],
    x: 0,
    y: 0,
  });
  await owner.beginAi(task.relativePath);
  await assert.rejects(editor.lock(relativePath), /AI 작업/);
  await owner.cancelAi();
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(editor.lock(relativePath), /뷰어/);
  await assert.rejects(
    editor.command('documents:save', {
      relativePath,
      title: '체크리스트',
      body,
    }),
    /뷰어/,
  );
  assert.equal(matter(owner.files[relativePath]).content.trim(), checked);
});

test('void command retries keep their history ID after server restart', async (t) => {
  const { owner, restart } = await setup(t);
  const command = {
    id: randomUUID(),
    channel: 'documents:update-layout',
    input: {
      relativePath: 'ideas/a.md',
      x: 330,
      y: 420,
      width: 340,
      height: 300,
    },
    revisions: { ...owner.revisions },
  };
  const first = await owner.request('command', command);
  assert.equal(first.result, undefined);
  assert.ok(first.historyId);
  await restart();
  const repeated = await owner.request('command', command);
  assert.equal(repeated.result, undefined);
  assert.equal(repeated.historyId, first.historyId);
  assert.equal(repeated.revision, first.revision);
  owner.accept(repeated);
  await owner.changeHistory(first.historyId, 'undo');
  assert.equal(matter(owner.files['ideas/a.md']).data.x, 80);
});

test('member undo preserves unrelated edits, is author-scoped, lock-safe and conflict-safe', async (t) => {
  const { owner, editor } = await setup(t);
  await owner.command('documents:update-layout', {
    relativePath: 'ideas/a.md',
    x: 300,
    y: 400,
    width: 340,
    height: 300,
  });
  const id = owner.lastCommandHistoryId;
  assert.ok(id);
  await editor.command('documents:update-layout', {
    relativePath: 'ideas/b.md',
    x: 500,
    y: 600,
    width: 340,
    height: 300,
  });
  const other = editor.files['ideas/b.md'];
  await assert.rejects(editor.changeHistory(id, 'undo'), /본인/);
  await editor.lock('ideas/a.md');
  await assert.rejects(owner.changeHistory(id, 'undo'), /편집/);
  await editor.unlock('ideas/a.md');
  await owner.changeHistory(id, 'undo');
  assert.equal(matter(owner.files['ideas/a.md']).data.x, 80);
  assert.equal(owner.files['ideas/b.md'], other);
  await owner.changeHistory(id, 'redo');
  assert.equal(matter(owner.files['ideas/a.md']).data.x, 300);
  await editor.refresh();
  await editor.command('documents:update-layout', {
    relativePath: 'ideas/a.md',
    x: 900,
    y: 400,
    width: 340,
    height: 300,
  });
  await assert.rejects(owner.changeHistory(id, 'undo'), /충돌/);
  await owner.refresh();
  assert.equal(matter(owner.files['ideas/a.md']).data.x, 900);
  await owner.setRole(editor.state.memberId, 'viewer');
  await assert.rejects(
    editor.changeHistory(editor.lastCommandHistoryId, 'undo'),
    /뷰어/,
  );
});

test('section rename preserves identity and batch deletion plus undo restores membership atomically', async (t) => {
  const { owner } = await setup(t);
  const section = await owner.command('sections:create', {
    title: '플레이어',
    members: [
      { id: 'a', path: 'ideas/a.md' },
      { id: 'b', path: 'ideas/b.md' },
    ],
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
  await owner.command('sections:rename', {
    relativePath: section.relativePath,
    title: '몬스터',
  });
  const parsed = matter(owner.files[section.relativePath]).data;
  assert.equal(parsed.id, section.id);
  assert.equal(parsed.title, '몬스터');
  assert.equal(parsed.members.length, 2);
  const before = { ...owner.files };
  await assert.rejects(
    owner.command('documents:delete-many', {
      documents: [
        { documentId: 'a', relativePath: 'ideas/a.md' },
        { documentId: 'project', relativePath: 'project.md' },
      ],
    }),
    /기본|삭제/,
  );
  await owner.refresh();
  assert.deepEqual(owner.files, before);
  await owner.command('documents:delete-many', {
    documents: [
      { documentId: 'a', relativePath: 'ideas/a.md' },
      { documentId: 'b', relativePath: 'ideas/b.md' },
    ],
  });
  assert.equal(owner.files['ideas/a.md'], undefined);
  assert.equal(
    matter(owner.files[section.relativePath]).data.members.length,
    0,
  );
  await owner.changeHistory(owner.lastCommandHistoryId, 'undo');
  assert.deepEqual(owner.files, before);
});

const md = (id, body = '원본 아이디어') =>
  matter.stringify(`\n${body}\n`, {
    id,
    title: id,
    type: 'idea',
    status: 'draft',
    x: 80,
    y: 100,
    width: 340,
    height: 300,
    sources: [],
  });
const initial = () => ({
  'project.md': md('project'),
  'ideas/a.md': md('a'),
  'ideas/b.md': md('b'),
  'ideas/c.md': md('c'),
});
test('shared document versions reserve separately, preserve IDs and propagate failure codes without local paths', async (t) => {
  const { owner, editor } = await setup(t);
  const input = {
    kind: 'organize',
    inputPaths: ['ideas/a.md', 'ideas/b.md'],
    x: 900,
    y: 100,
    documentResult: { mode: 'new' },
  };
  const first = await owner.command('tasks:create', input);
  const outputs = matter(owner.files[first.relativePath]).data.expected_outputs;
  assert.equal(outputs[0], 'docs/game-overview.md');
  await owner.beginAi(first.relativePath);
  const artifacts = Object.fromEntries(
    outputs.map((path, index) => [
      path,
      matter.stringify('new game', {
        id: `new-doc-${index}`,
        title: 'new',
        type: 'system',
        status: 'draft',
        sources: [{ id: 'a' }, { id: 'b' }],
      }),
    ]),
  );
  await owner.finishAi('completed', artifacts);
  const second = await owner.command('tasks:create', input);
  assert.match(
    matter(owner.files[second.relativePath]).data.expected_outputs[0],
    /^docs\/versions\/v2\//,
  );
  const update = await owner.command('tasks:create', {
    ...input,
    documentResult: { mode: 'update', baseDir: 'docs' },
  });
  assert.deepEqual(
    matter(owner.files[update.relativePath]).data.expected_outputs,
    outputs,
  );
  await assert.rejects(
    owner.command('tasks:create', {
      ...input,
      inputPaths: outputs,
      documentResult: { mode: 'update', baseDir: 'docs' },
    }),
    /GC-AI-004/,
  );
  await owner.beginAi(second.relativePath);
  await owner.finishAi('failed', {}, 'fixture', {
    code: 'GC-HTML-002',
    stage: 'HTML 실행',
    message: 'fixture syntax failure',
    hint: 'check',
    details: {},
    diagnosticPath: '.history/private-local/diagnostic.json',
  });
  await editor.refresh();
  assert.equal(editor.state.aiRun.failure.code, 'GC-HTML-002');
  assert.equal(editor.state.aiRun.failure.diagnosticPath, undefined);
  assert.equal(
    matter(editor.files[second.relativePath]).data.ai_error_code,
    'GC-HTML-002',
  );
  assert.equal(
    (await owner.history()).find(
      (entry) =>
        entry.taskPath === second.relativePath && entry.status === 'failed',
    ).failure.code,
    'GC-HTML-002',
  );
  for (const path of outputs) assert.equal(owner.files[path], artifacts[path]);
});
async function setup(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'game-canvas-collaboration-'),
  );
  let running = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    creationKey: 'test-only-creation-key',
  });
  const url = `http://127.0.0.1:${running.port}`;
  const clients = [];
  t.after(async () => {
    clients.forEach((client) => client.stop());
    await running.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const created = await CollaborationClient.create(
    url,
    'test-only-creation-key',
    '관리자',
    'test',
    initial(),
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  clients.push(owner);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    '편집자',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  clients.push(editor);
  await owner.refresh();
  return {
    root,
    url,
    owner,
    editor,
    code: created.result.code,
    clients,
    restart: async () => {
      await running.close();
      running = await createCollaborationServer({
        dataDirectory: root,
        port: Number(new URL(url).port),
        creationKey: 'test-only-creation-key',
      });
    },
  };
}

test('editors execute their own three-provider AI with a single authoritative lease; viewers and other executors cannot submit or cancel', async (t) => {
  const { url, code, owner, editor, clients, restart } = await setup(t);
  const joined = await CollaborationClient.join(url, code, '다른 편집자');
  const other = new CollaborationClient(joined.credentials, () => {});
  other.accept(joined.result);
  clients.push(other);
  for (const providerId of ['codex-cli', 'claude-cli', 'gemini-cli']) {
    await editor.refresh();
    assert.equal(editor.state.editorAi, true);
    assert.equal(editor.state.multiProviderAi, true);
    const task = await editor.command('tasks:create', {
      kind: 'implement',
      inputPaths: ['ideas/a.md'],
      x: 0,
      y: 0,
    });
    await editor.beginAi(task.relativePath, 'fixture-model', providerId);
    const lease = editor.lease;
    assert.equal(editor.state.aiRun.actorId, editor.state.memberId);
    assert.equal(editor.state.aiRun.providerId, providerId);
    await other.refresh();
    await assert.rejects(other.beginAi(task.relativePath), /이미 AI/);
    await assert.rejects(other.cancelAi(), /본인이/);
    await assert.rejects(
      other.request('ai-progress', { lease, status: 'running' }),
      /실행 권한/,
    );
    await assert.rejects(
      other.request('ai-finish', {
        lease,
        status: 'completed',
        artifacts: { 'output/index.html': '<html><body>hijack</body></html>' },
      }),
      /실행 권한/,
    );
    await assert.rejects(
      other.command('documents:create-idea', { x: 0, y: 0 }),
      /AI 작업/,
    );
    await editor.finishAi('completed', {
      'output/games/v1/index.html':
        '<html><body>' + providerId + '</body></html>',
    });
    await owner.refresh();
    assert.match(
      owner.files['output/games/v1/index.html'],
      new RegExp(providerId),
    );
    const history = (await owner.history()).find(
      (entry) =>
        entry.taskPath === task.relativePath && entry.status === 'completed',
    );
    assert.equal(history.providerId, providerId);
    assert.equal(history.modelId, 'fixture-model');
    assert.equal(history.actorId, editor.state.memberId);
  }
  await restart();
  await editor.refresh();
  assert.equal(
    (await editor.history()).find(
      (entry) => entry.status === 'completed' && entry.kind === 'ai',
    ).providerId,
    'gemini-cli',
  );
  const task = await editor.command('tasks:create', {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
  });
  await assert.rejects(
    editor.beginAi(task.relativePath, null, 'other-cli'),
    /지원하지/,
  );
  await editor.beginAi(task.relativePath, null, 'claude-cli');
  const lease = editor.lease;
  await owner.cancelAi();
  await assert.rejects(
    editor.request('ai-finish', {
      lease,
      status: 'completed',
      artifacts: { 'output/index.html': '<html><body>late</body></html>' },
    }),
    /만료/,
  );
  await editor.refresh();
  await editor.beginAi(task.relativePath, null, 'gemini-cli');
  await editor.cancelAi();
  await editor.beginAi(task.relativePath);
  await assert.rejects(
    owner.setRole(editor.state.memberId, 'viewer'),
    /먼저 작업을 중지/,
  );
  await owner.cancelAi();
  await owner.setRole(editor.state.memberId, 'viewer');
  await assert.rejects(
    editor.request('ai-finish', {
      lease: editor.lease,
      status: 'completed',
      artifacts: { 'output/index.html': '<html><body>demoted</body></html>' },
    }),
    /뷰어/,
  );
  await editor.refresh();
  await assert.rejects(editor.beginAi(task.relativePath), /관리자·편집자/);
  await assert.rejects(
    editor.command('tasks:create', {
      kind: 'implement',
      inputPaths: ['ideas/a.md'],
      x: 0,
      y: 0,
    }),
    /뷰어/,
  );
  await assert.rejects(editor.request('ai-cancel'), /뷰어/);
  await owner.refresh();
  assert.match(owner.files['output/games/v1/index.html'], /gemini-cli/);
  await other.refresh();
  other.state.editorAi = false;
  await assert.rejects(other.beginAi(task.relativePath), /v0.8.0/);
  await assert.rejects(other.command('tasks:create', {}), /v0.8.0/);
});

test('invites identify anonymous members, rotate independently of membership and enforce roles on server', async (t) => {
  const { url, owner, editor, code } = await setup(t);
  assert.equal(editor.state.role, 'editor');
  assert.notEqual(editor.state.memberId, owner.state.memberId);
  await editor.command('tasks:create', {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
  });
  await assert.rejects(
    editor.request('ai-start', {
      taskPath: '.ai/tasks/not-there.md',
      revision: editor.state.revision,
    }),
    /작업 명세|존재|파일|찾을/,
  );
  await assert.rejects(editor.request('invite'), /관리자/);
  await assert.rejects(
    editor.request('role', { memberId: owner.state.memberId, role: 'viewer' }),
    /관리자/,
  );
  await owner.rotateInvite();
  await assert.rejects(CollaborationClient.join(url, code, '침입'), /코드/);
  await editor.refresh();
  assert.equal(editor.state.connected, true);
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(
    editor.command('documents:create-idea', { x: 0, y: 0 }),
    /뷰어/,
  );
  await assert.rejects(owner.setRole(owner.state.memberId, 'viewer'), /생성자/);
  await owner.setRole(editor.state.memberId, 'removed');
  await assert.rejects(editor.refresh(), /회수/);
  assert.equal(editor.state.connected, false);
});

test('exclusive locks, stale revisions and multi-object transactions prevent lost or partial edits', async (t) => {
  const { owner, editor } = await setup(t);
  await editor.lock('ideas/a.md');
  await assert.rejects(owner.lock('ideas/a.md'), /편집 중/);
  await owner.lock('ideas/b.md');
  await Promise.all([
    editor.command('documents:save', {
      relativePath: 'ideas/a.md',
      title: 'A',
      body: 'A 수정',
    }),
    owner.command('documents:save', {
      relativePath: 'ideas/b.md',
      title: 'B',
      body: 'B 수정',
    }),
  ]);
  await owner.refresh();
  assert.match(owner.files['ideas/a.md'], /A 수정/);
  assert.match(owner.files['ideas/b.md'], /B 수정/);
  await assert.rejects(
    owner.command('layouts:update', {
      updates: ['ideas/a.md', 'ideas/b.md', 'ideas/c.md'].map(
        (relativePath) => ({
          kind: 'document',
          relativePath,
          x: 500,
          y: 500,
          width: 340,
          height: 300,
        }),
      ),
    }),
    /편집 중/,
  );
  assert.equal(matter(owner.files['ideas/b.md']).data.x, 80);
  await editor.unlock('ideas/a.md');
  await owner.unlock('ideas/b.md');
  const stale = { ...owner.revisions };
  await editor.refresh();
  await editor.command('documents:update-layout', {
    relativePath: 'ideas/c.md',
    x: 300,
    y: 400,
    width: 340,
    height: 300,
  });
  await assert.rejects(
    owner.request('command', {
      id: randomUUID(),
      channel: 'documents:update-layout',
      input: {
        relativePath: 'ideas/c.md',
        x: 10,
        y: 10,
        width: 340,
        height: 300,
      },
      revisions: stale,
    }),
    /최신/,
  );
  await owner.refresh();
  const operation = {
    id: randomUUID(),
    channel: 'layouts:update',
    input: {
      updates: ['ideas/a.md', 'ideas/b.md', 'ideas/c.md'].map(
        (relativePath) => ({
          kind: 'document',
          relativePath,
          x: 600,
          y: 300,
          width: 340,
          height: 300,
        }),
      ),
    },
    revisions: owner.revisions,
  };
  const result = await owner.request('command', operation);
  const replay = await owner.request('command', operation);
  assert.equal(result.state.revision, replay.state.revision);
  for (const relative of ['ideas/a.md', 'ideas/b.md', 'ideas/c.md'])
    assert.equal(matter(result.files[relative]).data.x, 600);
  assert.equal((await owner.history())[0].files.length, 3);
});

test('section membership, deleted Markdown, author history and restore survive server restart', async (t) => {
  const { owner, editor, root, restart } = await setup(t);
  const section = await editor.command('sections:create', {
    title: '플레이어',
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    members: [
      { id: 'a', path: 'ideas/a.md' },
      { id: 'b', path: 'ideas/b.md' },
    ],
  });
  const deleted = await editor.command('sections:delete', {
    sectionId: section.id,
    relativePath: section.relativePath,
    deleteMembers: true,
  });
  assert.equal(deleted.deletedDocumentCount, 2);
  await owner.refresh();
  const history = await owner.history();
  const entry = history.find((entry) => entry.label === '섹션 해제·삭제');
  assert.equal(entry.actorName, '편집자');
  assert.equal(entry.actorId, editor.state.memberId);
  await assert.rejects(
    editor.request('restore', { id: entry.id, revision: owner.state.revision }),
    /관리자/,
  );
  await owner.restore(entry.id);
  assert.ok(owner.files['ideas/a.md']);
  assert.ok(owner.files[section.relativePath]);
  const head = JSON.parse(
    await fs.readFile(
      path.join(root, owner.credentials.projectId, 'head.json'),
      'utf8',
    ),
  );
  const actualMarkdown = await fs.readFile(
    path.join(
      root,
      owner.credentials.projectId,
      'checkpoints',
      head.checkpoint,
      'files/ideas/a.md',
    ),
    'utf8',
  );
  assert.equal(actualMarkdown, owner.files['ideas/a.md']);
  await restart();
  await owner.refresh();
  await editor.refresh();
  assert.ok(owner.files[section.relativePath]);
  assert.equal(editor.state.role, 'editor');
  assert.equal((await owner.history())[0].kind, 'restore');
});

test('AI leases lock everyone, publish only assigned outputs, preserve versions and fence cancellation', async (t) => {
  const { owner, editor } = await setup(t);
  const task = await owner.command('tasks:create', {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 500,
    y: 0,
  });
  await editor.refresh();
  await editor.lock('ideas/a.md');
  await assert.rejects(owner.beginAi(task.relativePath), /편집 중/);
  await editor.unlock('ideas/a.md');
  const baseline = await owner.beginAi(task.relativePath);
  assert.equal(baseline['ideas/a.md'], owner.files['ideas/a.md']);
  await editor.refresh();
  assert.equal(editor.state.aiRun.status, 'starting');
  await assert.rejects(
    editor.command('documents:delete', {
      documentId: 'a',
      relativePath: 'ideas/a.md',
    }),
    /AI 작업/,
  );
  await assert.rejects(editor.lock('ideas/a.md'), /AI 작업/);
  await assert.rejects(
    owner.request('ai-finish', {
      lease: owner.lease,
      status: 'completed',
      artifacts: {
        'output/index.html': '<html><body>ok</body></html>',
        'ideas/a.md': '악성 변경',
      },
    }),
    /허용된/,
  );
  await owner.finishAi('completed', {
    'output/games/v1/index.html': '<html><body>버전1</body></html>',
  });
  await editor.refresh();
  assert.match(editor.files['output/games/v1/index.html'], /버전1/);
  const v2 = await owner.command('tasks:create', {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new', basePath: 'output/games/v1/index.html' },
  });
  await owner.beginAi(v2.relativePath);
  const oldLease = owner.lease;
  await owner.cancelAi();
  await assert.rejects(
    owner.request('ai-finish', {
      lease: oldLease,
      status: 'completed',
      artifacts: {
        'output/games/v2/index.html': '<html><body>遅延</body></html>',
      },
    }),
    /만료/,
  );
  await owner.refresh();
  assert.equal(owner.files['output/games/v2/index.html'], undefined);
  await owner.beginAi(v2.relativePath);
  await owner.finishAi('completed', {
    'output/games/v2/index.html': '<html><body>버전2</body></html>',
  });
  assert.match(owner.files['output/games/v1/index.html'], /버전1/);
  assert.match(owner.files['output/games/v2/index.html'], /버전2/);
});

test('recovery rotates owner credentials and restart fails an orphan AI lease without publishing', async (t) => {
  const { url, owner, restart } = await setup(t);
  const task = await owner.command('tasks:create', {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
  });
  await owner.beginAi(task.relativePath);
  const lease = owner.lease;
  owner.lease = null;
  await restart();
  await owner.refresh();
  assert.equal(owner.state.aiRun.status, 'failed');
  await assert.rejects(
    owner.request('ai-finish', {
      lease,
      status: 'completed',
      artifacts: { 'output/index.html': '<html><body>stale</body></html>' },
    }),
    /만료/,
  );
  const restored = await CollaborationClient.fetch(url, '/recover', {
    projectId: owner.credentials.projectId,
    recoveryKey: owner.credentials.recoveryKey,
  });
  assert.notEqual(restored.token, owner.credentials.token);
  await assert.rejects(owner.refresh(), /회수/);
  await assert.rejects(
    CollaborationClient.fetch(url, '/recover', {
      projectId: owner.credentials.projectId,
      recoveryKey: owner.credentials.recoveryKey,
    }),
    /복구/,
  );
});

test('unsafe routes, executable frontmatter, public HTTP and browser origins are rejected', async (t) => {
  const { url, owner } = await setup(t);
  assert.doesNotThrow(() =>
    checkSnapshot({ ...initial(), 'ideas/플레이어 메모.md': '# 한글 파일' }),
  );
  for (const badPath of ['ideas/con.md', 'ideas/x:stream.md', 'ideas//x.md'])
    assert.throws(
      () => checkSnapshot({ ...initial(), [badPath]: 'x' }),
      /경로/,
    );
  assert.throws(
    () => checkSnapshot({ ...initial(), 'ideas/A.md': 'collision' }),
    /대소문자/,
  );
  assert.throws(() => serverAddress('http://example.com'), /HTTPS/);
  assert.throws(
    () => serverAddress('https://user:password@example.com'),
    /주소/,
  );
  assert.throws(
    () => checkSnapshot({ ...initial(), '../outside.md': 'x' }),
    /경로/,
  );
  assert.throws(
    () =>
      checkSnapshot({
        ...initial(),
        'ideas/a.md': '---javascript\nthrow new Error("executed")\n---\nx',
      }),
    /YAML/,
  );
  await assert.rejects(
    owner.command('documents:save', {
      relativePath: '../outside.md',
      title: 'bad',
      body: 'bad',
    }),
    /경로/,
  );
  const response = await fetch(`${url}/projects`, {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.example',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(response.status, 403);
});

test('public tunnel mode requires a strong creation key even on loopback', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-canvas-public-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const creationKey of [undefined, '', 'short']) {
    await assert.rejects(
      createCollaborationServer({
        dataDirectory: root,
        port: 0,
        publicAccess: true,
        creationKey,
      }),
      /32자/,
    );
  }
  const running = await createCollaborationServer({
    dataDirectory: root,
    port: 0,
    publicAccess: true,
    creationKey: 'a'.repeat(43),
  });
  t.after(() => running.close());
  const response = await fetch(`http://127.0.0.1:${running.port}/projects`, {
    method: 'POST',
    body: '{invalid-json',
  });
  // Authentication runs before reading/parsing a potentially expensive body.
  assert.equal(response.status, 403);
});

test('ten authenticated participants behind one proxy can poll beyond 600 total requests', async (t) => {
  const { url, owner, editor, code, clients } = await setup(t);
  const members = [owner, editor];
  for (let index = 0; index < 8; index++) {
    const joined = await CollaborationClient.join(
      url,
      code,
      `proxy-test-${index}`,
    );
    const client = new CollaborationClient(joined.credentials, () => {});
    client.accept(joined.result);
    clients.push(client);
    members.push(client);
  }
  for (let round = 0; round < 70; round++)
    await Promise.all(members.map((member) => member.refresh()));
  assert.ok(members.every((member) => member.state.connected));
  assert.equal(owner.state.members.length, 10);
  // A noisy member is still limited; a second member on that IP is not blocked.
  let limited = false;
  for (let count = 0; count < 610; count++) {
    try {
      await owner.refresh();
    } catch (error) {
      assert.equal(error.code, 'GC-NET-004');
      limited = true;
      break;
    }
  }
  assert.ok(limited);
  await editor.refresh();
  assert.equal(editor.state.connected, true);
});

test('UTF-8 Markdown remains intact when a tunnel splits Korean characters', async (t) => {
  const { url } = await setup(t);
  const input = JSON.stringify({
    nickname: '한글 테스트',
    name: '분할 수신',
    files: {
      ...initial(),
      'ideas/korean.md': '# 게임 아이디어\n농부와 몬스터 🐔',
    },
  });
  const bytes = Buffer.from(input);
  const cut = bytes.indexOf(Buffer.from('한글')) + 1;
  const received = await new Promise((resolve, reject) => {
    const request = http.request(
      `${url}/projects`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Server-Key': 'test-only-creation-key',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))),
        );
      },
    );
    request.on('error', reject);
    request.write(bytes.subarray(0, cut));
    setImmediate(() => request.end(bytes.subarray(cut)));
  });
  assert.equal(received.state.members[0].nickname, '한글 테스트');
  assert.equal(
    received.files['ideas/korean.md'],
    '# 게임 아이디어\n농부와 몬스터 🐔',
  );
});
