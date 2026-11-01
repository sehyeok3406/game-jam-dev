import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import {
  documentName,
  documentNamePath,
  availableDocumentName,
} from '../src/core/documents/file-name.ts';
import {
  DocumentNameService,
  planDocumentName,
} from '../src/application/editing/document-name-service.ts';
import { remapLayoutMarkdown } from '../src/adapters/markdown/layout-links.ts';
import { filesystemProjectRepository } from '../src/adapters/filesystem/local-project-repository.ts';
import { filesystemDocumentRepository } from '../src/adapters/filesystem/document-repository.ts';
import { recoverDocumentNames } from '../src/adapters/filesystem/document-name-transaction.ts';

const markdown = {
  parse: (raw) => matter(raw),
  stringify: (body, data) => matter.stringify(body, data),
};
const raw = matter.stringify('# 원본 제목\n\n보존할 본문\n', {
  id: 'stable',
  title: '원본 제목',
  type: 'idea',
  x: 50,
  custom: { keep: true },
});
const input = {
  scope: 'test',
  objectId: 'stable',
  relativePath: 'docs/note.md',
  expectedTitle: '원본 제목',
  expectedBody: '# 원본 제목\n\n보존할 본문',
  name: '새 문서 이름',
};
test('one filename rule preserves Korean/spaces, normalizes Unicode and rejects unsupported names', () => {
  assert.equal(documentName('  한글 문서  '), '한글 문서');
  assert.equal(documentName('가'.normalize('NFD')), '가');
  assert.throws(() => documentName('\ud800'), /문자/);
  const emojis = '😀'.repeat(50);
  const suggested = availableDocumentName(emojis, 'docs', [
    `docs/${emojis}.md`,
  ]);
  assert.equal(documentName(suggested), suggested);
  for (const name of [
    '',
    ' ',
    'a/b',
    'a\\b',
    'a:b',
    '<x>',
    'a?',
    'a*',
    'a|',
    'a"',
    'a\n',
    'x\t',
    'CON',
    'nul.txt',
    'COM¹',
    'LPT9',
    'a.',
    '.x',
    '..',
    'x'.repeat(101),
  ])
    assert.throws(() => documentName(name), undefined, name);
  assert.equal(
    availableDocumentName('한글 문서', 'docs', [
      'docs/한글 문서.md',
      'docs/한글 문서 (2).md',
    ]),
    '한글 문서 (3)',
  );
  assert.throws(
    () =>
      documentNamePath('docs/a.md', '가', [
        'docs/a.md',
        'docs/' + '가'.normalize('NFD') + '.md',
      ]),
    /같은 이름/,
  );
  assert.throws(
    () => documentNamePath('docs/a.md', 'CASE', ['docs/a.md', 'docs/case.md']),
    /같은 이름/,
  );
  assert.equal(
    documentNamePath('docs/Case.md', 'case', ['docs/Case.md']).to,
    'docs/case.md',
  );
});

