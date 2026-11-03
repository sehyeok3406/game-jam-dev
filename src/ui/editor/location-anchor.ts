import { Node, type Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { validLocationAnchor } from '../../core/projects/location-anchors.ts';

/** An invisible inline atom travels with the paragraph through Markdown and JSON round trips. */
export const LocationAnchor = Node.create({
  name: 'locationAnchor',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-location-block'),
        renderHTML: (attrs) => ({ 'data-location-block': attrs.id }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-location-block]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        ...HTMLAttributes,
        class: 'location-block-anchor',
        'aria-hidden': 'true',
      },
    ];
  },
  markdownTokenName: 'locationAnchor',
  markdownTokenizer: {
    name: 'locationAnchor',
    level: 'inline',
    start: '<!--gamejam:block:',
    tokenize: (src) => {
      const match = /^<!--gamejam:block:([a-f0-9-]{36})-->/.exec(src);
      return match && validLocationAnchor(match[1])
        ? { type: 'locationAnchor', raw: match[0], id: match[1] }
        : undefined;
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode('locationAnchor', { id: token.id });
  },
  renderMarkdown(node) {
    return validLocationAnchor(node.attrs?.id)
      ? `<!--gamejam:block:${node.attrs.id}-->`
      : '';
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, oldState, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const preferred = new Map<string, number>();
          oldState.doc.descendants((node, pos) => {
            if (node.type.name !== 'locationAnchor') return;
            let mapped = pos,
              removed = false;
            for (const tr of transactions) {
              const next = tr.mapping.mapResult(mapped);
              mapped = next.pos;
              removed ||= next.deleted;
            }
            if (!removed) preferred.set(node.attrs.id, mapped);
          });
          const nodes: { id: string; pos: number }[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'locationAnchor')
              nodes.push({ id: node.attrs.id, pos });
          });
          const keep = new Map<string, number>();
          for (const node of nodes)
            if (!keep.has(node.id) || node.pos === preferred.get(node.id))
              keep.set(node.id, node.pos);
          const tr = state.tr;
          for (const node of nodes)
            if (!validLocationAnchor(node.id) || keep.get(node.id) !== node.pos)
              tr.setNodeMarkup(node.pos, undefined, {
                id: crypto.randomUUID(),
              });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

/** A single textual block only. Code blocks cannot contain inline anchor nodes. */
export function ensureSelectionLocationAnchor(
  editor: Editor,
  writable: boolean,
): string {
  const { selection } = editor.state,
    from = selection.$from;
  if (
    !from.sameParent(selection.$to) ||
    !from.parent.isTextblock ||
    from.parent.type.name === 'codeBlock' ||
    !from.parent.textContent.trim()
  )
    throw Error(
      '링크를 만들 문단 안에 커서를 놓거나 한 문단의 텍스트를 선택해주세요.',
    );
  const ids: string[] = [];
  from.parent.descendants((node) => {
    if (node.type.name === 'locationAnchor') ids.push(node.attrs.id);
  });
  if (ids.length === 1 && validLocationAnchor(ids[0])) return ids[0];
  if (ids.length)
    throw Error(
      '문단에 위치 표시가 여러 개 있습니다. 원문에서 위치 표시를 정리해주세요.',
    );
  if (!writable)
    throw Error(
      '이 문단에는 아직 위치 링크가 없습니다. 편집 권한 사용자에게 요청해주세요.',
    );
  if (editor.view.composing)
    throw Error('한글 입력을 마친 뒤 다시 복사해주세요.');
  const id = crypto.randomUUID();
  editor.commands.insertContentAt(from.end(), {
    type: 'locationAnchor',
    attrs: { id },
  });
  return id;
}
