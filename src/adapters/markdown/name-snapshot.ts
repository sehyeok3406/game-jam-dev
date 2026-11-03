import type { Snapshot } from '../../contracts/project.ts';
import { FILE_NAMES_PATH } from '../../contracts/document-names.ts';
import { readFileNames } from '../../core/documents/name-registry.ts';
import { remapProjectFiles } from '../../application/projects/layout-migration.ts';
import matter from '../../markdown.ts';
import { remapLayoutMarkdown } from './layout-links.ts';
import { htmlSourceId, htmlSourcePath } from '../../html-source.ts';
import { rewritePreviewLinks } from './html-name-links.ts';

/** Resolve old content by identity, even when an old filename now belongs to a different document. */
export function remapNamedSnapshot(
  current: Snapshot,
  old: Snapshot,
  pending = false,
): Snapshot {
  if (!current[FILE_NAMES_PATH]) return old;
  const registry = readFileNames(current);
  const aliases: Record<string, string> = {};
  for (const [from, raw] of Object.entries(old)) {
    if (!from.endsWith('.md')) continue;
    const id = matter(raw).data.id ?? from;
    const named = registry.entries.find(
      (e) => e.kind === 'markdown' && e.id === id,
    );
    if (named && named.path !== from) aliases[from] = named.path;
  }
  const htmlAliases: Record<string, string> = {};
  for (const entry of registry.entries.filter((e) => e.kind === 'html')) {
    for (const from of entry.previousPaths) {
      const id = old[htmlSourcePath(from)]
        ? matter(old[htmlSourcePath(from)]).data.id
        : htmlSourceId(from);
      if (
        id !== entry.id ||
        (old[from] === undefined && old[htmlSourcePath(from)] === undefined)
      )
        continue;
      aliases[from] = entry.path;
      aliases[htmlSourcePath(from)] = htmlSourcePath(entry.path);
      htmlAliases[from] = entry.path;
    }
  }
  let result = remapProjectFiles(
    old,
    aliases,
    { parse: matter, stringify: (body, data) => matter.stringify(body, data) },
    remapLayoutMarkdown,
  );
  if (Object.keys(htmlAliases).length)
    result = rewritePreviewLinks(result, htmlAliases);
  if (!pending)
    for (const entry of registry.entries.filter((e) => e.kind === 'markdown')) {
      if (!result[entry.path]) continue;
      const parsed = matter(result[entry.path]);
      if ((parsed.data.id ?? entry.path) === entry.id)
        result[entry.path] = matter.stringify(parsed.content, {
          ...parsed.data,
          title: entry.name,
        });
    }
  for (const entry of registry.entries.filter((e) => e.kind === 'html')) {
    const p = htmlSourcePath(entry.path);
    if (result[p]) {
      const parsed = matter(result[p]);
      result[p] = matter.stringify(parsed.content, {
        ...parsed.data,
        id: entry.id,
        title: entry.name,
        html_source: entry.path,
      });
    }
  }
  if (pending || Object.hasOwn(old, FILE_NAMES_PATH))
    result[FILE_NAMES_PATH] = current[FILE_NAMES_PATH];
  return result;
}

export function remapPendingNames(
  current: Snapshot,
  base: Snapshot,
  local: Snapshot,
) {
  const nextBase = remapNamedSnapshot(current, base, true),
    nextLocal = remapNamedSnapshot(current, local, true);
  for (const entry of readFileNames(current).entries.filter(
    (e) => e.kind === 'markdown',
  )) {
    const b = Object.entries(base).find(
      ([p, raw]) =>
        p.endsWith('.md') && (matter(raw).data.id ?? p) === entry.id,
    );
    const l = Object.entries(local).find(
      ([p, raw]) =>
        p.endsWith('.md') && (matter(raw).data.id ?? p) === entry.id,
    );
    if (!b || !l || matter(b[1]).data.title !== matter(l[1]).data.title)
      continue;
    for (const files of [nextBase, nextLocal])
      if (files[entry.path]) {
        const parsed = matter(files[entry.path]);
        files[entry.path] = matter.stringify(parsed.content, {
          ...parsed.data,
          title: entry.name,
        });
      }
  }
  return { base: nextBase, local: nextLocal };
}
