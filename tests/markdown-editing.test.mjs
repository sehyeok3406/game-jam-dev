import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkdownManager } from '@tiptap/markdown';
import { Editor } from '@tiptap/core';
import { JSDOM } from 'jsdom';
import { markdownExtensions } from '../src/markdown-extensions.ts';
import {
  canEditMarkdownVisually,
  markdownMeaning,
  setMarkdownTaskChecked,
} from '../src/markdown-editing.ts';

test('task clicks patch only the parsed marker, preserving duplicate labels, Unicode, CRLF, indentation and other syntax', () => {
  const body =
    '# 제목\r\n\r\n- [ ] 중복\r\n  - [X] 중복\r\n\r\n```md\r\n- [ ] 중복\r\n```\r\n';
  const offset = body.indexOf('- [X]');
  const next = setMarkdownTaskChecked(body, offset, false);
  assert.equal(
    next,
    body.slice(0, offset) + body.slice(offset).replace('[X]', '[ ]'),
  );
  assert.equal(
    setMarkdownTaskChecked(next, offset, true),
    body.replace('[X]', '[x]'),
  );
  for (const bad of [-1, 2.5, body.length, body.indexOf('중복')])
    assert.throws(() => setMarkdownTaskChecked(body, bad, true));
  assert.equal(setMarkdownTaskChecked('3. [ ] 번호', 0, true), '3. [x] 번호');
});

test('supported Markdown is semantically preserved across rich edit serialization', () => {
  const manager = new MarkdownManager({ extensions: markdownExtensions() });
  for (const body of [
    '# 제목\n\n## 부제\n\n한글 **굵게** *기울임* ~~취소선~~ `코드`.',
    '- 첫째\n- 둘째\n  - 하위\n\n1. 하나\n2. 둘',
    '- [ ] 미완료\n- [x] 완료\n  - [ ] 하위',
    '| 이름 | 설명 |\n| --- | --- |\n| 감자 | 식량 |',
    '> 인용\n\n---\n\n```js\nconst x = "안녕";\n```',
    '![도식](assets/diagram.png "제목")\n\n[링크](https://example.com)',
  ]) {
    const restored = manager.serialize(manager.parse(body));
    assert.equal(
      canEditMarkdownVisually(body, restored),
      true,
      `${body}\n→\n${restored}`,
    );
  }
});

test('unsupported/lossy documents fall back to source without mutating original Markdown', () => {
  for (const body of [
    '본문[^a]\n\n[^a]: 각주',
    '<!-- 유지할 주석 -->\n본문',
    '[링크][a]\n\n[a]: https://example.com',
    '```js metadata\ncode\n```',
  ])
    assert.equal(markdownMeaning(body), null, body);
  assert.equal(canEditMarkdownVisually('## 제목', '제목'), false);
  assert.equal(
    canEditMarkdownVisually('그대로\n다음 줄', '그대로 다음 줄'),
    false,
  );
  assert.equal(canEditMarkdownVisually('- 항목', '* 항목'), true);
});

test('Space input rules create heading levels, bullets, numbered lists, tasks and horizontal rules; undo and read-only are safe', () => {
  const dom = new JSDOM('<!doctype html><body><div id="editor"></div></body>', {
    pretendToBeVisual: true,
  });
  const saved = {};
  for (const key of [
    'window',
    'document',
    'navigator',
    'Node',
    'HTMLElement',
    'MutationObserver',
    'KeyboardEvent',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
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
  const editor = new Editor({
    element: document.getElementById('editor'),
    extensions: markdownExtensions(),
    content: '',
    contentType: 'markdown',
  });
  const type = (text) => {
    for (const character of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp('handleTextInput', (fn) =>
        fn(editor.view, from, to, character),
      );
      if (!handled)
        editor.view.dispatch(editor.state.tr.insertText(character, from, to));
    }
  };
  try {
    for (let level = 1; level <= 6; level++) {
      editor.commands.setContent('', { contentType: 'markdown' });
      type('#'.repeat(level));
      assert.equal(editor.isActive('heading'), false);
      type(' ');
      assert.equal(editor.getAttributes('heading').level, level);
    }
    for (const [prefix, node] of [
      ['- ', 'bulletList'],
      ['* ', 'bulletList'],
      ['+ ', 'bulletList'],
      ['1. ', 'orderedList'],
      ['[] ', 'taskList'],
      ['[ ] ', 'taskList'],
      ['[x] ', 'taskList'],
      ['> ', 'blockquote'],
      ['--- ', 'horizontalRule'],
    ]) {
      editor.commands.setContent('', { contentType: 'markdown' });
      type(prefix);
      assert.ok(
        editor.getJSON().content.some((item) => item.type === node),
        prefix,
      );
    }
    editor.commands.setContent('', { contentType: 'markdown' });
    editor.view.dom.dispatchEvent(
      new dom.window.CompositionEvent('compositionstart'),
    );
    type('# ');
    assert.equal(
      editor.isActive('heading'),
      false,
      'IME composition must not convert incomplete input',
    );
    editor.view.dom.dispatchEvent(
      new dom.window.CompositionEvent('compositionend'),
    );
    editor.view.input.composing = false;
    editor.commands.setContent('- 첫 항목', { contentType: 'markdown' });
    editor.commands.setTextSelection(7);
    editor.commands.keyboardShortcut('Enter');
    type('둘째');
    assert.match(editor.getMarkdown(), /- 첫 항목\n- 둘째/);
    editor.commands.keyboardShortcut('Enter');
    editor.commands.keyboardShortcut('Enter');
    assert.equal(editor.isActive('bulletList'), false);
    editor.commands.setContent('```md\n\n```', { contentType: 'markdown' });
    editor.commands.setTextSelection(1);
    type('# ');
    assert.equal(
      editor.isActive('heading'),
      false,
      'literal code must not turn into headings',
    );
    editor.commands.setContent('', { contentType: 'markdown' });
    type('---');
    assert.equal(editor.isActive('horizontalRule'), false);
    type(' ');
    assert.equal(editor.getJSON().content[0].type, 'horizontalRule');
    editor.commands.undoInputRule();
    assert.match(editor.getMarkdown(), /---/);
    editor.commands.setContent('- [ ] 저장 항목', { contentType: 'markdown' });
    const box = editor.view.dom.querySelector('input[type="checkbox"]');
    box.click();
    assert.match(editor.getMarkdown(), /\[x\]/);
    editor.setEditable(false);
    box.click();
    assert.match(editor.getMarkdown(), /\[x\]/);
  } finally {
    editor.destroy();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
