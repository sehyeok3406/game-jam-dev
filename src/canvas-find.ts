export type TextMatch = { range: Range; nodeId: string };

/** Build ranges across inline Markdown elements without rewriting contenteditable or React's DOM. */
export function findTextRanges(
  root: HTMLElement,
  query: string,
  nodeId: string,
): TextMatch[] {
  if (!query) return [];
  const owner = root.ownerDocument;
  const walker = owner.createTreeWalker(root, 4);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let value = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const excluded = node.parentElement?.closest(
      'button, script, style, [aria-hidden="true"]',
    );
    // A caller can explicitly search a title button; controls inside a body
    // remain excluded, as do hidden text and executable content.
    if (excluded && !(excluded === root && root.tagName === 'BUTTON')) continue;
    nodes.push({
      node,
      start: value.length,
      end: value.length + node.data.length,
    });
    value += node.data;
  }
  // Escaping keeps symbols such as [, *, / literal. RegExp i preserves original string offsets.
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'giu',
  );
  const matches: TextMatch[] = [];
  for (const match of value.matchAll(pattern)) {
    const from = match.index!,
      to = from + match[0].length;
    const first = nodes.find((node) => node.start <= from && node.end > from);
    const last = nodes.find((node) => node.start < to && node.end >= to);
    if (!first || !last) continue;
    const range = owner.createRange();
    range.setStart(first.node, from - first.start);
    range.setEnd(last.node, to - last.start);
    matches.push({ range, nodeId });
  }
  return matches;
}
