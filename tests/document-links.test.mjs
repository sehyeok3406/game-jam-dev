import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkdownManager } from '@tiptap/markdown';
import { Editor } from '@tiptap/core';
import { JSDOM } from 'jsdom';
import { refreshDocumentLinkViews } from '../src/document-link-node.ts';
import { markdownExtensions } from '../src/markdown-extensions.ts';
import { canEditMarkdownVisually } from '../src/markdown-editing.ts';
import {
  AUTO_LINK_TITLE,
  parseDocumentLink,
  documentLinkHref,
  documentLinkMarkdown,
  resolveDocumentLink,
  extractDocumentLinks,
  sourceLinkQuery,
  searchLinkDocuments,
  DocumentLinkIndex,
} from '../src/document-links.ts';
const doc = (id, title = id, extra = {}) => ({
  id,
  title,
  relativePath: `docs/${id}.md`,
  identitySource: 'frontmatter',
  body: '',
  canvasId: 'default',
  ...extra,
});

test('internal URIs distinguish stable IDs from legacy paths and reject unsafe/unsupported forms', () => {
  const stable = doc('한글 / # ? %');
  assert.deepEqual(parseDocumentLink(documentLinkHref(stable)), {
    kind: 'document',
    value: stable.id,
  });
  const legacy = doc('docs/한글.md', '기존', {
    relativePath: 'docs/한글.md',
    identitySource: 'path',
  });
  assert.deepEqual(parseDocumentLink(documentLinkHref(legacy)), {
    kind: 'file',
    value: legacy.relativePath,
  });
  assert.throws(() =>
    documentLinkHref(doc('unknown', 'unknown', { identitySource: undefined })),
  );
  for (const uri of [
    'gamejam://document/',
    'gamejam://document/%zz',
    'gamejam://document/a?x=1',
    'gamejam://document/a#x',
    'gamejam://file/..%2Fx.md',
    'gamejam://file/C%3A%2Fx.md',
    'gamejam://file/%2Fx.md',
    'gamejam://file/a%5Cb.md',
    'gamejam://document/%00',
    'javascript:alert(1)',
    'gamejam://execute/a',
  ])
    assert.equal(parseDocumentLink(uri), null, uri);
});
test('identity resolution survives title/path changes, never guesses by title, and refuses duplicate IDs', () => {
  const href = documentLinkHref(doc('a'));
  assert.equal(
    resolveDocumentLink(href, [
      doc('a', '새 제목', { relativePath: 'docs/moved.md' }),
    ]).status,
    'found',
  );
  assert.equal(resolveDocumentLink(href, [doc('b', 'a')]).status, 'missing');
  assert.equal(
    resolveDocumentLink(href, [
      doc('a'),
      doc('a', '중복', { relativePath: 'docs/duplicate.md' }),
    ]).status,
    'ambiguous',
  );
});
test('automatic names use an atom with an explicit marker; normal user text remains an ordinary link', () => {
  const manager = new MarkdownManager({ extensions: markdownExtensions() });
  for (const label of [
    '전투 시스템',
    '대괄호 [제목] · *별* · \\ 경로',
    '한글 & <태그>',
    '장비 | &copy; &quot; "설명"',
  ]) {
    const body = documentLinkMarkdown('gamejam://document/a', label, true);
    const json = manager.parse(body);
    assert.equal(json.content[0].content[0].type, 'documentLink');
    assert.equal(json.content[0].content[0].attrs.label, label);
    assert.ok(
      canEditMarkdownVisually(body, manager.serialize(json)),
      manager.serialize(json),
    );
  }
  const body =
    '[나만의 문구](gamejam://document/a) · [웹](https://example.com)';
  const json = manager.parse(body);
  assert.equal(json.content[0].content[0].type, 'text');
  assert.ok(canEditMarkdownVisually(body, manager.serialize(json)));
});
test('backlink extraction resolves reference links but excludes examples, images and unused definitions', () => {
  const auto = documentLinkMarkdown('gamejam://document/a', 'A', true);
  const body = `${auto}\n\n[참조][r]\n\n[r]: gamejam://document/b\n[unused]: gamejam://document/c\n\n\`[코드](gamejam://document/c)\`\n\n\`\`\`md\n${auto}\n\`\`\`\n\n![이미지](gamejam://document/c)\n\n[[일반 텍스트]]`;
  const links = extractDocumentLinks(body);
  assert.deepEqual(
    links.map((l) => l.href),
    ['gamejam://document/a', 'gamejam://document/b'],
  );
  assert.equal(links[0].automatic, true);
  assert.equal(links[1].automatic, false);
});
test('source triggers protect code, links, images and escaped brackets', () => {
  for (const body of ['[[전투', '문장 [[전투'])
    assert.equal(sourceLinkQuery(body, body.length)?.query, '전투');
  for (const [body, caret] of [
    ['`[[전투`', 5],
    ['```md\n[[전투', 10],
    ['\\[[전투', 5],
    ['[문구 [[전투](https://example.com)', 8],
    ['![[전투](image.png)', 5],
  ])
    assert.equal(sourceLinkQuery(body, caret), null, body);
});
test('index updates deletion/restoration and keeps repeated sources and self references out of duplicates', () => {
  const index = new DocumentLinkIndex();
  const a = doc('a'),
    b = doc('b', 'B', {
      body: '[A](gamejam://document/a) [A](gamejam://document/a)',
    });
  index.update([a, b]);
  assert.equal(index.backlinks(a).length, 1);
  index.update([a]);
  assert.equal(index.backlinks(a).length, 0);
  index.update([a, b]);
  assert.equal(index.backlinks(a).length, 1);
  index.update([{ ...a, body: '[A](gamejam://document/a)' }, b]);
  assert.equal(index.backlinks(a).length, 1);
  index.update([a, { ...b, body: '' }]);
  assert.equal(index.backlinks(a).length, 0);
});
test('search normalizes Korean text, prioritizes the current canvas and limits results', () => {
  const documents = [
    doc('a', '전투 시스템', { canvasId: 'second' }),
    doc('b', '전투 시스템'),
    doc('c', '전투'),
  ];
  assert.equal(searchLinkDocuments(documents, '전투')[0].id, 'c');
  assert.equal(
    searchLinkDocuments(documents, '전투 시스템', 'default')[0].id,
    'b',
  );
  assert.equal(
    searchLinkDocuments(documents, '전투 시스템'.normalize('NFD')).length,
    2,
  );
  assert.equal(
    searchLinkDocuments(
      Array.from({ length: 50 }, (_, i) => doc(String(i))),
      '',
    ).length,
    20,
  );
  assert.equal(AUTO_LINK_TITLE, 'gamejam:auto-title');
  assert.equal(searchLinkDocuments([doc(''), doc('\u0000')], '').length, 0);
});

