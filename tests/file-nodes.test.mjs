import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fileNodeStyle,
  readNodePlacement,
  readableOn,
} from '../src/core/canvas/file-node-style.ts';
import { fileNodeEdgePath } from '../src/core/canvas/file-node-edge.ts';
import { imageDescription } from '../src/core/canvas/image-description.ts';
import {
  arrangeFileNodes,
  placeResultGroup,
} from '../src/core/canvas/result-placement.ts';
import { layoutNewDocuments } from '../src/new-document-layout.ts';
import { htmlSourcePath, sourceMetadata } from '../src/html-source.ts';
import { DocumentLinkIndex } from '../src/document-links.ts';
import matter from '../src/markdown.ts';

const bounds = (x, y, width = 100, height = 100) => ({ x, y, width, height });

test('node styles reserve room for the summary and choose contrasting text', () => {
  assert.deepEqual(readNodePlacement({ width: 340, height: 112 }), {
    width: 340,
    height: 112,
  });
  assert.equal(readNodePlacement({ width: '340', height: 112 }), undefined);
  assert.equal(fileNodeStyle({ height: 88, titleHeight: 70 }).titleHeight, 38);
  assert.equal(fileNodeStyle({ htmlTitle: 'red' }).htmlTitle, '');
  assert.equal(readableOn('#001030'), '#ffffff');
  assert.equal(readableOn('#f0eeee'), '#000000');
});

test('description edits preserve the standard image attachment and path', () => {
  const path = 'assets/images/sprite.png';
  const prefix = `![불러온 이미지](../${path})\n\n## 이미지 용도\n\n게임 에셋\n\n## 설명\n\n`;
  const suffix = `\n\n원본 이미지: \`${path}\`\n`;
  const body = prefix + '**스프라이트**' + suffix;
  assert.equal(imageDescription(body, path).body, '**스프라이트**');
  assert.equal(
    imageDescription(body, path).replace('새 설명'),
    prefix + '새 설명' + suffix,
  );
  assert.equal(imageDescription(body, 'assets/images/other.png'), undefined);
  assert.equal(imageDescription(body + '추가 본문', path), undefined);
});

test('node font settings preserve legacy fallbacks and normalize each size', () => {
  const legacy = fileNodeStyle({ markdownTitle: '#ffffff' });
  assert.equal(legacy.markdownTitleSize, undefined);
  assert.equal(legacy.markdownBodySize, undefined);
  assert.equal(legacy.htmlTitleSize, undefined);
  const sized = fileNodeStyle({
    markdownTitleSize: 24.6,
    markdownBodySize: 2,
    htmlTitleSize: 49,
  });
  assert.equal(sized.markdownTitleSize, 25);
  assert.equal(sized.markdownBodySize, 10);
  assert.equal(sized.htmlTitleSize, 32);
  assert.deepEqual(fileNodeStyle(JSON.parse(JSON.stringify(sized))), sized);
});

test('routes use neighboring edges even when nodes reverse direction', () => {
  assert.match(
    fileNodeEdgePath(bounds(200, 0), bounds(0, 30)).d,
    /^M 200 50.*100 80$/,
  );
  assert.match(
    fileNodeEdgePath(bounds(0, 0), bounds(20, 220)).d,
    /^M 50 100.*70 220$/,
  );
});

test('arrangement aligns mixed widths in shared grid columns', () => {
  const items = [
    { key: 'a', ...bounds(0, 0) },
    { key: 'b', ...bounds(120, 0) },
    { key: 'c', ...bounds(0, 120, 160) },
    { key: 'd', ...bounds(180, 120) },
  ];
  const positions = arrangeFileNodes(items, 'grid');
  assert.deepEqual(positions.get('b'), { x: 200, y: 0 });
  assert.deepEqual(positions.get('d'), { x: 200, y: 140 });
});

test('result placement tries right, below, and then the first row below existing items', () => {
  const input = bounds(0, 0);
  const right = bounds(140, 0);
  const below = bounds(0, 140);
  const items = [{ key: 'a', width: 100, height: 100, html: false }];
  const place = (occupied) =>
    placeResultGroup(items, occupied, [input], input).get('a');
  assert.deepEqual(place([input]), { x: 140, y: 0 });
  assert.deepEqual(place([input, right]), { x: 0, y: 140 });
  assert.deepEqual(place([input, right, below]), { x: 0, y: 280 });
});

test('AI result publication groups new Markdown and HTML and preserves updated coordinates', () => {
  const md = (id, extra = {}) =>
    matter.stringify('내용\n', { id, title: id, type: 'design', ...extra });
  const input = 'docs/input.md';
  const html = 'output/index.html';
  const before = {
    [input]: md('input', { x: 10, y: 20, width: 300, height: 200 }),
  };
  const origin = {
    x: 500,
    y: 500,
    inputs: [input],
    nodePlacement: { width: 400, height: 200 },
  };
  const added = layoutNewDocuments(
    before,
    { 'docs/new.md': md('new'), [html]: '<html></html>', [input]: md('input') },
    origin,
  );
  const doc = matter(added['docs/new.md']).data;
  const source = matter(added[htmlSourcePath(html)]).data;
  assert.deepEqual([doc.x, doc.y, source.x, source.y], [450, 20, 890, 20]);
  assert.equal(source.canvas_placement_id, `result:${source.id}`);
  assert.deepEqual(
    [matter(added[input]).data.x, matter(added[input]).data.y],
    [10, 20],
  );
  const updated = layoutNewDocuments(
    { ...before, ...added },
    { [htmlSourcePath(html)]: sourceMetadata(html, 'updated') },
    origin,
  );
  assert.equal(
    matter(updated[htmlSourcePath(html)]).data.canvas_placement_id,
    source.canvas_placement_id,
  );
});

test('link index enumerates one relationship for repeated stable references', () => {
  const first = {
    id: 'a',
    title: 'A',
    relativePath: 'docs/a.md',
    identitySource: 'frontmatter',
    body: '[B](gamejam://document/b) [B](gamejam://document/b) [A](gamejam://document/a)',
  };
  const second = {
    id: 'b',
    title: '새 이름',
    relativePath: 'docs/renamed.md',
    identitySource: 'frontmatter',
    body: '',
  };
  const index = new DocumentLinkIndex();
  index.update([first, second]);
  assert.deepEqual(index.connections(), [
    { sourcePath: first.relativePath, targetPath: second.relativePath },
  ]);
});
