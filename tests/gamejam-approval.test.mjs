import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { gamejamIssues } from '../src/gamejam-validation.ts';
import {
  parseApprovalRequest,
  approvalOperationId,
  clearApprovalOperation,
} from '../src/gamejam-approval.ts';
import { gamejamDraftScope } from '../src/gamejam-history.ts';

const request = (patch = {}) => ({
  organize: false,
  implement: true,
  inputPaths: ['ideas/a.md'],
  x: 300,
  y: 100,
  resultName: '요청 게임',
  instructions: {
    organize: '문서를 정리해줘',
    implement: '간단한 키보드 게임을 만들어줘',
  },
  htmlResult: { mode: 'new' },
  ...patch,
});
const files = () =>
  Object.fromEntries(
    ['project.md', 'ideas/a.md', 'ideas/b.md'].map((p, i) => [
      p,
      matter.stringify('본문 ' + i, {
        id: 'doc-' + i,
        title: p,
        type: i ? 'idea' : 'overview',
        status: 'draft',
        sources: [],
      }),
    ]),
  );
async function setup(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-approval-'),
  );
  let server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
    creationKey: 'approval-test-key',
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    'approval-test-key',
    '관리자',
    '승인 테스트',
    files(),
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  owner.accept(created.result);
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    '팀원',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  editor.accept(joined.result);
  const joined2 = await CollaborationClient.join(
    url,
    created.result.code,
    '다른 관리자',
  );
  const other = new CollaborationClient(joined2.credentials, () => {});
  other.accept(joined2.result);
  await owner.setRole(other.state.memberId, 'admin');
  await other.refresh();
  await owner.refresh();
  t.after(async () => {
    owner.stop();
    editor.stop();
    other.stop();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    owner,
    editor,
    other,
    restart: async () => {
      await server.close();
      server = await createCollaborationServer({
        dataDirectory: directory,
        port: Number(new URL(url).port),
        creationKey: 'approval-test-key',
      });
      await owner.refresh();
      await editor.refresh();
      await other.refresh();
    },
  };
}
const create = (editor, patch) =>
  editor.mutateApproval('create', {
    commandId: randomUUID(),
    request: request(patch),
  });
const start = async (owner, detail, commandId = randomUUID()) => {
  await owner.beginAi('', 'fixture-model', 'codex-cli', {
    id: detail.item.id,
    revision: detail.item.revision,
    reviewToken: detail.reviewToken,
    commandId,
  });
  return owner.state.aiRun.taskPath;
};

test('request validation needs content and membership but no AI login, free slot, or executor model', () => {
  assert.deepEqual(
    gamejamIssues(request(), {
      intent: 'request',
      collaboration: {
        active: true,
        connected: true,
        role: 'editor',
        members: [],
        locks: [],
        requestApprovalVersion: 1,
      },
      provider: 'codex-cli',
      model: 'invalid local model',
      connection: null,
      checkingConnection: true,
      aiBusy: true,
      locked: true,
      updateRestarting: false,
    }),
    [],
  );
  assert.throws(
    () =>
      parseApprovalRequest(
        request({ instructions: { organize: '', implement: '' } }),
      ),
    /지시/,
  );
  assert.throws(
    () => parseApprovalRequest(request({ inputPaths: [123] })),
    /올바르지/,
  );
  assert.notEqual(
    gamejamDraftScope('p', 'a', 'r'),
    gamejamDraftScope('p', 'b', 'r'),
  );
  assert.notEqual(
    gamejamDraftScope('p', 'a', 'r'),
    gamejamDraftScope('p', 'a', 's'),
  );
});

test('a lost create acknowledgement retains operation identity across app restart and isolates member drafts', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const scope = gamejamDraftScope('project', 'member');
  const id = approvalOperationId(storage, scope, 'same request', randomUUID);
  assert.equal(
    approvalOperationId(storage, scope, 'same request', randomUUID),
    id,
  );
  assert.notEqual(
    approvalOperationId(
      storage,
      gamejamDraftScope('project', 'other'),
      'same request',
      randomUUID,
    ),
    id,
  );
  clearApprovalOperation(storage, scope);
  assert.notEqual(
    approvalOperationId(storage, scope, 'same request', randomUUID),
    id,
  );
});

