import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { snapshotDocuments } from '../src/collaboration-model.ts';
import {
  DocumentLinkIndex,
  documentLinkMarkdown,
  resolveDocumentLink,
} from '../src/document-links.ts';

test('two peers share links and live target names without rewriting the source; legacy metadata remains explicit', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-links-collab-'),
  );
  const server = await createCollaborationServer({
    port: 0,
    dataDirectory: root,
    creationKey: 'test',
  });
  let owner, peer;
  try {
    const created = await CollaborationClient.create(
      `http://127.0.0.1:${server.port}`,
      'test',
      '관리자',
      '링크 검증',
      {
        'project.md': '---\nid: a\ntitle: 원본\n---\n본문',
        'docs/b.md': '---\nid: b\ntitle: 이전 제목\n---\n대상',
        'docs/legacy.md': '기존 문서',
      },
    );
    owner = new CollaborationClient(created.credentials, () => {});
    owner.accept(created.result);
    const joined = await CollaborationClient.join(
      owner.credentials.serverUrl,
      owner.credentials.inviteCode,
      '편집자',
    );
    peer = new CollaborationClient(joined.credentials, () => {});
    peer.accept(joined.result);
    const body = documentLinkMarkdown(
      'gamejam://document/b',
      '이전 제목',
      true,
    );
    await owner.lock('project.md');
    await owner.command('documents:save', {
      relativePath: 'project.md',
      title: '원본',
      body,
    });
    await owner.unlock('project.md');
    await peer.refresh();
    const original = peer.files['project.md'];
    await peer.lock('docs/b.md');
    await peer.command('documents:save', {
      relativePath: 'docs/b.md',
      title: '새 제목',
      body: '대상',
    });
    await peer.unlock('docs/b.md');
    await owner.refresh();
    assert.equal(owner.files['project.md'], original);
    const docs = snapshotDocuments(owner.files);
    const resolved = resolveDocumentLink('gamejam://document/b', docs);
    assert.equal(resolved.status, 'found');
    assert.equal(resolved.document.title, '새 제목');
    assert.equal(
      docs.find((d) => d.relativePath === 'docs/legacy.md').identitySource,
      'path',
    );
    const index = new DocumentLinkIndex();
    index.update(docs);
    assert.equal(index.backlinks(resolved.document).length, 1);
    await owner.setRole(peer.state.memberId, 'viewer');
    await peer.refresh();
    assert.equal(
      resolveDocumentLink('gamejam://document/b', snapshotDocuments(peer.files))
        .status,
      'found',
    );
    await assert.rejects(
      peer.command('documents:save', {
        relativePath: 'project.md',
        title: '변조',
        body: '',
      }),
    );
    await owner.setRole(peer.state.memberId, 'editor');
    await peer.refresh();
    await peer.command('documents:delete', {
      documentId: 'b',
      relativePath: 'docs/b.md',
    });
    await owner.refresh();
    assert.equal(
      resolveDocumentLink(
        'gamejam://document/b',
        snapshotDocuments(owner.files),
      ).status,
      'missing',
    );
    assert.equal(owner.files['project.md'], original);
  } finally {
    owner?.stop();
    peer?.stop();
    await server.close();
    assert.ok(root.startsWith(os.tmpdir() + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
