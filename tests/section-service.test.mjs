import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { filesystemProjectReader } from '../src/adapters/filesystem/project-reader.ts';
import { filesystemDocumentRepository } from '../src/adapters/filesystem/document-repository.ts';
import { markdownCodec } from '../src/adapters/filesystem/markdown-codec.ts';
import { LocalSectionService } from '../src/application/editing/section-service.ts';
async function setup(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-section-service-')),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of ['docs', 'sections', 'trash'])
    await fs.mkdir(path.join(root, folder));
  await fs.writeFile(
    path.join(root, 'docs/renamed.md'),
    '---\nid: member\ntitle: renamed\ncanvas_id: default\ncustom: keep\n---\n본문 보존\n',
  );
  await fs.writeFile(
    path.join(root, 'sections/a.md'),
    '---\nid: section-a\ntitle: section\nx: 80\ny: 90\nwidth: 600\nheight: 400\nmembers:\n  - id: member\n    path: docs/original.md\n---\n# section\n',
  );
  const reader = filesystemProjectReader(root),
    errors = [];
  const service = new LocalSectionService({
    sections: reader.sections,
    documents: filesystemDocumentRepository(root, () => {}),
    listDocuments: reader.documents,
    markdown: markdownCodec,
    trash: async (paths) => {
      for (const relative of paths)
        await fs.rename(
          path.join(root, relative),
          path.join(root, 'trash', path.basename(relative)),
        );
    },
    reportError: (message, error) => errors.push([message, error]),
  });
  return { root, service, reader, errors };
}
test('local section move resolves renamed members by ID, preserves document data and applies legacy fallback/minimum sizes', async (t) => {
  const { root, service, reader, errors } = await setup(t);
  await service.updateLayout({
    relativePath: 'sections/a.md',
    x: 100,
    y: 120,
    width: 20,
    height: 30,
  });
  const section = await reader.sections.read('sections/a.md');
  assert.deepEqual(section.members, [
    { id: 'member', path: 'docs/renamed.md' },
  ]);
  assert.deepEqual(
    [section.x, section.y, section.width, section.height],
    [100, 120, 420, 280],
  );
  const doc = matter(
    await fs.readFile(path.join(root, 'docs/renamed.md'), 'utf8'),
  );
  assert.deepEqual([doc.data.x, doc.data.y], [100, 120]);
  assert.equal(doc.data.id, 'member');
  assert.equal(doc.data.custom, 'keep');
  assert.equal(doc.content.trim(), '본문 보존');
  assert.deepEqual(errors, []);
});
test('section-only deletion preserves members; member deletion uses actual resolved file paths', async (t) => {
  const first = await setup(t);
  assert.deepEqual(
    await first.service.delete({
      relativePath: 'sections/a.md',
      sectionId: 'section-a',
      deleteMembers: false,
    }),
    { deletedDocumentCount: 0, preservedDocumentCount: 1 },
  );
  assert.equal((await first.reader.documents())[0].id, 'member');
  assert.equal((await first.reader.sections.list()).length, 0);
  const second = await setup(t);
  assert.deepEqual(
    await second.service.delete({
      relativePath: 'sections/a.md',
      sectionId: 'section-a',
      deleteMembers: true,
    }),
    { deletedDocumentCount: 1, preservedDocumentCount: 0 },
  );
  assert.equal((await second.reader.documents()).length, 0);
  assert.deepEqual((await fs.readdir(path.join(second.root, 'trash'))).sort(), [
    'a.md',
    'renamed.md',
  ]);
  assert.equal(
    (await first.reader.documents())[0].id,
    'member',
    'other project readers remain isolated',
  );
});

