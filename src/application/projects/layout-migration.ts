import type { Snapshot } from '../../contracts/project.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import type { MarkdownCodec } from '../ports/markdown-codec.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';
import { allocateDocumentPath } from '../../core/projects/document-path.ts';
import { remapLayoutReferences } from '../../core/projects/layout-references.ts';

export type LayoutMarkdownLinks = (
  body: string,
  from: string,
  to: string,
  aliases: Record<string, string>,
) => string;

/** One deterministic project plan, used by the authoritative server and local migration. */
export function planProjectLayout(
  files: Snapshot,
  codec: MarkdownCodec,
  links: LayoutMarkdownLinks,
): Snapshot {
  if (readProjectLayout(files)) return { ...files };
  const aliases: Record<string, string> = {};
  const used = new Set(Object.keys(files));
  for (const [relative, raw] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (
      !relative.endsWith('.md') ||
      relative.startsWith('sections/') ||
      relative.startsWith('.ai/') ||
      relative.startsWith('docs/html-sources/') ||
      relative.startsWith('docs/text-sources/') ||
      relative.startsWith('output/')
    )
      continue;
    if (/^docs\/[^/]+\.md$/.test(relative)) continue;
    const data = codec.parse(raw).data;
    // Legacy system bundles reserve a filename prefix, not a directory. Keep that contract.
    const versioned = /^docs\/versions\/(v\d+)\/(.+)$/.exec(relative);
    const title = versioned
      ? `${versioned[1]}-${versioned[2].replace(/\.md$/, '')}`
      : String(data.title ?? relative.split('/').at(-1)!.replace(/\.md$/, ''));
    aliases[relative] = allocateDocumentPath(
      title,
      used,
      String(data.id ?? relative),
    );
    used.add(aliases[relative]);
  }
  const next = remapProjectFiles(files, aliases, codec, links);
  next[PROJECT_LAYOUT_PATH] = JSON.stringify({ version: 2, aliases });
  return next;
}

export function remapProjectFiles(
  files: Snapshot,
  aliases: Record<string, string>,
  codec: MarkdownCodec,
  links: LayoutMarkdownLinks,
): Snapshot {
  const next: Snapshot = {};
  for (const [relative, raw] of Object.entries(files)) {
    const target = aliases[relative] ?? relative;
    if (relative.endsWith('.md')) {
      const parsed = codec.parse(raw);
      const metadata = remapLayoutReferences(parsed.data, aliases) as Record<
        string,
        unknown
      >;
      if (aliases[relative] && typeof metadata.id !== 'string')
        metadata.id = relative;
      // Frozen task contracts may own a system-prefix namespace.
      const updatePrefixes = (record: unknown): void => {
        if (!record || typeof record !== 'object') return;
        const obj = record as Record<string, unknown>;
        if (
          typeof obj.overview === 'string' &&
          obj.overview.endsWith('game-overview.md') &&
          typeof obj.systemPrefix === 'string'
        )
          obj.systemPrefix =
            obj.overview.slice(0, -'game-overview.md'.length) + 'system-';
        for (const value of Object.values(obj))
          if (value && typeof value === 'object') updatePrefixes(value);
      };
      updatePrefixes(metadata);
      const body = links(parsed.content, relative, target, aliases);
      next[target] =
        body === parsed.content &&
        JSON.stringify(metadata) === JSON.stringify(parsed.data)
          ? raw
          : codec.stringify(body, metadata);
    } else if (relative.startsWith('.canvas/') && relative.endsWith('.json')) {
      const data = JSON.parse(raw);
      const mapped = remapLayoutReferences(data, aliases);
      next[target] =
        JSON.stringify(data) === JSON.stringify(mapped)
          ? raw
          : JSON.stringify(mapped);
    } else next[target] = raw;
  }
  return next;
}
