export type MarkdownEditFocus = {
  title: boolean;
  point?: { x: number; y: number };
  block?: { index: number; sourceOffset: number; x: number; y: number };
};

type Block = {
  type: string;
  depth?: number;
  children?: { type: string; value?: string }[];
  position?: { start: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
};

/** Transform the reading tree, retaining original source offsets and file bytes. */
export function remarkDocumentTitle({ title }: { title?: string }) {
  return (tree: { children: Block[] }) => {
    const first = tree.children[0];
    const normalize = (value: string) =>
      value.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (
      !title?.trim() ||
      first?.type !== 'heading' ||
      first.depth !== 1 ||
      !first.children?.length ||
      first.children.some((child) => child.type !== 'text') ||
      normalize(first.children.map((child) => child.value ?? '').join('')) !==
        normalize(title)
    )
      return;
    tree.children.shift();
    tree.children.forEach((block, index) => {
      block.data = {
        ...block.data,
        hProperties: {
          ...block.data?.hProperties,
          'data-document-block': index + 1,
          'data-document-source': block.position?.start.offset ?? 0,
        },
      };
    });
  };
}

/** Relocate a reading click into its original block when editing reveals the H1. */
export function readingBlockFocus(
  target: Element,
  point: { x: number; y: number },
): MarkdownEditFocus['block'] {
  const element = target.closest<HTMLElement>('[data-document-block]');
  if (!element) return;
  const index = Number(element.dataset.documentBlock),
    sourceOffset = Number(element.dataset.documentSource);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0
  )
    return;
  const rect = element.getBoundingClientRect();
  return { index, sourceOffset, x: point.x - rect.left, y: point.y - rect.top };
}