test('stale section identity, non-section paths and malformed deletion flags leave all files untouched', async (t) => {
  const { root, service } = await setup(t);
  const section = await fs.readFile(path.join(root, 'sections/a.md'), 'utf8');
  const member = await fs.readFile(path.join(root, 'docs/renamed.md'), 'utf8');
  for (const input of [
    {
      relativePath: 'sections/a.md',
      sectionId: 'old-section',
      deleteMembers: true,
    },
    {
      relativePath: 'sections/a.md',
      sectionId: 'old-section',
      deleteMembers: false,
    },
    {
      relativePath: 'docs/renamed.md',
      sectionId: 'member',
      deleteMembers: false,
    },
    {
      relativePath: 'sections/a.md',
      sectionId: 'section-a',
      deleteMembers: 'false',
    },
  ])
    await assert.rejects(service.delete(input));
  assert.equal(
    await fs.readFile(path.join(root, 'sections/a.md'), 'utf8'),
    section,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'docs/renamed.md'), 'utf8'),
    member,
  );
  assert.deepEqual(await fs.readdir(path.join(root, 'trash')), []);
});

test('invalid layout or replaced section is rejected before moving members', async (t) => {
  const { root, service } = await setup(t);
  const section = await fs.readFile(path.join(root, 'sections/a.md'), 'utf8');
  const member = await fs.readFile(path.join(root, 'docs/renamed.md'), 'utf8');
  const layout = {
    relativePath: 'sections/a.md',
    x: 100,
    y: 120,
    width: 600,
    height: 400,
  };
  for (const input of [
    { ...layout, objectId: 'old-section' },
    { ...layout, x: Infinity },
    { ...layout, height: NaN },
    { ...layout, width: 1_000_001 },
    { ...layout, y: '120' },
    { ...layout, relativePath: 'docs/renamed.md' },
  ])
    await assert.rejects(service.updateLayout(input));
  assert.equal(
    await fs.readFile(path.join(root, 'sections/a.md'), 'utf8'),
    section,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'docs/renamed.md'), 'utf8'),
    member,
  );
});

test('section layout and membership repair preserve user body, custom metadata and workflow', async (t) => {
  const { root, service } = await setup(t);
  const original = matter(
    await fs.readFile(path.join(root, 'sections/a.md'), 'utf8'),
  );
  const content = '\n# 직접 작성한 섹션\n\n본문 [[member]] 유지\n';
  await fs.writeFile(
    path.join(root, 'sections/a.md'),
    matter.stringify(content, {
      ...original.data,
      status: 'custom-status',
      type: 'section',
      custom: { nested: ['값'] },
    }),
  );
  await service.updateLayout({
    relativePath: 'sections/a.md',
    objectId: 'section-a',
    x: 100,
    y: 120,
    width: 600,
    height: 400,
  });
  const moved = matter(
    await fs.readFile(path.join(root, 'sections/a.md'), 'utf8'),
  );
  assert.equal(moved.content, content);
  assert.equal(moved.data.status, 'custom-status');
  assert.deepEqual(moved.data.custom, { nested: ['값'] });
  await fs.writeFile(
    path.join(root, 'sections/b.md'),
    matter.stringify('\n다른 섹션\n', { ...original.data, id: 'section-b' }),
  );
  await service.delete({
    relativePath: 'sections/b.md',
    sectionId: 'section-b',
    deleteMembers: true,
  });
  const repaired = matter(
    await fs.readFile(path.join(root, 'sections/a.md'), 'utf8'),
  );
  assert.deepEqual(repaired.data.members, []);
  assert.equal(repaired.content, content);
  assert.equal(repaired.data.status, 'custom-status');
  assert.deepEqual(repaired.data.custom, { nested: ['값'] });
});

test('sections without an explicit ID retain legacy path identity for deletion', async (t) => {
  const { root, service } = await setup(t);
  await fs.writeFile(path.join(root, 'sections/legacy.md'), '# 이전 섹션\n');
  await service.delete({
    relativePath: 'sections/legacy.md',
    sectionId: 'sections/legacy.md',
    deleteMembers: false,
  });
  assert.equal(
    await fs.readFile(path.join(root, 'trash/legacy.md'), 'utf8'),
    '# 이전 섹션\n',
  );
});