const files = () => ({
  'docs/note.md': raw,
  'docs/ref.md': matter.stringify(
    '[표시 이름](note.md#part)\n\n[내부](gamejam://file/docs%2Fnote.md)\n\n[ID](gamejam://document/stable)\n\n`note.md` 단순 텍스트 note.md\n',
    {
      id: 'ref',
      title: '참조',
      sources: [{ path: 'docs/note.md', contribution: 'docs/note.md' }],
    },
  ),
  'sections/section.md': matter.stringify('섹션 원문\n', {
    id: 'section',
    members: [{ id: 'stable', path: 'docs/note.md' }],
  }),
  '.canvas/authorship.json': JSON.stringify({
    files: { 'docs/note.md': { createdBy: 'user' } },
  }),
  'output/index.html': '<h1>note.md</h1>',
});
test('read-only plan moves identity and parsed references while preserving source heading, custom data, prose and HTML', () => {
  const before = files(),
    untouched = structuredClone(before);
  const plan = planDocumentName(before, input, markdown, remapLayoutMarkdown);
  assert.deepEqual(before, untouched);
  assert.equal(plan.files['docs/note.md'], undefined);
  const moved = matter(plan.files['docs/새 문서 이름.md']);
  assert.equal(moved.data.id, 'stable');
  assert.equal(moved.data.title, input.name);
  assert.equal(moved.content, matter(raw).content);
  assert.deepEqual(moved.data.custom, { keep: true });
  const ref = matter(plan.files['docs/ref.md']);
  assert.match(ref.content, /새%20문서%20이름.md#part/);
  assert.match(ref.content, /gamejam:\/\/file\/docs%2F/);
  assert.match(ref.content, /gamejam:\/\/document\/stable/);
  assert.match(ref.content, /`note.md` 단순 텍스트 note.md/);
  assert.equal(ref.data.sources[0].path, 'docs/새 문서 이름.md');
  assert.equal(ref.data.sources[0].contribution, 'docs/note.md');
  assert.equal(
    matter(plan.files['sections/section.md']).data.members[0].path,
    'docs/새 문서 이름.md',
  );
  assert.equal(plan.files['output/index.html'], before['output/index.html']);
  assert.ok(
    JSON.parse(plan.files['.canvas/authorship.json']).files[
      'docs/새 문서 이름.md'
    ],
  );
  for (const patch of [
    { expectedTitle: 'stale' },
    { expectedBody: 'stale' },
    { objectId: 'other' },
  ])
    assert.throws(
      () =>
        planDocumentName(
          before,
          { ...input, ...patch },
          markdown,
          remapLayoutMarkdown,
        ),
      /변경/,
    );
  assert.throws(
    () =>
      planDocumentName(
        { ...before, 'docs/새 문서 이름.md': raw },
        input,
        markdown,
        remapLayoutMarkdown,
      ),
    /같은 이름/,
  );
});
async function setup(t, initial = files()) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-document-name-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [p, text] of Object.entries(initial)) {
    await fs.mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await fs.writeFile(path.join(root, p), text);
  }
  const project = filesystemProjectRepository(root);
  const service = new DocumentNameService({
    project,
    documents: filesystemDocumentRepository(root, () => {}),
    markdown,
    links: remapLayoutMarkdown,
  });
  return { root, project, service };
}
test('native rename, case-only rename, repeat rename and inverse apply preserve files and stable identity', async (t) => {
  const { root, project, service } = await setup(t);
  const before = await project.capture();
  const first = await service.rename(input);
  assert.equal(first.document.relativePath, 'docs/새 문서 이름.md');
  assert.equal(first.document.id, 'stable');
  await assert.rejects(fs.access(path.join(root, input.relativePath)));
  const after = await project.capture();
  const reverse = Object.fromEntries(
    Object.keys({ ...before, ...after })
      .filter((p) => before[p] !== after[p])
      .map((p) => [p, before[p] ?? null]),
  );
  await project.apply(after, reverse);
  assert.deepEqual(await project.capture(), before);
  const caseName = await service.rename({ ...input, name: 'NOTE' });
  assert.ok((await fs.readdir(path.join(root, 'docs'))).includes('NOTE.md'));
  const second = await service.rename({
    ...input,
    relativePath: caseName.document.relativePath,
    expectedTitle: 'NOTE',
    name: 'note',
  });
  assert.ok((await fs.readdir(path.join(root, 'docs'))).includes('note.md'));
  assert.equal(second.document.id, 'stable');
});
test('path-derived IDs become stable and fixed/internal files cannot be renamed', () => {
  const legacy = matter.stringify('본문\n', { title: '이전 이름' });
  const plan = planDocumentName(
    { 'ideas/legacy.md': legacy },
    {
      ...input,
      objectId: 'ideas/legacy.md',
      relativePath: 'ideas/legacy.md',
      expectedTitle: '이전 이름',
      expectedBody: '본문',
    },
    markdown,
    remapLayoutMarkdown,
  );
  assert.equal(
    matter(plan.files['ideas/새 문서 이름.md']).data.id,
    'ideas/legacy.md',
  );
  assert.throws(
    () =>
      planDocumentName(
        { 'project.md': raw },
        { ...input, relativePath: 'project.md' },
        markdown,
        remapLayoutMarkdown,
      ),
    /파일 구조 정리/,
  );
});

test('unchanged canonical names produce no writes and historic layout aliases retain their origins', () => {
  const canonical = matter.stringify('본문\n', { id: 'stable', title: 'note' });
  const before = {
    'docs/note.md': canonical,
    '.canvas/layout.json': JSON.stringify(
      { version: 2, aliases: { 'ideas/old.md': 'docs/note.md' } },
      null,
      2,
    ),
  };
  const same = planDocumentName(
    before,
    { ...input, expectedTitle: 'note', expectedBody: '본문', name: 'note' },
    markdown,
    remapLayoutMarkdown,
  );
  assert.deepEqual(same.changes, {});
  const renamed = planDocumentName(
    before,
    { ...input, expectedTitle: 'note', expectedBody: '본문' },
    markdown,
    remapLayoutMarkdown,
  );
  assert.deepEqual(JSON.parse(renamed.files['.canvas/layout.json']).aliases, {
    'ideas/old.md': 'docs/새 문서 이름.md',
  });
});
test('interrupted multi-file rename rolls back on reopen; external edits preserve the journal and all current bytes', async (t) => {
  const { root, project } = await setup(t);
  const plan = planDocumentName(
    await project.capture(),
    input,
    markdown,
    remapLayoutMarkdown,
  );
  const journalPath = path.join(
    root,
    '.gamejam/local/document-names/pending.json',
  );
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  const journal = {
    version: 1,
    before: Object.fromEntries(
      Object.keys(plan.changes)
        .filter((p) => plan.before[p] !== undefined)
        .map((p) => [p, plan.before[p]]),
    ),
    changes: plan.changes,
  };
  await fs.writeFile(journalPath, JSON.stringify(journal));
  await fs.rm(path.join(root, 'docs/note.md'));
  await fs.writeFile(
    path.join(root, 'docs/새 문서 이름.md'),
    plan.files['docs/새 문서 이름.md'],
  );
  await fs.writeFile(path.join(root, 'docs/ref.md'), plan.files['docs/ref.md']);
  await recoverDocumentNames(root);
  assert.deepEqual(await project.capture(), plan.before);
  await assert.rejects(fs.access(journalPath));
  await fs.writeFile(journalPath, JSON.stringify(journal));
  await fs.writeFile(path.join(root, 'docs/ref.md'), '외부에서 수정');
  await assert.rejects(recoverDocumentNames(root), /외부 변경/);
  assert.equal(
    await fs.readFile(path.join(root, 'docs/ref.md'), 'utf8'),
    '외부에서 수정',
  );
  assert.equal(await fs.readFile(path.join(root, 'docs/note.md'), 'utf8'), raw);
  await fs.access(journalPath);
});
