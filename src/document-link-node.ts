import { Node, type Editor } from '@tiptap/core';
import {
  AUTO_LINK_TITLE,
  documentLinkMarkdown,
  parseDocumentLink,
  linkStatusText,
  type LinkResolution,
} from './document-links.ts';
declare module '@tiptap/core' {
  interface Storage {
    documentLink: { views: Set<() => void> };
  }
}

export type DocumentLinkRuntime = {
  resolve: (href: string) => LinkResolution;
  open: (href: string) => void;
};
/** Atom displays a current title while serializing the original fallback without edits. */
export function documentLinkNode(runtime?: DocumentLinkRuntime) {
  return Node.create({
    name: 'documentLink',
    priority: 1100,
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes() {
      return { href: { default: '' }, label: { default: '' } };
    },
    addStorage() {
      return { views: new Set<() => void>() };
    },
    parseHTML() {
      return [
        {
          tag: `a[title="${AUTO_LINK_TITLE}"]`,
          priority: 1100,
          getAttrs: (element) => {
            const href = element.getAttribute('href') ?? '';
            return parseDocumentLink(href)
              ? { href, label: element.textContent ?? '' }
              : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return [
        'a',
        {
          href: parseDocumentLink(node.attrs.href) ? node.attrs.href : '',
          title: AUTO_LINK_TITLE,
          'data-document-link': '',
          class: 'document-link',
        },
        node.attrs.label,
      ];
    },
    markdownTokenName: 'link',
    parseMarkdown(token, helpers) {
      if (
        token.title === AUTO_LINK_TITLE &&
        parseDocumentLink(String(token.href ?? ''))
      ) {
        const text = (node: { text?: string; content?: unknown[] }): string =>
          node.text ??
          node.content?.map((child) => text(child as typeof node)).join('') ??
          '';
        return helpers.createNode('documentLink', {
          href: token.href,
          label: helpers
            .parseInline(token.tokens ?? [])
            .map(text)
            .join(''),
        });
      }
      return helpers.applyMark(
        'link',
        helpers.parseInline(token.tokens ?? []),
        { href: token.href, title: token.title || null },
      );
    },
    renderMarkdown(node) {
      return documentLinkMarkdown(
        node.attrs?.href ?? '',
        node.attrs?.label ?? '',
        true,
      );
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('a');
        dom.className = 'document-link';
        dom.contentEditable = 'false';
        dom.dataset.documentLink = node.attrs.href;
        dom.setAttribute('href', node.attrs.href);
        const refresh = () => {
          const result = runtime?.resolve(node.attrs.href);
          dom.textContent =
            result?.status === 'found'
              ? result.document.title
              : node.attrs.label;
          dom.title = result
            ? `${linkStatusText(result)} · Ctrl+클릭하여 열기`
            : node.attrs.label;
          dom.classList.toggle(
            'document-link--missing',
            !!result && result.status !== 'found',
          );
        };
        const open = (event: MouseEvent) => {
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) {
            event.stopPropagation();
            runtime?.open(node.attrs.href);
          }
        };
        dom.addEventListener('click', open);
        this.storage.views.add(refresh);
        refresh();
        return {
          dom,
          destroy: () => {
            this.storage.views.delete(refresh);
            dom.removeEventListener('click', open);
          },
        };
      };
    },
  });
}
export function refreshDocumentLinkViews(editor: Editor) {
  const views = editor.storage.documentLink?.views as
    | Set<() => void>
    | undefined;
  views?.forEach((refresh) => refresh());
}
