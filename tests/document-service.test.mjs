import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { filesystemDocumentRepository } from '../src/adapters/filesystem/document-repository.ts';
import { DocumentEditingService } from '../src/application/editing/document-service.ts';
import { reduceCollaboration } from '../src/collaboration-model.ts';

const raw =
  '---\nid: stable-id\ntitle: 기존 제목\ntype: idea\ncanvas_id: main\nx: 20\ncustom: keep\nsources:\n  - id: another\n    contribution: 기획\n---\n원래 본문\n';
async function setup(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-document-service-'),
  );
  await fs.mkdir(path.join(root, 'docs'));
  const filename = path.join(root, 'docs/note.md');
  await fs.writeFile(filename, raw);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, filename };
}
test('local service and shared reducer preserve document identity, metadata and link semantics', async (t) => {
  const { root, filename } = await setup(t);
  const service = new DocumentEditingService(
    filesystemDocumentRepository(root, () => {}),
  );
  const input = {
    relativePath: 'docs/note.md',
    objectId: 'stable-id',
    expectedTitle: '기존 제목',
    expectedBody: '원래 본문',
    title: '  수정 제목  ',
    body: '한글 [[another]] 본문\n\n두 번째 문단',
  };
  const saved = await service.save(input);
  const shared = reduceCollaboration(
    {
      'docs/note.md': raw,
      '.canvas/canvases.json': JSON.stringify({
        version: 1,
        canvases: [{ id: 'main', name: '기본' }],
      }),
    },
    'documents:save',
    input,
  );
  const local = matter(await fs.readFile(filename, 'utf8'));
  const remote = matter(shared.files['docs/note.md']);
  assert.equal(shared.result, undefined);
  assert.equal(saved.id, 'stable-id');
  assert.equal(saved.title, '수정 제목');
  assert.equal(saved.body, input.body);
  assert.equal(local.content.trim(), remote.content.trim());
  for (const field of [
    'id',
    'title',
    'type',
    'canvas_id',
    'x',
    'custom',
    'sources',
  ])
    assert.deepEqual(local.data[field], remote.data[field], field);
  assert.equal(saved.sources[0].contribution, '기획');
});

test('external changes, replacement identity and stale session never overwrite the current file', async (t) => {
  const { root, filename } = await setup(t);
  let current = true;
  const repository = filesystemDocumentRepository(root, () => {
    if (!current) throw Error('세션 변경');
  });
  const service = new DocumentEditingService(repository);
  await assert.rejects(
    service.save({
      relativePath: 'docs/note.md',
      objectId: 'different',
      title: '수정',
      body: '내용',
    }),
    /식별자/,
  );
  await assert.rejects(
    service.save({
      relativePath: 'docs/note.md',
      expectedTitle: '기존 제목',
      expectedBody: '다른 본문',
      title: '수정',
      body: '내용',
    }),
    /외부.*변경/,
  );
  const stored = await repository.read('docs/note.md');
  await fs.writeFile(filename, raw + '\n외부 편집');
  await assert.rejects(
    repository.replace('docs/note.md', stored.raw, {
      title: '수정',
      body: '내용',
    }),
    /외부.*변경/,
  );
  assert.match(await fs.readFile(filename, 'utf8'), /외부 편집/);
  assert.deepEqual(await fs.readdir(path.dirname(filename)), ['note.md']);
  current = false;
  await assert.rejects(
    service.save({ relativePath: 'docs/note.md', title: '수정', body: '내용' }),
    /세션 변경/,
  );
  await assert.rejects(repository.read('../outside.md'), /세션 변경/);
  current = true;
  await assert.rejects(repository.read('../outside.md'), /프로젝트 밖/);
});

test('layout and collapse update only one document and preserve its body and unknown metadata', async (t) => {
  const { root, filename } = await setup(t);
  await fs.mkdir(path.join(root, 'output'));
  // A desktop metadata edit must not capture or reject an unrelated large HTML result.
  await fs.writeFile(
    path.join(root, 'output/index.html'),
    '<html>' + 'x'.repeat(8_000_001) + '</html>',
  );
  const service = new DocumentEditingService(
    filesystemDocumentRepository(root, () => {}),
  );
  const original = matter(await fs.readFile(filename, 'utf8'));
  await service.updateLayout({
    relativePath: 'docs/note.md',
    x: 100.4,
    y: 200.6,
    width: 500,
    height: 400,
    position: true,
    size: false,
  });
  await service.setCollapsed({ relativePath: 'docs/note.md', collapsed: true });
  const after = matter(await fs.readFile(filename, 'utf8'));
  assert.equal(after.content, original.content);
  assert.equal(after.data.id, 'stable-id');
  assert.equal(after.data.custom, 'keep');
  assert.deepEqual(after.data.sources, original.data.sources);
  assert.equal(after.data.x, 100);
  assert.equal(after.data.y, 201);
  assert.equal(
    after.data.width,
    original.data.width,
    'omitted size metadata stays omitted',
  );
  assert.equal(after.data.collapsed, true);
  const beforeInvalid = await fs.readFile(filename, 'utf8');
  await assert.rejects(
    service.updateLayout({
      relativePath: 'docs/note.md',
      x: Infinity,
      y: 0,
      width: 500,
      height: 400,
    }),
  );
  assert.equal(await fs.readFile(filename, 'utf8'), beforeInvalid);
});

test('layout rejects a replaced document before writing, and accepts the current identity', async (t) => {
  const { root, filename } = await setup(t);
  const service = new DocumentEditingService(
    filesystemDocumentRepository(root, () => {}),
  );
  const input = {
    relativePath: 'docs/note.md',
    objectId: 'stale-id',
    x: 90,
    y: 80,
    width: 500,
    height: 400,
  };
  await assert.rejects(service.updateLayout(input), /식별자/);
  assert.equal(await fs.readFile(filename, 'utf8'), raw);
  await service.updateLayout({ ...input, objectId: 'stable-id' });
  const after = matter(await fs.readFile(filename, 'utf8'));
  assert.equal(after.data.x, 90);
  assert.equal(after.content, matter(raw).content);
});
