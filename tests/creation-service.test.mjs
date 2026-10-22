import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { LocalCreationService } from '../src/application/editing/creation-service.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
import { filesystemDocumentRepository } from '../src/adapters/filesystem/document-repository.ts';
import { markdownCodec } from '../src/adapters/filesystem/markdown-codec.ts';
import { projectPath } from '../src/project-store.ts';
async function setup(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-creation-')),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'docs'));
  await fs.writeFile(
    path.join(root, 'docs/a.md'),
    '---\nid: original-a\ntitle: 한글 원본\ntype: idea\nx: 10\ny: 20\ncustom: keep\n---\n원본 본문 [[link]]\n',
  );
  const service = new LocalCreationService({
    project: filesystemProjectRepository(root),
    documents: filesystemDocumentRepository(root, () => {}),
    markdown: markdownCodec,
    environment: {
      now: () => Date.UTC(2026, 9, 20),
      id: () => '12345678-1234-4000-8000-123456789abc',
    },
    validatePath: async (relative) => {
      await projectPath(root, relative);
    },
  });
  return { root, service };
}
test('local copy preserves legacy IDs, body, unknown frontmatter, offsets and originals', async (t) => {
  const { root, service } = await setup(t);
  const before = await fs.readFile(path.join(root, 'docs/a.md'), 'utf8');
  const [copy] = await service.duplicate({
    documents: [
      { id: 'original-a', path: 'docs/a.md' },
      { id: 'original-a', path: 'docs/a.md' },
    ],
    offsetX: 32,
    offsetY: 64,
  });
  assert.equal(copy.id, 'original-a-copy-12345678');
  assert.equal(copy.relativePath, 'docs/a-copy-12345678.md');
  assert.equal(copy.title, '한글 원본 복사본');
  assert.deepEqual(
    [copy.x, copy.y, copy.width, copy.height],
    [42, 84, 340, 300],
  );
  const parsed = matter(
    await fs.readFile(path.join(root, copy.relativePath), 'utf8'),
  );
  assert.equal(parsed.data.custom, 'keep');
  assert.equal(parsed.content, matter(before).content);
  assert.equal(await fs.readFile(path.join(root, 'docs/a.md'), 'utf8'), before);
});
test('a later invalid copy source publishes no earlier copy and a collision never overwrites an existing file', async (t) => {
  const { root, service } = await setup(t);
  await assert.rejects(
    service.duplicate({
      documents: [
        { id: 'original-a', path: 'docs/a.md' },
        { id: 'missing', path: 'docs/missing.md' },
      ],
      offsetX: 32,
      offsetY: 32,
    }),
  );
  assert.deepEqual(await fs.readdir(path.join(root, 'docs')), ['a.md']);
  await fs.writeFile(
    path.join(root, 'docs/a-copy-12345678.md'),
    'external file',
  );
  // The original legacy path can already exist; a captured baseline must not authorize overwriting it.
  await assert.rejects(
    service.duplicate({
      documents: [{ id: 'original-a', path: 'docs/a.md' }],
      offsetX: 32,
      offsetY: 32,
    }),
    /이미|외부|중복/,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'docs/a-copy-12345678.md'), 'utf8'),
    'external file',
  );
});
test('task generation retains local timestamp filenames, protects input paths and creates the existing task format', async (t) => {
  const { root, service } = await setup(t);
  await assert.rejects(
    service.createTask({
      kind: 'organize',
      inputPaths: ['../outside.md'],
      x: 1,
      y: 1,
    }),
  );
  const created = await service.createTask({
    kind: 'organize',
    inputPaths: ['docs/a.md'],
    x: 30,
    y: 40,
  });
  assert.equal(
    created.relativePath,
    '.ai/tasks/organize-2026-10-20T00-00-00-000Z-12345678.md',
  );
  assert.match(created.body, /docs\/a.md/);
  assert.equal(created.type, 'ai-task');
  assert.equal(
    await fs
      .readFile(path.join(root, 'docs/a.md'), 'utf8')
      .then((raw) => matter(raw).data.id),
    'original-a',
  );
});

test('copy rejects a replacement at the same path, while legacy path identities remain supported', async (t) => {
  const { root, service } = await setup(t);
  const original = await fs.readFile(path.join(root, 'docs/a.md'), 'utf8');
  await assert.rejects(
    service.duplicate({
      documents: [{ id: 'old-id', path: 'docs/a.md' }],
    }),
    /복사할 문서/,
  );
  assert.deepEqual(await fs.readdir(path.join(root, 'docs')), ['a.md']);
  assert.equal(
    await fs.readFile(path.join(root, 'docs/a.md'), 'utf8'),
    original,
  );
  await fs.writeFile(path.join(root, 'docs/legacy.md'), '레거시 본문\n');
  const [copy] = await service.duplicate({
    documents: [{ id: 'docs/legacy.md', path: 'docs/legacy.md' }],
  });
  assert.equal(copy.id, 'docs/legacy.md-copy-12345678');
  assert.equal(copy.body, '레거시 본문');
});
