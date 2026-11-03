import { validLocationAnchor } from '../../core/projects/location-anchors.ts';

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
};
/** Only app-owned comments become inert anchor spans. No general raw HTML rendering. */
export function remarkLocationAnchors() {
  return (root: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      for (const child of node.children ?? []) {
        const match =
          child.type === 'html' &&
          /^<!--gamejam:block:([a-f0-9-]{36})-->$/.exec(child.value ?? '');
        if (match && validLocationAnchor(match[1])) {
          child.type = 'text';
          child.value = '';
          child.data = { hProperties: { 'data-location-block': match[1] } };
          // A span is emitted for an empty text node using explicit hast data.
          Object.assign(child.data, { hName: 'span', hChildren: [] });
        } else visit(child);
      }
    };
    visit(root);
  };
}