test('requests persist without tasks or leases; edits, feedback and semantic retry receipts survive restart', async (t) => {
  const { owner, editor, restart } = await setup(t);
  const command = { commandId: randomUUID(), request: request() };
  const before = structuredClone(editor.files);
  const item = await editor.mutateApproval('create', command);
  assert.deepEqual(editor.files, before);
  assert.equal(editor.lease, null);
  await owner.refresh();
  assert.equal(owner.state.pendingRequests, 1);
  await owner.command('documents:create-idea', { x: 0, y: 0 });
  await editor.refresh();
  assert.equal((await editor.mutateApproval('create', command)).id, item.id);
  await assert.rejects(
    editor.mutateApproval('create', {
      ...command,
      request: request({ resultName: '다른 내용' }),
    }),
    /작업 ID/,
  );
  await assert.rejects(
    owner.mutateApproval('update', {
      commandId: randomUUID(),
      id: item.id,
      revision: item.revision,
      request: request(),
    }),
    /본인/,
  );
  const feedback = await owner.mutateApproval('feedback', {
    commandId: randomUUID(),
    id: item.id,
    revision: item.revision,
    message: '조작 방법을 설명해주세요',
  });
  assert.equal(feedback.status, 'feedback');
  await assert.rejects(
    editor.mutateApproval('update', {
      commandId: randomUUID(),
      id: item.id,
      revision: 1,
      request: request(),
    }),
    /변경/,
  );
  const edit = {
    commandId: randomUUID(),
    id: item.id,
    revision: feedback.revision,
    request: request({ resultName: '수정한 게임' }),
  };
  await editor.mutateApproval('update', edit);
  await restart();
  assert.equal((await editor.mutateApproval('update', edit)).revision, 3);
  const current = await owner.readApproval(item.id);
  assert.equal(current.item.status, 'pending');
  assert.equal(current.item.request.resultName, '수정한 게임');
  assert.equal(current.item.changes.length, 3);
  assert.equal((await editor.listApprovals()).items.length, 1);
  assert(!JSON.stringify(current).includes('tokenHash'));
});

test('server blocks editor execution, foreign edits, viewers and legacy task-creation bypass', async (t) => {
  const { owner, editor } = await setup(t);
  const item = await create(editor);
  await assert.rejects(editor.request('ai-start', {}), /관리자/);
  await assert.rejects(
    editor.request('command', {
      id: randomUUID(),
      channel: 'tasks:create',
      input: {},
      revisions: editor.revisions,
    }),
    /관리자/,
  );
  await assert.rejects(
    editor.request('requests-start', { id: item.id }),
    /관리자/,
  );
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(
    editor.mutateApproval('cancel', {
      commandId: randomUUID(),
      id: item.id,
      revision: 1,
    }),
    /뷰어/,
  );
  assert.equal((await editor.readApproval(item.id)).item.id, item.id);
  await assert.rejects(
    editor.mutateApproval('create', {
      commandId: randomUUID(),
      request: request(),
    }),
    /뷰어/,
  );
});

test('request edits and relevant source changes invalidate review; unrelated edits do not', async (t) => {
  const { owner, editor } = await setup(t);
  const item = await create(editor);
  let detail = await owner.readApproval(item.id);
  await editor.mutateApproval('update', {
    commandId: randomUUID(),
    id: item.id,
    revision: 1,
    request: request({ resultName: '새 내용' }),
  });
  await assert.rejects(start(owner, detail), /변경/);
  detail = await owner.readApproval(item.id);
  await editor.lock('ideas/a.md');
  await editor.command('documents:save', {
    relativePath: 'ideas/a.md',
    title: '변경',
    body: '새 게임 내용',
  });
  await editor.unlock('ideas/a.md');
  await assert.rejects(start(owner, detail), /변경/);
  detail = await owner.readApproval(item.id);
  await editor.command('documents:update-layout', {
    relativePath: 'ideas/b.md',
    x: 42,
    y: 42,
    width: 340,
    height: 300,
  });
  const taskPath = await start(owner, detail);
  assert.ok(owner.files[taskPath]);
  assert.equal((await owner.readApproval(item.id)).item.status, 'running');
  await owner.cancelAi();
  assert.equal((await owner.readApproval(item.id)).item.status, 'stopped');
});

