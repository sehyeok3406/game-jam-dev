import { rebaseProjectLink } from '../../core/projects/relative-links.ts';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import {
  extractDocumentLinks,
  parseDocumentLink,
} from '../../document-links.ts';
import type { LayoutMarkdownLinks } from '../../application/projects/layout-migration.ts';

const parser = unified().use(remarkParse);
/** Rewrite parsed link destinations by offsets; code and ordinary prose remain unchanged. */
export const remapLayoutMarkdown: LayoutMarkdownLinks = (
  body,
  from,
  to,
  aliases,
) => {
  const edits: { from: number; to: number; text: string }[] = [];
  for (const link of extractDocumentLinks(body)) {
    const target = parseDocumentLink(link.href);
    if (target?.kind !== 'file' || !aliases[target.value]) continue;
    const text = body.slice(link.from, link.to);
    edits.push({
      from: link.from,
      to: link.to,
      text: text.replace(
        link.href,
        `gamejam://file/${encodeURIComponent(aliases[target.value])}`,
      ),
    });
  }
  const walk = (node: {
    type: string;
    url?: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: unknown[];
  }) => {
    if (
      ['link', 'image', 'definition'].includes(node.type) &&
      node.url &&
      !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(node.url)
    ) {
      const split = /^([^?#]*)(.*)$/.exec(node.url)!;
      let relative: string;
      try {
        relative = decodeURIComponent(split[1]);
      } catch {
        return;
      }
      const rebased = rebaseProjectLink(from, to, relative, aliases);
      const replacement = rebased === null ? node.url : rebased + split[2];
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (
        replacement !== node.url &&
        start !== undefined &&
        end !== undefined
      ) {
        const raw = body.slice(start, end);
        const index = raw.lastIndexOf(node.url);
        if (index >= 0)
          edits.push({
            from: start + index,
            to: start + index + node.url.length,
            text: replacement.replace(/ /g, '%20'),
          });
      }
    }
    for (const child of node.children ?? [])
      walk(child as Parameters<typeof walk>[0]);
  };
  walk(parser.parse(body));
  for (const edit of edits.sort((a, b) => b.from - a.from))
    body = body.slice(0, edit.from) + edit.text + body.slice(edit.to);
  return body;
};
