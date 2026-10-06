import { createHash } from 'node:crypto';
import matter from './markdown.ts';
import {
  checkSnapshot,
  snapshotDocuments,
  snapshotSections,
} from './collaboration-model.ts';
import type { Snapshot } from './project-store.ts';
import type { OfflineConflict } from './shared.ts';

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const changedPaths = (base: Snapshot, local: Snapshot) =>
  Object.keys({ ...base, ...local }).filter(
    (path) => base[path] !== local[path],
  );

/** Merge independent Markdown properties (e.g. text vs. layout/color). Never merge competing text edits silently. */
function mergeFile(
  path: string,
  base: string | undefined,
  local: string | undefined,
  server: string | undefined,
) {
  if (local === base || local === server) return { value: server };
  if (server === base) return { value: local };
  if (
    !path.endsWith('.md') ||
    base === undefined ||
    local === undefined ||
    server === undefined
  )
    return { conflict: true, value: local };
  const b = matter(base),
    l = matter(local),
    s = matter(server);
  const data: Record<string, unknown> = {};
  for (const key of Object.keys({ ...b.data, ...l.data, ...s.data })) {
    if (key === 'updated_at') continue;
    if (same(l.data[key], b.data[key]) || same(l.data[key], s.data[key]))
      data[key] = s.data[key];
    else if (same(s.data[key], b.data[key])) data[key] = l.data[key];
    else return { conflict: true, value: local };
    if (data[key] === undefined) delete data[key];
  }
  const body = (entry: ReturnType<typeof matter>) => entry.content.trim();
  let content: string;
  if (body(l) === body(b) || body(l) === body(s)) content = body(s);
  else if (body(s) === body(b)) content = body(l);
  else return { conflict: true, value: local };
  data.updated_at = Math.max(
    Number(l.data.updated_at) || 0,
    Number(s.data.updated_at) || 0,
  );
  return { value: matter.stringify(`\n${content}\n`, data) };
}

function conflict(
  paths: string[],
  local: Snapshot,
  server: Snapshot,
): OfflineConflict {
  const values = (files: Snapshot) =>
    paths.map((path) => ({ path, content: files[path] ?? null }));
  return {
    id: createHash('sha256')
      .update(JSON.stringify([paths, values(local), values(server)]))
      .digest('hex'),
    paths,
    local: values(local),
    server: values(server),
  };
}

/** Keep section membership, source documents and binary assets together when a merge would break their relationship. */
function relatedPaths(initial: string[], snapshots: Snapshot[]) {
  const paths = new Set(initial);
  const groups: string[][] = [];
  for (const files of snapshots) {
    for (const section of snapshotSections(files))
      groups.push([
        section.relativePath,
        ...section.members.map((member) => member.path),
      ]);
    for (const doc of snapshotDocuments(files)) {
      if (doc.asset) groups.push([doc.relativePath, doc.asset.path]);
      if (doc.htmlSource) groups.push([doc.relativePath, doc.htmlSource]);
    }
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const group of groups)
      if (group.some((path) => paths.has(path)))
        for (const path of group)
          if (!paths.has(path)) {
            paths.add(path);
            expanded = true;
          }
  }
  return [...paths].sort();
}

export function planOfflineMerge(
  base: Snapshot,
  local: Snapshot,
  server: Snapshot,
) {
  const merged = { ...server };
  const conflicts: OfflineConflict[] = [];
  const touched = changedPaths(base, local);
  for (const path of touched) {
    const result = mergeFile(path, base[path], local[path], server[path]);
    if (result.conflict) conflicts.push(conflict([path], local, server));
    if (result.value === undefined) delete merged[path];
    else merged[path] = result.value;
  }
  try {
    checkSnapshot(merged);
  } catch {
    const paths = relatedPaths(touched, [base, local, server]);
    // All dependent changes must be resolved as one transaction.
    return {
      merged: { ...server },
      conflicts: [conflict(paths, local, server)],
    };
  }
  return { merged, conflicts };
}

export function snapshotChanges(before: Snapshot, after: Snapshot) {
  return Object.fromEntries(
    changedPaths(before, after).map((path) => [path, after[path] ?? null]),
  );
}
