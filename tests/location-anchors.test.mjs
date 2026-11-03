import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkdownManager } from '@tiptap/markdown';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { JSDOM } from 'jsdom';
import { markdownExtensions } from '../src/markdown-extensions.ts';
import {
  LocationAnchor,
  ensureSelectionLocationAnchor,
} from '../src/ui/editor/location-anchor.ts';
import { canEditMarkdownVisually } from '../src/markdown-editing.ts';
import { validateTextDocument } from '../src/text-document.ts';
import {
  locationAnchorIds,
  textLocationAnchorIds,
} from '../src/core/projects/location-anchors.ts';
import { assertEraseSupport } from '../src/server/services/drawing-capabilities.ts';
import { remarkLocationAnchors } from '../src/ui/locations/remark-location-anchors.ts';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const id = '11111111-1111-4111-8111-111111111111';
const marker = `<!--gamejam:block:${id}-->`;
test('paragraph, heading, nested list, quote and table anchors survive repeated Markdown round-trips', () => {
  const manager = new MarkdownManager({ extensions: markdownExtensions() });
  for (const raw of [
    `한글 본문${marker}\n\n다음 문단`,
    `## 제목${marker}`,
    `- 항목${marker}\n  - 하위`,
    `> 인용${marker}`,
    `| A | B |\n| --- | --- |\n| 셀${marker} | 내용 |`,
  ]) {
    let next = raw;
    for (let i = 0; i < 3; i++) {
      next = manager.serialize(manager.parse(next));
      assert.deepEqual(locationAnchorIds(next), [id], next);
    }
    assert.ok(canEditMarkdownVisually(raw, next), next);
  }
});
test('reading transform exposes only an inert anchor, while comments inside code stay literal', () => {
  const parser = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkLocationAnchors);
  const tree = parser.runSync(
    parser.parse(`본문${marker}\n\n\`\`\`html\n${marker}\n\`\`\``),
  );
  assert.equal(
    tree.children[0].children[1].data.hProperties['data-location-block'],
    id,
  );
  assert.equal(tree.children[1].type, 'code');
  assert.equal(tree.children[1].value, marker);
});
test('JSON text anchors are strictly validated and older clients cannot read/mutate anchored data', () => {
  const raw = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '문단' },
          { type: 'locationAnchor', attrs: { id } },
        ],
      },
    ],
  });
  validateTextDocument(raw);
  assert.deepEqual(textLocationAnchorIds(raw), [id]);
  assert.throws(() => validateTextDocument(raw.replace(id, 'javascript:evil')));
  assert.throws(() =>
    validateTextDocument(
      raw.replace(`"id":"${id}"`, `"id":"${id}","onClick":"evil"`),
    ),
  );
  const files = { 'docs/a.md': `본문${marker}` };
  assert.throws(() => assertEraseSupport(files, {}), /업데이트/);
  assertEraseSupport(files, { locationAnchorVersion: 1 });
});
test('editing before the anchor preserves its ID, duplicate paste regenerates the copy, and Undo restores it', () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="editor"></div></body></html>',
  );
  const saved = new Map();
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'getComputedStyle',
  ]) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === 'getComputedStyle'
          ? dom.window.getComputedStyle.bind(dom.window)
          : dom.window[key],
    });
  }
  const editor = new Editor({
    element: document.getElementById('editor'),
    extensions: [StarterKit, LocationAnchor],
    content: '<p>첫 문단</p><p>두 번째</p>',
  });
  try {
    editor.commands.setTextSelection(2);
    const anchor = ensureSelectionLocationAnchor(editor, true);
    editor.commands.insertContentAt(1, '앞에 추가 ');
    assert.deepEqual(textLocationAnchorIds(JSON.stringify(editor.getJSON())), [
      anchor,
    ]);
    const paragraph = editor.getJSON().content[0];
    editor.commands.insertContentAt(0, paragraph);
    const ids = textLocationAnchorIds(JSON.stringify(editor.getJSON()));
    assert.equal(new Set(ids).size, 2);
    assert.equal(
      ids[1],
      anchor,
      'the original keeps its identity when pasted before it',
    );
    editor.commands.undo();
    assert.deepEqual(textLocationAnchorIds(JSON.stringify(editor.getJSON())), [
      anchor,
    ]);
  } finally {
    editor.destroy();
    dom.window.close();
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  }
});
