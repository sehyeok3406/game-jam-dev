import { nodeInputRule, wrappingInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';

const SpaceRule = HorizontalRule.extend({
  addInputRules() {
    return [nodeInputRule({ find: /^(?:---|___|\*\*\*)\s$/, type: this.type })];
  },
});
const SpaceTask = TaskItem.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*(?:[-+*]\s)?\[([ xX]?)\]\s$/,
        type: this.type,
        getAttributes: (match) => ({ checked: /x/i.test(match[1]) }),
      }),
    ];
  },
});

// Preserve image Markdown without fetching arbitrary remote URLs in the editor.
// The reading view resolves imported project images through readAsset.
const SafeImage = Image.extend({
  renderHTML({ node }) {
    return [
      'span',
      { class: 'markdown-editor-image', 'data-image-reference': '' },
      `🖼 ${node.attrs.alt || '이미지'} · ${node.attrs.src || ''}`,
    ];
  },
  addNodeView() {
    return null;
  },
});

export function markdownExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      horizontalRule: false,
      underline: false,
      link: { openOnClick: false, autolink: false },
    }),
    SpaceRule,
    TaskList,
    SpaceTask.configure({
      nested: true,
      a11y: {
        checkboxLabel: (node) => `체크리스트: ${node.textContent || '빈 항목'}`,
      },
    }),
    TableKit.configure({ table: { resizable: false } }),
    SafeImage.configure({ inline: true, allowBase64: false }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
}