test('real editor renders fresh titles without emitting edits and clipboard HTML retains automatic identity', () => {
  const dom = new JSDOM('<!doctype html><body><div id="editor"></div></body>', {
    pretendToBeVisual: true,
  });
  const previous = new Map();
  const keys = [
    'window',
    'document',
    'navigator',
    'Node',
    'HTMLElement',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: [
        'getComputedStyle',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ].includes(key)
        ? dom.window[key].bind(dom.window)
        : dom.window[key],
    });
  }
  let current = doc('a', '현재 제목'),
    updates = 0;
  const original = documentLinkMarkdown(
    'gamejam://document/a',
    '옛 제목',
    true,
  );
  const editor = new Editor({
    element: document.querySelector('#editor'),
    extensions: markdownExtensions({
      resolve: (href) => resolveDocumentLink(href, [current]),
      open: () => {},
    }),
    content: original,
    contentType: 'markdown',
    onUpdate: () => updates++,
  });
  try {
    assert.equal(
      editor.view.dom.querySelector('[data-document-link]').textContent,
      '현재 제목',
    );
    current = { ...current, title: '변경된 제목' };
    refreshDocumentLinkViews(editor);
    assert.equal(
      editor.view.dom.querySelector('[data-document-link]').textContent,
      current.title,
    );
    assert.equal(editor.getMarkdown(), original);
    assert.equal(updates, 0);
    const copied = editor.getHTML();
    assert.ok(copied.includes(AUTO_LINK_TITLE));
    editor.commands.setContent(copied);
    assert.equal(editor.getJSON().content[0].content[0].type, 'documentLink');
    assert.equal(editor.getMarkdown(), original);
    editor.commands.setContent('설명');
    editor.commands.selectAll();
    assert.equal(
      editor.commands.setLink({ href: 'gamejam://execute/a' }),
      false,
    );
    assert.equal(
      editor.commands.setLink({ href: 'gamejam://document/a' }),
      true,
    );
  } finally {
    editor.destroy();
    dom.window.close();
    for (const key of keys) {
      const property = previous.get(key);
      if (property) Object.defineProperty(globalThis, key, property);
      else delete globalThis[key];
    }
  }
});
