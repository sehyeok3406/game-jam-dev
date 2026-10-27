import { Extension, type CommandProps } from '@tiptap/core';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export type TextAlignment = 'left' | 'center' | 'right';
const valid = (value: unknown): value is TextAlignment =>
  value === 'left' || value === 'center' || value === 'right';

export const CanvasTextAlignment = Extension.create({
  name: 'canvasTextAlignment',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) =>
              valid(element.style.textAlign) ? element.style.textAlign : null,
            renderHTML: (attributes) =>
              valid(attributes.textAlign)
                ? {
                    'data-text-align': attributes.textAlign,
                    style: `text-align:${attributes.textAlign}`,
                  }
                : {},
          },
        },
      },
    ];
  },
});

/** Keep legacy paragraphs byte-compatible until a line actually gains alignment. */
export function serializeCanvasText(document: unknown): string {
  return JSON.stringify(document, (key, value) => {
    if (
      key === 'attrs' &&
      value &&
      Object.keys(value).length === 1 &&
      value.textAlign == null &&
      Object.hasOwn(value, 'textAlign')
    )
      return undefined;
    return value;
  });
}

/** An endpoint at the next paragraph's start does not select that paragraph. */
export function canvasTextAlignment(
  {
    doc,
    selection,
  }: { doc: ProseMirrorNode; selection: import('@tiptap/pm/state').Selection },
  fallback: TextAlignment,
  wholeBox = false,
): TextAlignment | null {
  const values = new Set<TextAlignment>();
  doc.nodesBetween(
    wholeBox ? 0 : selection.from,
    wholeBox ? doc.content.size : selection.to,
    (node, pos) => {
      if (node.type.name !== 'paragraph') return;
      const start = pos + 1,
        end = pos + node.nodeSize - 1;
      if (
        wholeBox ||
        (selection.empty
          ? selection.from >= start && selection.from <= end
          : selection.from <= end && selection.to > start)
      )
        values.add(node.attrs.textAlign ?? fallback);
      return false;
    },
  );
  return values.size === 1 ? [...values][0] : null;
}

/** A soft line break becomes a paragraph only when independent alignment is needed. */
export function alignCanvasText(
  { tr }: Pick<CommandProps, 'tr'>,
  align: TextAlignment,
): boolean {
  const selection = tr.selection;
  const paragraphs: {
    node: ProseMirrorNode;
    pos: number;
    breaks: number[];
    lines: ProseMirrorNode[];
  }[] = [];
  tr.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.name !== 'paragraph') return;
    const lines: ProseMirrorNode[] = [];
    const breaks: number[] = [];
    let touched = false;
    let content: ProseMirrorNode[] = [],
      start = pos + 1;
    const append = (end: number) => {
      const selected = selection.empty
        ? selection.from >= start && selection.from <= end
        : selection.from <= end && selection.to > start;
      touched ||= selected;
      lines.push(
        node.type.create(
          { ...node.attrs, ...(selected ? { textAlign: align } : {}) },
          content,
          node.marks,
        ),
      );
      content = [];
    };
    node.forEach((child, offset) => {
      if (child.type.name === 'hardBreak') {
        const at = pos + 1 + offset;
        append(at);
        breaks.push(at);
        start = at + 1;
      } else content.push(child);
    });
    append(pos + node.nodeSize - 1);
    if (touched) paragraphs.push({ node, pos, breaks, lines });
    return false;
  });
  const mapPosition = (point: number) =>
    point +
    paragraphs.reduce(
      (delta, p) => delta + p.breaks.filter((at) => at < point).length,
      0,
    );
  for (const p of [...paragraphs].reverse()) {
    if (p.breaks.length)
      tr.replaceWith(p.pos, p.pos + p.node.nodeSize, p.lines);
    else tr.setNodeMarkup(p.pos, undefined, p.lines[0].attrs);
  }
  if (selection instanceof AllSelection)
    tr.setSelection(new AllSelection(tr.doc));
  else
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        mapPosition(selection.anchor),
        mapPosition(selection.head),
      ),
    );
  return true;
}
