import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkDocumentTitle } from '../src/ui/documents/markdown-title.ts';
import { setMarkdownTaskChecked } from '../src/markdown-editing.ts';

const parser = unified().use(remarkParse).use(remarkGfm);
function reading(body, title) {
  const tree = parser.parse(body);
  remarkDocumentTitle({ title })(tree);
  return tree;
}
test('only an identical leading plain H1 is omitted, retaining the file and following source positions', () => {
  const body = '# 같은 이름\r\n\r\n첫 문단\r\n\r\n둘째 문단\r\n\r\n- [ ] 할 일';
  const tree = reading(body, '같은 이름');
  assert.equal(tree.children.length, 3);
  assert.equal(tree.children[0].type, 'paragraph');
  assert.equal(tree.children[0].data.hProperties['data-document-block'], 1);
  assert.equal(tree.children[1].data.hProperties['data-document-block'], 2);
  const list = tree.children[2];
  assert.equal(
    list.data.hProperties['data-document-source'],
    body.indexOf('- [ ]'),
  );
  assert.equal(list.children[0].position.start.offset, body.indexOf('- [ ]'));
  assert.equal(
    setMarkdownTaskChecked(body, list.children[0].position.start.offset, true),
    body.replace('[ ]', '[x]'),
  );
  assert.equal(body.startsWith('# 같은 이름\r\n'), true);
});
test('different, non-leading, lower-level, formatted, linked, image and code headings remain visible', () => {
  for (const body of [
    '# 다른 이름',
    '문단\n\n# 같은 이름',
    '## 같은 이름',
    '# **같은 이름**',
    '# [같은 이름](https://example.com)',
    '# ![같은 이름](image.png)',
    '```md\n# 같은 이름\n```',
    '# 같은 <br> 이름',
  ]) {
    const original = parser.parse(body);
    assert.deepEqual(reading(body, '같은 이름'), original, body);
  }
});
test('blank titles and empty files are preserved; repeated later headings are retained', () => {
  for (const [body, title] of [
    ['', ''],
    ['# 이름', ''],
    ['# 이름', undefined],
    ['본문', '본문'],
  ])
    assert.deepEqual(reading(body, title), parser.parse(body));
  assert.equal(reading('# 이름', '이름').children.length, 0);
  const tree = reading('# 이름\n\n# 이름', '이름');
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].type, 'heading');
});
test('heading comparison accepts surrounding whitespace and canonical Korean characters', () => {
  assert.equal(
    reading('\n\n# 같은   이름\n\n본문', ' 같은 이름 ').children[0].type,
    'paragraph',
  );
  assert.equal(
    reading('# ' + '한글'.normalize('NFD') + '\n\n본문', '한글').children[0]
      .type,
    'paragraph',
  );
  assert.equal(
    reading('같은 이름\n===\n\n본문', '같은 이름').children[0].type,
    'paragraph',
  );
});
