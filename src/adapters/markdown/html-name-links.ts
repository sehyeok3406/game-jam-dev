import { parse, type DefaultTreeAdapterMap } from 'parse5';
import type { Snapshot } from '../../contracts/project.ts';
import { isPreviewPath } from '../../preview-output.ts';
import { rebaseProjectLink } from '../../core/projects/relative-links.ts';
import { htmlReferences } from '../../html-references.ts';

/** Parsed static links only; dynamic script references require manual correction. */
export function rewritePreviewLinks(
  files: Snapshot,
  aliases: Record<string, string>,
): Snapshot {
  const next = { ...files };
  for (const [relative, raw] of Object.entries(files).filter(([p]) =>
    isPreviewPath(p),
  )) {
    const original =
      Object.keys(aliases).find((p) => aliases[p] === relative) ?? relative;
    const edits: { start: number; end: number; value: string }[] = [];
    const targets = new Set<string>();
    const rewrite = (url: string) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return null;
      const parts = /^([^?#]*)(.*)$/.exec(url)!;
      let path: string;
      try {
        path = decodeURIComponent(parts[1]);
      } catch {
        return null;
      }
      const changed = rebaseProjectLink(original, relative, path, aliases);
      return changed === null ? null : changed.replace(/ /g, '%20') + parts[2];
    };
    const walk = (node: DefaultTreeAdapterMap['node']) => {
      if ('tagName' in node && ['script', 'style'].includes(node.tagName)) {
        const source = node.childNodes
          .filter((n) => 'value' in n)
          .map((n) => ('value' in n ? n.value : ''))
          .join('');
        for (const reference of htmlReferences(
          source,
          node.tagName === 'script' ? 'js' : 'css',
        )) {
          const changed = rewrite(reference);
          if (changed !== null && changed !== reference)
            throw Error(
              `스크립트·스타일의 파일 참조를 먼저 수정해주세요: ${original} → ${reference}`,
            );
        }
      }
      if ('attrs' in node)
        for (const attr of node.attrs)
          if (['href', 'src', 'action', 'poster', 'data'].includes(attr.name)) {
            const changed = rewrite(attr.value),
              loc = node.sourceCodeLocation?.attrs?.[attr.name];
            if (changed !== null && changed !== attr.value && loc) {
              targets.add(attr.value);
              const source = raw.slice(loc.startOffset, loc.endOffset),
                equal = source.indexOf('=');
              if (equal < 0) continue;
              const value = source.slice(equal + 1).trim();
              const quote =
                value[0] === '"' || value[0] === "'" ? value[0] : '"';
              edits.push({
                start: loc.startOffset,
                end: loc.endOffset,
                value:
                  source.slice(0, equal + 1) +
                  quote +
                  changed
                    .replaceAll('&', '&amp;')
                    .replaceAll(quote, quote === '"' ? '&quot;' : '&#39;') +
                  quote,
              });
            }
          }
      if ('childNodes' in node)
        for (const child of node.childNodes) walk(child);
    };
    walk(parse(raw, { sourceCodeLocationInfo: true }));
    for (const reference of htmlReferences(raw, 'html')) {
      const changed = rewrite(reference);
      if (changed !== null && changed !== reference && !targets.has(reference))
        throw Error(
          `스크립트·스타일의 파일 참조를 먼저 수정해주세요: ${original} → ${reference}`,
        );
    }
    let content = raw;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      content =
        content.slice(0, edit.start) + edit.value + content.slice(edit.end);
    next[relative] = content;
  }
  return next;
}
