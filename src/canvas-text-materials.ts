import type { DrawingItem } from './contracts/drawing-types.ts';
import { validateTextDocument } from './text-document.ts';

export const isTextMaterial = (path: string) => path.startsWith('canvas-text:');
export const textMaterialPath = (item: DrawingItem) =>
  `canvas-text:${item.canvasId}:${item.id}:${item.generation}`;
export function parseTextMaterial(path: string) {
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  const match = path.match(
    new RegExp(`^canvas-text:([a-zA-Z0-9_-]{1,100}):(${uuid}):(${uuid})$`, 'i'),
  );
  if (!match) throw Error('텍스트 자료를 다시 선택해주세요.');
  return { canvasId: match[1], id: match[2], generation: match[3] };
}

/** Preserve paragraphs, list nesting and ordered-list starts as readable Markdown. */
export function textMaterialMarkdown(raw: string): string {
  validateTextDocument(raw);
  type N = {
    type: string;
    text?: string;
    attrs?: { start?: number };
    content?: N[];
  };
  const block = (node: N): string => {
    const children = node.content ?? [];
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'paragraph') return children.map(block).join('');
    if (node.type === 'bulletList' || node.type === 'orderedList')
      return children
        .map((item, index) => {
          const prefix =
            node.type === 'bulletList'
              ? '- '
              : `${(node.attrs?.start ?? 1) + index}. `;
          return (
            prefix +
            block(item)
              .split('\n')
              .map((line, i) => (i ? ' '.repeat(prefix.length) + line : line))
              .join('\n')
          );
        })
        .join('\n');
    return children.map(block).join(node.type === 'doc' ? '\n\n' : '\n');
  };
  const root: N = JSON.parse(raw);
  const hasText = (node: N): boolean =>
    !!node.text?.trim() || (node.content ?? []).some(hasText);
  return hasText(root) ? block(root).trim() : '';
}
export function textMaterialItems(items: DrawingItem[]) {
  return items.flatMap((item) => {
    if (item.kind !== 'text') return [];
    const body = textMaterialMarkdown(item.geometry.document);
    if (!body.trim()) return [];
    return [
      {
        id: `drawing:${item.id}`,
        path: textMaterialPath(item),
        canvasId: item.canvasId,
        title: `텍스트 · ${body.replace(/\s+/g, ' ').slice(0, 60)}`,
        description: body,
        kind: 'text' as const,
      },
    ];
  });
}
