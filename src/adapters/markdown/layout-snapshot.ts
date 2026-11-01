import type { Snapshot } from '../../contracts/project.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';
import { remapProjectFiles } from '../../application/projects/layout-migration.ts';
import matter from '../../markdown.ts';
import { remapLayoutMarkdown } from './layout-links.ts';
import { allocateDocumentPath } from '../../core/projects/document-path.ts';
import { remapNamedSnapshot, remapPendingNames } from './name-snapshot.ts';
import { FILE_NAMES_PATH } from '../../contracts/document-names.ts';
import { readFileNames } from '../../core/documents/name-registry.ts';
import { htmlSourcePath } from '../../html-source.ts';

export const layoutMarkdownCodec = {
  parse: (raw: string) => matter(raw),
  stringify: (body: string, data: Record<string, unknown>) =>
    matter.stringify(body, data),
};
export function remapLayoutSnapshot(
  current: Snapshot,
  old: Snapshot,
  mapNames = true,
) {
  if (mapNames) old = remapNamedSnapshot(current, old);
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
  if (Object.hasOwn(changes, FILE_NAMES_PATH)) return changes;
  const layout = readProjectLayout(current);
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
  for (const [relative, raw] of Object.entries(changes)) {
    if (raw !== null || relative === PROJECT_LAYOUT_PATH) continue;
    const candidates = readFileNames(current).entries.filter(
      (e) =>
        e.previousPaths.includes(relative) ||
        (e.kind === 'html' &&
          e.previousPaths.some((p) => htmlSourcePath(p) === relative)),
    );
    if (candidates.length && current[relative] !== undefined)
      throw Error(
        '이전 파일 이름이 다시 사용 중입니다. 현재 파일을 확인한 뒤 복원해주세요.',
      );
    if (candidates.length > 1)
      throw Error(
        '이전 파일 이름의 대상이 여러 개입니다. 현재 파일을 확인해주세요.',
      );
    const entry = candidates[0];
    const target = entry
      ? relative.startsWith('docs/html-sources/')
        ? htmlSourcePath(entry.path)
        : entry.path
      : (layout?.aliases[relative] ?? relative);
    result[target] = null;
  }
  return result;
}

/** Offline PCs may also have created documents that were never present in the server's migration. */
export function remapPendingLayout(
  current: Snapshot,
  base: Snapshot,
  local: Snapshot,
) {
  ({ base, local } = remapPendingNames(current, base, local));
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