test('two administrators racing approve once, retries reuse the lease, and approved contents cannot change', async (t) => {
  const { owner, editor, other } = await setup(t);
  const item = await create(editor);
  const detail = await owner.readApproval(item.id);
  const commandId = randomUUID();
  const results = await Promise.allSettled([
    start(owner, detail, commandId),
    start(other, detail),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const winner = results[0].status === 'fulfilled' ? owner : other;
  const task = winner.state.aiRun.taskPath;
  if (winner === owner) {
    const lease = winner.lease;
    await start(winner, detail, commandId);
    assert.equal(winner.lease, lease);
  }
  assert.equal(
    Object.keys(winner.files).filter((p) => p.startsWith('.ai/tasks/')).length,
    1,
  );
  await assert.rejects(
    editor.mutateApproval('update', {
      commandId: randomUUID(),
      id: item.id,
      revision: detail.item.revision,
      request: request(),
    }),
    /시작/,
  );
  await assert.rejects(
    editor.mutateApproval('cancel', {
      commandId: randomUUID(),
      id: item.id,
      revision: detail.item.revision,
    }),
    /시작/,
  );
  const outputs = matter(winner.files[task]).data.expected_outputs;
  await winner.finishAi('completed', {
    [outputs[0]]: '<html><body>승인된 게임</body></html>',
  });
  const finished = (await editor.readApproval(item.id)).item;
  assert.equal(finished.status, 'completed');
  assert.equal(finished.approvedRevision, 1);
  assert.deepEqual(finished.executionRequest, item.request);
  assert.match((await owner.readApproval(item.id)).item.outputs[0], /\.html$/);
});

test('requests remain editable during another AI; restart fails an orphan run and preserves the approval record', async (t) => {
  const { owner, editor, restart } = await setup(t);
  const first = await create(editor);
  await start(owner, await owner.readApproval(first.id));
  const second = await create(editor, { resultName: '다음 작업' });
  const updated = await editor.mutateApproval('update', {
    commandId: randomUUID(),
    id: second.id,
    revision: 1,
    request: request({ resultName: '다음 작업 수정' }),
  });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    start(owner, await owner.readApproval(second.id)),
    /이미 AI/,
  );
  assert.equal((await editor.readApproval(second.id)).item.status, 'pending');
  await restart();
  assert.equal((await editor.readApproval(first.id)).item.status, 'failed');
  assert.equal((await editor.readApproval(second.id)).item.status, 'pending');
  assert.equal(owner.state.aiRun.status, 'failed');
  await start(owner, await owner.readApproval(second.id));
  await owner.finishAi('failed', {}, null, {
    code: 'GC-AI-002',
    message: '실행기 시작 실패',
  });
  assert.equal((await editor.readApproval(second.id)).item.status, 'failed');
});

test('missing or deleted input is reviewable as an error and prevents approval without creating an orphan task', async (t) => {
  const { owner, editor } = await setup(t);
  const item = await create(editor);
  const detail = await owner.readApproval(item.id);
  await editor.command('documents:delete', {
    documentId: 'doc-1',
    relativePath: 'ideas/a.md',
  });
  const fresh = await owner.readApproval(item.id);
  assert.equal(fresh.reviewToken, null);
  assert.ok(fresh.reviewError);
  await assert.rejects(start(owner, detail));
  await owner.refresh();
  assert(!Object.keys(owner.files).some((p) => p.startsWith('.ai/tasks/')));
  assert.equal((await owner.readApproval(item.id)).item.status, 'pending');
});
