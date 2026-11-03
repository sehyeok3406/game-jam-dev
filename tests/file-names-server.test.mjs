import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { htmlHash, htmlSourceId, describePreview } from '../src/html-source.ts';
const raw = matter.stringify('기존 본문\n', {
  id: 'a',
  title: 'a',
  type: 'idea',
});
test('actual server preserves two clients, offline body edits and stable identity across MD and HTML rename', async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-names-server-'),
  );
  let server = await createCollaborationServer({
    dataDirectory: root,
    creationKey: 'test',
    port: 0,
  });
  const clients = [];
  t.after(async () => {
    for (const c of clients) c.stop();
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    'test',
    '이름 통일 검사',
    'owner',
    { 'docs/a.md': raw, 'output/index.html': '<body>게임</body>' },
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  clients.push(owner);
  await owner.refresh();
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'editor',
  );
  const editor = new CollaborationClient(joined.credentials, () => {});
  clients.push(editor);
  await editor.refresh();
  const old = { ...editor.files };
  editor.state.connected = false;
  await editor.command('documents:save', {
    relativePath: 'docs/a.md',
    objectId: 'a',
    title: 'a',
    body: '미전송 본문',
  });
  await assert.rejects(
    editor.command('documents:rename', {
      scope: 's',
      relativePath: 'docs/a.md',
      objectId: 'a',
      expectedTitle: 'a',
      expectedBody: '미전송 본문',
      name: 'offline',
    }),
    /온라인/,
  );
  await owner.command('documents:rename', {
    scope: 's',
    relativePath: 'docs/a.md',
    objectId: 'a',
    expectedTitle: 'a',
    expectedBody: '기존 본문',
    name: '새 이름',
  });
  await editor.refresh();
  await owner.refresh();
  assert.equal(editor.offline, null, JSON.stringify(editor.state.conflicts));
  assert.equal(
    matter(owner.files['docs/새 이름.md']).content.trim(),
    '미전송 본문',
  );
  assert.equal(matter(owner.files['docs/새 이름.md']).data.title, '새 이름');
  assert.equal(owner.files['docs/a.md'], undefined);
  assert.equal(old['docs/a.md'], raw);
  const before = owner.files['output/index.html'];
  await owner.command('preview:rename', {
    scope: 's',
    relativePath: 'output/index.html',
    objectId: htmlSourceId('output/index.html'),
    expectedHash: htmlHash(before),
    name: '게임 화면',
  });
  await editor.refresh();
  assert.equal(
    describePreview(editor.files, 'output/게임 화면.html').sourceId,
    htmlSourceId('output/index.html'),
  );
  const prior = owner.lastCommandHistoryId;
  await owner.changeHistory(prior, 'undo');
  await editor.refresh();
  assert.equal(editor.files['output/index.html'], before);
  await owner.changeHistory(prior, 'redo');
  await editor.refresh();
  assert.equal(editor.files['output/게임 화면.html'], before);
  await editor.lock('docs/새 이름.md');
  await owner.refresh();
  await assert.rejects(
    owner.command('documents:rename', {
      scope: 's',
      relativePath: 'docs/새 이름.md',
      objectId: 'a',
      expectedTitle: '새 이름',
      expectedBody: '미전송 본문',
      name: '잠금 검사',
    }),
    /편집 중/,
  );
  await editor.unlock('docs/새 이름.md');
  await editor.refresh();
  const saved = editor.state.documentNamesVersion;
  editor.state.documentNamesVersion = undefined;
  await assert.rejects(
    editor.command('documents:rename', {
      scope: 's',
      relativePath: 'docs/새 이름.md',
      objectId: 'a',
      expectedTitle: '새 이름',
      expectedBody: '미전송 본문',
      name: 'old',
    }),
    /업데이트/,
  );
  editor.state.documentNamesVersion = saved;
  const command = (name) => ({
    scope: 's',
    relativePath: 'docs/새 이름.md',
    objectId: 'a',
    expectedTitle: '새 이름',
    expectedBody: '미전송 본문',
    name,
  });
  const raced = await Promise.allSettled([
    owner.command('documents:rename', command('경쟁 하나')),
    editor.command('documents:rename', command('경쟁 둘')),
  ]);
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
  await owner.refresh();
  await editor.refresh();
  const canonical = Object.keys(owner.files).find(
    (p) => p.startsWith('docs/') && matter(owner.files[p]).data.id === 'a',
  );
  assert.equal(matter(owner.files[canonical]).content.trim(), '미전송 본문');
  const input = {
    scope: 's',
    relativePath: canonical,
    objectId: 'a',
    expectedTitle: matter(owner.files[canonical]).data.title,
    expectedBody: '미전송 본문',
    name: '재시도 이름',
  };
  const packet = {
    id: randomUUID(),
    channel: 'documents:rename',
    input,
    revisions: { ...owner.revisions },
    documentNamesVersion: 1,
    propertySyncVersion: 1,
    sessionId: randomUUID(),
    sequence: 1,
    properties: structuredClone(owner.properties),
    objects: Object.fromEntries(
      Object.entries(owner.files)
        .filter(([p]) => p.endsWith('.md'))
        .map(([p, raw]) => [p, matter(raw).data.id ?? p]),
    ),
    knownRevision: owner.state.revision,
    deltaVersion: 1,
    canvasSheetsVersion: 1,
    documentStatusesVersion: 1,
    filePropertiesVersion: 1,
  };
  const endpoint = `/projects/${owner.credentials.projectId}/command`;
  const first = await CollaborationClient.fetch(
    url,
    endpoint,
    packet,
    owner.credentials.token,
  );
  // Replay the exact request after the first response was not consumed by a client.
  const replay = await CollaborationClient.fetch(
    url,
    endpoint,
    packet,
    owner.credentials.token,
  );
  assert.equal(replay.historyId, first.historyId);
  await owner.refresh();
  await editor.refresh();
  assert.equal(matter(owner.files['docs/재시도 이름.md']).data.id, 'a');
  await owner.setRole(editor.state.memberId, 'viewer');
  await editor.refresh();
  await assert.rejects(
    editor.command('documents:rename', {
      ...input,
      relativePath: 'docs/재시도 이름.md',
      expectedTitle: '재시도 이름',
      name: '뷰어 우회',
    }),
    /권한|보기|관리자|뷰어/,
  );
  const unsupported = await fetch(url + endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${owner.credentials.token}`,
    },
    body: JSON.stringify({
      ...packet,
      id: randomUUID(),
      documentNamesVersion: undefined,
    }),
  });
  assert.equal(unsupported.status, 409);
  const port = server.port;
  for (const client of clients) client.stop();
  await server.close();
  server = await createCollaborationServer({
    dataDirectory: root,
    creationKey: 'test',
    port,
  });
  await owner.refresh();
  assert.equal(
    matter(owner.files['docs/재시도 이름.md']).content.trim(),
    '미전송 본문',
  );
  const reopened = await CollaborationClient.fetch(
    url,
    endpoint,
    packet,
    owner.credentials.token,
  );
  assert.equal(reopened.historyId, first.historyId);
  assert.equal(
    describePreview(owner.files, 'output/게임 화면.html').sourceId,
    htmlSourceId('output/index.html'),
  );
});
