import type { Snapshot } from '../../contracts/project.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';
import { remapProjectFiles } from '../../application/projects/layout-migration.ts';
import matter from '../../markdown.ts';
import { remapLayoutMarkdown } from './layout-links.ts';
import { allocateDocumentPath } from '../../core/projects/document-path.ts';

export const layoutMarkdownCodec = {
  parse: (raw: string) => matter(raw),
  stringify: (body: string, data: Record<string, unknown>) =>
    matter.stringify(body, data),
};
export function remapLayoutSnapshot(current: Snapshot, old: Snapshot) {
  const layout = readProjectLayout(current);
  if (!layout) return old;
  const next = remapProjectFiles(
    old,
    layout.aliases,
    layoutMarkdownCodec,
    remapLayoutMarkdown,
  );
  next[PROJECT_LAYOUT_PATH] = current[PROJECT_LAYOUT_PATH];
  return next;
}
export function remapLayoutChanges(
  current: Snapshot,
  changes: Record<string, string | null>,
) {
  const layout = readProjectLayout(current);
  if (!layout) return changes;
  const values = Object.fromEntries(
    Object.entries(changes).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );
  const result: Record<string, string | null> = remapLayoutSnapshot(
    current,
    values,
  );
  delete result[PROJECT_LAYOUT_PATH];
  for (const [relative, raw] of Object.entries(changes))
    if (raw === null && relative !== PROJECT_LAYOUT_PATH)
      result[layout.aliases[relative] ?? relative] = null;
  return result;
}

/** Offline PCs may also have created documents that were never present in the server's migration. */
export function remapPendingLayout(
  current: Snapshot,
  base: Snapshot,
  local: Snapshot,
) {
  const layout = readProjectLayout(current);
  if (!layout || base[PROJECT_LAYOUT_PATH]) return { base, local };
  const aliases = { ...layout.aliases };
  const used = new Set([...Object.keys(current), ...Object.values(aliases)]);
  const identities = new Map(
    Object.entries(current)
      .filter(([p]) => /^docs\/[^/]+\.md$/.test(p))
      .map(([p, raw]) => [matter(raw).data.id, p]),
  );
  for (const [relative, raw] of Object.entries({ ...base, ...local }).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (
      aliases[relative] ||
      !relative.endsWith('.md') ||
      !/^(?:project\.md|ideas\/|docs\/)/.test(relative) ||
      /^docs\/[^/]+\.md$/.test(relative) ||
      relative.startsWith('docs/html-sources/') ||
      relative.startsWith('docs/text-sources/')
    )
      continue;
    const data = matter(raw).data;
    aliases[relative] =
      identities.get(data.id ?? relative) ??
      allocateDocumentPath(
        String(data.title ?? '문서'),
        used,
        String(data.id ?? relative),
      );
    used.add(aliases[relative]);
  }
  const convert = (files: Snapshot) => ({
    ...remapProjectFiles(
      files,
      aliases,
      layoutMarkdownCodec,
      remapLayoutMarkdown,
    ),
    [PROJECT_LAYOUT_PATH]: current[PROJECT_LAYOUT_PATH],
  });
  return { base: convert(base), local: convert(local) };
}
