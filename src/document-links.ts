import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { CanvasDocument } from './shared';

/** Markdown title distinguishes live page names from user-authored link text. */
export const AUTO_LINK_TITLE = 'gamejam:auto-title';
export type DocumentLinkTarget = { kind: 'document' | 'file'; value: string };
export type LinkDocument = Pick<
  CanvasDocument,
  'id' | 'title' | 'relativePath' | 'canvasId' | 'htmlSource' | 'identitySource'
>;
export type LinkResolution =
  | { status: 'found'; document: LinkDocument }
  | { status: 'missing' | 'ambiguous' | 'invalid' };
const parser = unified().use(remarkParse).use(remarkGfm);

export function parseDocumentLink(href: string): DocumentLinkTarget | null {
  const match = /^gamejam:\/\/(document|file)\/([^/?#]+)$/.exec(href);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[2]);
    if (
      !value ||
      [...value].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      return null;
    if (
      match[1] === 'file' &&
      (value.includes('\\') ||
        value.includes(':') ||
        value.startsWith('/') ||
        value.split('/').some((p) => !p || p === '.' || p === '..'))
    )
      return null;
    return { kind: match[1] as DocumentLinkTarget['kind'], value };
  } catch {
    return null;
  }
}
export function documentLinkHref(document: LinkDocument) {
  if (!document.identitySource)
    throw Error(
      '문서 식별 정보를 확인하지 못했습니다. 프로젝트를 다시 열어주세요.',
    );
  const kind = document.identitySource === 'path' ? 'file' : 'document';
  const href = `gamejam://${kind}/${encodeURIComponent(kind === 'file' ? document.relativePath : document.id)}`;
  if (!parseDocumentLink(href))
    throw Error('이 문서에는 링크를 만들 수 없습니다.');
  return href;
}
export function resolveDocumentLink(
  href: string,
  documents: readonly LinkDocument[],
): LinkResolution {
  const target = parseDocumentLink(href);
  if (!target) return { status: 'invalid' };
  const matches = documents.filter((d) =>
    target.kind === 'file'
      ? d.relativePath === target.value
      : d.identitySource !== 'path' && d.id === target.value,
  );
  return matches.length === 1
    ? { status: 'found', document: matches[0] }
    : { status: matches.length ? 'ambiguous' : 'missing' };
}
export function linkStatusText(result: LinkResolution) {
  return result.status === 'found'
    ? result.document.title
    : result.status === 'ambiguous'
      ? '연결 대상을 구분할 수 없음'
      : '연결 대상 없음';
}
export function escapeLinkLabel(label: string) {
  return label
    .replace(/&/g, '&amp;')
    .replace(/([\\`*_[\]<>|])/g, '\\$1')
    .replace(/\r?\n/g, ' ');
}
export function documentLinkMarkdown(
  href: string,
  label: string,
  automatic: boolean,
) {
  if (!parseDocumentLink(href)) throw Error('잘못된 문서 링크입니다.');
  return `[${escapeLinkLabel(label)}](${href}${automatic ? ` "${AUTO_LINK_TITLE}"` : ''})`;
}

type AstNode = {
  type: string;
  url?: string;
  title?: string | null;
  identifier?: string;
  value?: string;
  children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
export type DocumentLinkOccurrence = {
  href: string;
  automatic: boolean;
  label: string;
  from: number;
  to: number;
};
function walk(node: AstNode, visit: (node: AstNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
function nodeText(node: AstNode): string {
  return node.value ?? node.children?.map(nodeText).join('') ?? '';
}
export function extractDocumentLinks(body: string): DocumentLinkOccurrence[] {
  const tree = parser.parse(body) as AstNode;
  const definitions = new Map<string, AstNode>();
  walk(tree, (node) => {
    if (
      node.type === 'definition' &&
      node.identifier &&
      !definitions.has(node.identifier)
    )
      definitions.set(node.identifier, node);
  });
  const links: DocumentLinkOccurrence[] = [];
  walk(tree, (node) => {
    const link =
      node.type === 'link'
        ? node
        : node.type === 'linkReference'
          ? definitions.get(node.identifier ?? '')
          : undefined;
    if (!link?.url || !parseDocumentLink(link.url)) return;
    links.push({
      href: link.url,
      automatic: link.title === AUTO_LINK_TITLE,
      label: nodeText(node),
      from: node.position?.start.offset ?? 0,
      to: node.position?.end.offset ?? 0,
    });
  });
  return links;
}
/** Trigger only in plain Markdown text, never a code example or an existing link. */
export function sourceLinkQuery(body: string, caret: number) {
  const prefix = body.slice(0, caret);
  const match = /(?<![\\[])\[\[([^\]\r\n[]{0,80})$/.exec(prefix);
  if (!match) return null;
  const from = caret - match[0].length;
  let plain = false;
  const tree = parser.parse(body) as AstNode;
  walk(tree, (node) => {
    if (node.type !== 'text') return;
    const start = node.position?.start.offset ?? -1,
      end = node.position?.end.offset ?? -1;
    if (start <= from && end >= caret) plain = true;
  });
  // Text descendants of links/images must not act as a new trigger.
  walk(tree, (node) => {
    if (
      !['link', 'linkReference', 'image', 'imageReference'].includes(node.type)
    )
      return;
    if (
      (node.position?.start.offset ?? Infinity) <= from &&
      (node.position?.end.offset ?? -1) >= caret
    )
      plain = false;
  });
  return plain ? { query: match[1], from, to: caret } : null;
}
export function searchLinkDocuments(
  documents: readonly LinkDocument[],
  query: string,
  currentCanvas?: string,
) {
  const normalize = (s: string) =>
    s.normalize('NFC').trim().toLocaleLowerCase();
  const q = normalize(query);
  const score = (d: LinkDocument) => {
    const title = normalize(d.title);
    return !q
      ? 0
      : title === q
        ? 0
        : title.startsWith(q)
          ? 1
          : title.includes(q)
            ? 2
            : normalize(d.relativePath).includes(q)
              ? 3
              : 4;
  };
  return documents
    .filter((d) => {
      if (!d.identitySource || score(d) >= 4) return false;
      try {
        return !!documentLinkHref(d);
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        Number((a.canvasId ?? 'default') !== (currentCanvas ?? 'default')) -
          Number((b.canvasId ?? 'default') !== (currentCanvas ?? 'default')) ||
        a.title.localeCompare(b.title) ||
        a.relativePath.localeCompare(b.relativePath),
    )
    .slice(0, 20);
}

/** Derived cache: changing layout or page title never reparses Markdown. */
export class DocumentLinkIndex {
  private entries = new Map<
    string,
    { body: string; links: DocumentLinkOccurrence[] }
  >();
  private reverse = new Map<string, LinkDocument[]>();
  private documents: readonly CanvasDocument[] | undefined;
  update(documents: readonly CanvasDocument[]) {
    if (documents === this.documents) return;
    this.documents = documents;
    const existingPaths = new Set(documents.map((d) => d.relativePath));
    for (const path of this.entries.keys())
      if (!existingPaths.has(path)) this.entries.delete(path);
    for (const d of documents)
      if (this.entries.get(d.relativePath)?.body !== d.body)
        this.entries.set(d.relativePath, {
          body: d.body,
          links: extractDocumentLinks(d.body),
        });
    const ids = new Map<string, CanvasDocument[]>(),
      paths = new Map<string, CanvasDocument[]>();
    for (const doc of documents) {
      if (doc.identitySource !== 'path')
        ids.set(doc.id, [...(ids.get(doc.id) ?? []), doc]);
      paths.set(doc.relativePath, [
        ...(paths.get(doc.relativePath) ?? []),
        doc,
      ]);
    }
    this.reverse.clear();
    for (const source of documents) {
      const seen = new Set<string>();
      for (const link of this.entries.get(source.relativePath)?.links ?? []) {
        const target = parseDocumentLink(link.href)!;
        const candidates = (target.kind === 'document' ? ids : paths).get(
          target.value,
        );
        if (
          candidates?.length !== 1 ||
          candidates[0].relativePath === source.relativePath ||
          seen.has(candidates[0].relativePath)
        )
          continue;
        const path = candidates[0].relativePath;
        seen.add(path);
        this.reverse.set(path, [...(this.reverse.get(path) ?? []), source]);
      }
    }
  }
  backlinks(target: LinkDocument) {
    return this.reverse.get(target.relativePath) ?? [];
  }
}
