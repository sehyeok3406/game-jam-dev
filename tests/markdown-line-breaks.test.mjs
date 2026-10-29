import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkLineBreaks } from '../src/ui/markdown-line-breaks.ts';

test('table description line breaks render without enabling arbitrary HTML or changing offsets', () => {
  const source =
    '| UI 이름 | 기능 설명 |\n| --- | --- |\n| 대화 | 첫 줄<br>둘째 줄<BR/>셋째 줄<br />끝 |\n\n- [ ] 유지\n\n`<br>`\n\n<br onclick="bad()">\n\n<script>alert(1)</script>';
  const parser = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLineBreaks);
  const original = parser.parse(source);
  const expected = structuredClone(original);
  const tree = parser.runSync(original);
  const cells = tree.children[0].children[1].children;
  assert.equal(cells[1].children.filter((n) => n.type === 'break').length, 3);
  assert.equal(
    tree.children[1].position.start.offset,
    expected.children[1].position.start.offset,
  );
  assert.deepEqual(tree.children.slice(1), expected.children.slice(1));
  assert.equal(tree.children[2].children[0].value, '<br>');
});
