import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CanvasTextAlignment,
  alignCanvasText,
  canvasTextAlignment,
  serializeCanvasText,
} from '../src/ui/drawing/text-alignment.ts';
import {
  validateTextDocument,
  textDocumentHtml,
} from '../src/text-document.ts';

const text = (value, marks) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (value, align) => ({
  type: 'paragraph',
  ...(align ? { attrs: { textAlign: align } } : {}),
  content: typeof value === 'string' ? [text(value)] : value,
});
const doc = (...content) => ({ type: 'doc', content });
function withEditor(content, run) {
  const dom = new JSDOM('<div id="editor"></div>', { pretendToBeVisual: true });
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
  const before = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of keys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        typeof dom.window[key] === 'function' &&
        [
          'getComputedStyle',
          'requestAnimationFrame',
          'cancelAnimationFrame',
        ].includes(key)
          ? dom.window[key].bind(dom.window)
          : dom.window[key],
    });
  const editor = new Editor({
    element: document.querySelector('#editor'),
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: false,
        trailingNode: false,
      }),
      CanvasTextAlignment,
    ],
    content,
  });
  try {
    run(editor);
  } finally {
    editor.destroy();
    dom.window.close();
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
const align = (editor, value) =>
  editor.commands.command((props) => alignCanvasText(props, value));
const positions = (editor) => {
  const result = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph')
      result.push({ pos, text: node.textContent, align: node.attrs.textAlign });
  });
  return result;
};
test('cursor and selected text align only their paragraph, including undo and redo', () => {
  withEditor(
    doc(
      paragraph('첫 줄'),
      paragraph('가운데 줄'),
      paragraph('마지막 줄', 'right'),
    ),
    (editor) => {
      const original = serializeCanvasText(editor.getJSON());
      const middle = positions(editor)[1];
      editor.commands.setTextSelection(middle.pos + 2);
      align(editor, 'center');
      assert.deepEqual(
        positions(editor).map((p) => p.align),
        [null, 'center', 'right'],
      );
      assert.equal(editor.state.selection.from, middle.pos + 2);
      validateTextDocument(serializeCanvasText(editor.getJSON()));
      editor.commands.undo();
      assert.equal(serializeCanvasText(editor.getJSON()), original);
      editor.commands.redo();
      assert.deepEqual(
        positions(editor).map((p) => p.align),
        [null, 'center', 'right'],
      );
      editor.commands.setTextSelection({
        from: middle.pos + 1,
        to: middle.pos + 3,
      });
      align(editor, 'left');
      assert.deepEqual(
        positions(editor).map((p) => p.align),
        [null, 'left', 'right'],
      );
    },
  );
});
test('multi-line selections exclude an unselected next-line boundary and whole-box selection aligns all', () => {
  withEditor(
    doc(paragraph('one'), paragraph('two'), paragraph('three')),
    (editor) => {
      const p = positions(editor);
      editor.commands.setTextSelection({
        from: p[0].pos + 1,
        to: p[2].pos + 1,
      });
      align(editor, 'right');
      assert.equal(canvasTextAlignment(editor.state, 'left'), 'right');
      assert.equal(canvasTextAlignment(editor.state, 'left', true), null);
      assert.deepEqual(
        positions(editor).map((p) => p.align),
        ['right', 'right', null],
      );
      editor.commands.selectAll();
      align(editor, 'center');
      assert.deepEqual(
        positions(editor).map((p) => p.align),
        ['center', 'center', 'center'],
      );
      assert.equal(canvasTextAlignment(editor.state, 'left', true), 'center');
    },
  );
});
test('soft line breaks support independent alignment without losing inline marks, cursor or undo', () => {
  const content = doc(
    paragraph(
      [
        text('first'),
        { type: 'hardBreak' },
        text('second', [{ type: 'bold' }]),
        { type: 'hardBreak' },
        text('third'),
      ],
      'right',
    ),
    paragraph('untouched'),
  );
  withEditor(content, (editor) => {
    const original = serializeCanvasText(editor.getJSON());
    editor.commands.setTextSelection(9);
    align(editor, 'center');
    assert.deepEqual(
      positions(editor).map((p) => [p.text, p.align]),
      [
        ['first', 'right'],
        ['second', 'center'],
        ['third', 'right'],
        ['untouched', null],
      ],
    );
    assert.equal(editor.state.selection.from, 10);
    assert.deepEqual(editor.getJSON().content[1].content[0].marks, [
      { type: 'bold' },
    ]);
    validateTextDocument(serializeCanvasText(editor.getJSON()));
    editor.commands.undo();
    assert.equal(serializeCanvasText(editor.getJSON()), original);
  });
});
test('bullet and numbered items align independently while preserving nesting and ordered starts', () => {
  for (const type of ['bulletList', 'orderedList'])
    withEditor(
      doc({
        type,
        ...(type === 'orderedList' ? { attrs: { start: 7 } } : {}),
        content: [
          {
            type: 'listItem',
            content: [
              paragraph('parent'),
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [paragraph('nested')] }],
              },
            ],
          },
          { type: 'listItem', content: [paragraph('sibling')] },
        ],
      }),
      (editor) => {
        const first = positions(editor)[0];
        editor.commands.setTextSelection(first.pos + 2);
        align(editor, 'center');
        assert.deepEqual(
          positions(editor).map((p) => p.align),
          ['center', null, null],
        );
        const saved = serializeCanvasText(editor.getJSON());
        validateTextDocument(saved);
        const html = textDocumentHtml(saved, 'right');
        assert.match(html, /list-style-position:inside;text-align:center/);
        assert.match(html, /text-align:center;display:inline/);
        assert.match(html, /list-style-position:inside;text-align:right/);
        if (type === 'orderedList') assert.match(html, /start="7"/);
        const reloaded = JSON.parse(saved);
        editor.commands.setContent(reloaded);
        assert.deepEqual(
          positions(editor).map((p) => p.align),
          ['center', null, null],
        );
      },
    );
});
test('unaligned paragraphs remain compatible with old text documents and unsafe alignment is rejected', () => {
  const original = doc(paragraph('legacy'));
  withEditor(original, (editor) =>
    assert.equal(
      serializeCanvasText(editor.getJSON()),
      JSON.stringify(original),
    ),
  );
  for (const textAlign of ['justify', 'center;color:red', false, {}, 1])
    assert.throws(() =>
      validateTextDocument(
        JSON.stringify(doc({ ...paragraph('bad'), attrs: { textAlign } })),
      ),
    );
  for (const attrs of ['', 42, [], { textAlign: 'left', onclick: 'x' }])
    assert.throws(() =>
      validateTextDocument(JSON.stringify(doc({ ...paragraph('bad'), attrs }))),
    );
});
