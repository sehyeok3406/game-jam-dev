import type { ResultMove } from './result-folder-plan.ts';
export {
  moveDestination,
  legacyResultMoves,
  type ResultMove,
  type MoveResultInput,
} from './result-folder-plan.ts';
import type { Snapshot } from './project-store.ts';
import { htmlSourceId, htmlSourcePath } from './html-source.ts';
import {
  isPreviewPath,
  previewDeletionTarget,
  resultLocation,
} from './preview-output.ts';

export const RESULT_CATALOG_PATH = '.canvas/results.json';
const CATALOG = RESULT_CATALOG_PATH;
type Entry = { id: string; path: string; previousPaths: string[] };
export function readResultCatalog(raw: string): Entry[] {
  const value = JSON.parse(raw);
  if (
    value?.schemaVersion !== 1 ||
    !Array.isArray(value.results) ||
    value.results.length > 500
  )
    throw new Error('결과물 폴더 목록이 올바르지 않습니다.');
  const ids = new Set<string>(),
    paths = new Set<string>();
  for (const entry of value.results) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !/^html-[a-f0-9]{24}$/.test(entry.id) ||
      ids.has(entry.id) ||
      !isPreviewPath(entry.path) ||
      paths.has(entry.path.toLowerCase()) ||
      !Array.isArray(entry.previousPaths) ||
      entry.previousPaths.length > 500 ||
      !entry.previousPaths.every(isPreviewPath)
    )
      throw new Error('결과물 폴더 목록의 경로·ID가 올바르지 않습니다.');
    ids.add(entry.id);
    paths.add(entry.path.toLowerCase());
  }
  return value.results;
}
function catalog(files: Snapshot): Entry[] {
  return files[CATALOG] ? readResultCatalog(files[CATALOG]) : [];
}
export function resultPreviousPaths(
  files: Snapshot,
  relative: string,
): string[] {
  return (
    catalog(files).find((entry) => entry.path === relative)?.previousPaths ?? []
  );
}

/** Stable catalog identities let every participant move their own physical copy. */
export function resultMoves(before: Snapshot, after: Snapshot): ResultMove[] {
  const moves: ResultMove[] = [];
  for (const entry of catalog(after)) {
    if (after[entry.path] === undefined || before[entry.path] !== undefined)
      continue;
    const from = entry.previousPaths.find(
      (key) => before[key] !== undefined && after[key] === undefined,
    );
    if (from) moves.push({ from, to: entry.path });
  }
  for (const entry of catalog(before)) {
    if (after[entry.path] !== undefined || before[entry.path] === undefined)
      continue;
    const to = entry.previousPaths.find(
      (key) => after[key] !== undefined && before[key] === undefined,
    );
    if (to && !moves.some((move) => move.from === entry.path))
      moves.push({ from: entry.path, to });
  }
  return moves;
}

/** Restore immutable old records into their current result locations. */
export function remapResultChanges(
  current: Snapshot,
  changes: Record<string, string | null>,
) {
  if (Object.hasOwn(changes, CATALOG)) return changes;
  const replacements = new Map<string, string>();
  const aliases: ResultMove[] = [];
  for (const entry of catalog(current))
    for (const from of entry.previousPaths) {
      if (current[from] !== undefined) continue;
      aliases.push({ from, to: entry.path });
      replacements.set(from, entry.path);
      replacements.set(htmlSourcePath(from), htmlSourcePath(entry.path));
      replacements.set(htmlSourceId(from), htmlSourceId(entry.path));
    }
  const pattern = [...replacements.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const remapped: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(changes)) {
    let target = replacements.get(key) ?? key;
    for (const { from, to } of aliases) {
      const owned = previewDeletionTarget(from);
      if (owned !== from && key.startsWith(`${owned}/`))
        target = `${previewDeletionTarget(to)}${key.slice(owned.length)}`;
    }
    remapped[target] =
      typeof value === 'string' && key.endsWith('.md') && pattern
        ? value.replace(
            new RegExp(pattern, 'g'),
            (original) => replacements.get(original)!,
          )
        : value;
  }
  return remapped;
}

export function relocateResults(
  files: Snapshot,
  moves: ResultMove[],
): Snapshot {
  const next = { ...files };
  const replacements = new Map<string, string>();
  const entries = catalog(files);
  const destinations = new Set(
    Object.keys(files).map((key) => key.toLowerCase()),
  );
  const sources = new Set<string>();
  for (const { from, to } of moves) {
    if (
      !isPreviewPath(from) ||
      !resultLocation(to) ||
      files[from] === undefined ||
      sources.has(from)
    )
      throw new Error('결과물 이동 경로를 확인해주세요.');
    sources.add(from);
    if (from === to) continue;
    const target = previewDeletionTarget(to);
    if (
      [...destinations].some(
        (key) =>
          key === to.toLowerCase() ||
          key.startsWith(`${target.toLowerCase()}/`),
      )
    )
      throw new Error(`이미 사용 중인 결과 폴더입니다: ${target}`);
    destinations.add(to.toLowerCase());
    const owned = previewDeletionTarget(from);
    for (const key of Object.keys(files)) {
      if (key !== from && (owned === from || !key.startsWith(`${owned}/`)))
        continue;
      const destination =
        key === from ? to : `${target}${key.slice(owned.length)}`;
      replacements.set(key, destination);
      delete next[key];
      next[destination] = files[key];
    }
    const oldSource = htmlSourcePath(from),
      newSource = htmlSourcePath(to);
    replacements.set(from, to);
    replacements.set(oldSource, newSource);
    replacements.set(htmlSourceId(from), htmlSourceId(to));
    if (files[oldSource] !== undefined) {
      delete next[oldSource];
      next[newSource] = files[oldSource];
    }
    const entry = entries.find((item) => item.path === from);
    if (entry) {
      entry.previousPaths = [...new Set([from, ...entry.previousPaths])].filter(
        (key) => key !== to,
      );
      entry.path = to;
    } else
      entries.push({ id: htmlSourceId(from), path: to, previousPaths: [from] });
  }
  // Rewrite paths and source identities in frontmatter, nested task plans and
  // Markdown links together. HTML bytes and relative asset links remain intact.
  const substitutions = [...replacements].sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const key of Object.keys(next).filter(
    (key) => key.endsWith('.md') && key !== CATALOG,
  )) {
    const original = next[key];
    // One pass prevents a replacement from being rewritten a second time.
    const pattern = substitutions
      .map(([from]) => from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    if (pattern)
      next[key] = original.replace(
        new RegExp(pattern, 'g'),
        (value) => replacements.get(value)!,
      );
  }
  if (moves.some(({ from, to }) => from !== to))
    next[CATALOG] = JSON.stringify(
      { schemaVersion: 1, results: entries },
      null,
      2,
    );
  return next;
}
