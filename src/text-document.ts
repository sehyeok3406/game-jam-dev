import type { TextObject } from './contracts/drawing-types.ts';

export const EMPTY_TEXT_DOCUMENT = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

export function isEmptyTextDocument(raw: string): boolean {
  validateTextDocument(raw);
  const visit = (node: { text?: string; content?: (typeof node)[] }): boolean =>
    !(node.text ?? '').trim() && (node.content ?? []).every(visit);
  return visit(JSON.parse(raw));
}

/** Plain clipboard text stays literal; it is never interpreted as HTML/Markdown. */
export function plainTextDocument(text: string): string {
  const document = JSON.stringify({
    type: 'doc',
    content: text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => ({
        type: 'paragraph',
        ...(line ? { content: [{ type: 'text', text: line }] } : {}),
      })),
  });
  validateTextDocument(document);
  return document;
}

/** A small, bounded ProseMirror schema. No HTML, links, images or arbitrary attributes. */
export function validateTextDocument(raw: unknown): void {
  const fail = (): never => {
    throw new Error('텍스트 내용이나 목록 형식을 확인해주세요.');
  };
  if (typeof raw !== 'string' || raw.length > 100_000) fail();
  let root: unknown;
  try {
    root = JSON.parse(raw as string);
  } catch {
    fail();
  }
  let count = 0;
  const visit = (value: unknown, parent: string, depth: number) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      depth > 16 ||
      ++count > 5000
    )
      fail();
    const n = value as {
      type: string;
      text?: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
      marks?: { type: string }[];
    };
    if (
      Object.keys(n).some(
        (key) => !['type', 'text', 'attrs', 'content', 'marks'].includes(key),
      )
    )
      fail();
    const allowed: Record<string, string[]> = {
      root: ['doc'],
      doc: ['paragraph', 'bulletList', 'orderedList'],
      paragraph: ['text', 'hardBreak'],
      bulletList: ['listItem'],
      orderedList: ['listItem'],
      listItem: ['paragraph', 'bulletList', 'orderedList'],
    };
    if (!allowed[parent]?.includes(n.type)) fail();
    if (n.type === 'text') {
      if (typeof n.text !== 'string' || !n.text.length || n.content || n.attrs)
        fail();
      if (
        n.marks !== undefined &&
        (!Array.isArray(n.marks) ||
          n.marks.length > 3 ||
          n.marks.some(
            (m) =>
              !m ||
              typeof m !== 'object' ||
              Object.keys(m).length !== 1 ||
              !['bold', 'italic', 'underline'].includes(m.type),
          ))
      )
        fail();
    } else {
      if (n.text !== undefined || n.marks !== undefined) fail();
      if (n.attrs !== undefined) {
        if (!n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs))
          fail();
        if (n.type === 'paragraph') {
          if (
            Object.keys(n.attrs).some((k) => k !== 'textAlign') ||
            (n.attrs.textAlign !== undefined &&
              n.attrs.textAlign !== null &&
              !['left', 'center', 'right'].includes(
                n.attrs.textAlign as string,
              ))
          )
            fail();
        } else if (
          n.type !== 'orderedList' ||
          Object.keys(n.attrs).some((k) => k !== 'start' && k !== 'type') ||
          !Number.isSafeInteger(n.attrs.start) ||
          Number(n.attrs.start) < 1 ||
          Number(n.attrs.start) > 1_000_000 ||
          (n.attrs.type !== undefined &&
            n.attrs.type !== null &&
            n.attrs.type !== '1')
        )
          fail();
      }
      if (n.type === 'hardBreak') {
        if (n.content) fail();
      } else {
        if (n.content !== undefined && !Array.isArray(n.content)) fail();
        const children = n.content ?? [];
        if (n.type !== 'paragraph' && !children.length) fail();
        if (
          n.type === 'listItem' &&
          (children[0] as { type?: string })?.type !== 'paragraph'
        )
          fail();
        for (const child of children) visit(child, n.type, depth + 1);
      }
    }
  };
  visit(root, 'root', 0);
}

/** Capability gate: older clients discard paragraph attributes while editing. */
export function textDocumentHasAlignment(raw: string): boolean {
  validateTextDocument(raw);
  const hasAlignment = (node: {
    attrs?: { textAlign?: unknown };
    content?: (typeof node)[];
  }): boolean =>
    node.attrs?.textAlign != null || (node.content ?? []).some(hasAlignment);
  return hasAlignment(JSON.parse(raw));
}

export function createTextObject(
  x: number,
  y: number,
  now = Date.now(),
  id = crypto.randomUUID(),
  generation = crypto.randomUUID(),
): TextObject {
  return {
    id,
    generation,
    kind: 'text',
    transform: { x, y, width: 320, height: 42, rotation: 0 },
    geometry: {
      document: EMPTY_TEXT_DOCUMENT,
      fontSize: 24,
      color: '#334155',
      fontFamily: 'sans-serif',
      align: 'left',
    },
    style: {
      fill: null,
      stroke: null,
      strokeWidth: 1,
      opacity: 1,
      strokePattern: 'solid',
    },
    layer: 'annotation',
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function textDocumentHtml(
  raw: string,
  fallback: 'left' | 'center' | 'right' = 'left',
): string {
  validateTextDocument(raw);
  type TextNode = {
    type: string;
    text?: string;
    marks?: { type: string }[];
    attrs?: { start?: number; textAlign?: 'left' | 'center' | 'right' };
    content?: TextNode[];
  };
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  const render = (n: TextNode, parent = '', index = 0): string => {
    if (n.type === 'text')
      return (n.marks ?? []).reduce((s, m) => {
        const tag = { bold: 'strong', italic: 'em', underline: 'u' }[m.type];
        return `<${tag}>${s}</${tag}>`;
      }, escape(n.text!));
    if (n.type === 'hardBreak') return '<br />';
    const body = (n.content ?? [])
      .map((child, index) => render(child, n.type, index))
      .join('');
    if (n.type === 'doc') return body;
    const tag = {
      paragraph: 'p',
      bulletList: 'ul',
      orderedList: 'ol',
      listItem: 'li',
    }[n.type];
    const style =
      n.type === 'paragraph'
        ? `margin:0;min-height:1.4em;text-align:${n.attrs?.textAlign ?? fallback}${parent === 'listItem' && index === 0 ? ';display:inline' : ''}`
        : n.type === 'listItem'
          ? `margin:0;min-height:1.4em;list-style-position:inside;text-align:${n.content?.[0]?.attrs?.textAlign ?? fallback}`
          : `margin:0;padding-left:${parent === 'listItem' ? '1.5em' : '0'};list-style-position:inside;list-style-type:${n.type === 'orderedList' ? 'decimal' : 'disc'}`;
    return `<${tag} style="${style}"${n.type === 'orderedList' ? ` start="${n.attrs?.start ?? 1}"` : ''}>${body}</${tag}>`;
  };
  return render(JSON.parse(raw));
}
