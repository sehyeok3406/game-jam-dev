import { DOCUMENT_STATUSES_PATH, readStatuses } from './document-statuses.ts';
import { workflowDocuments } from './document-statuses-storage.ts';
import matter from './markdown.ts';
import {
  isPreviewPath,
  previewWindowPath,
  isResultFolderPath,
} from './preview-output.ts';
import type { Snapshot } from './project-store.ts';
import type { AiFileLock } from './shared.ts';
import { documentBundleContract } from './document-bundle.ts';

export const AI_FILE_LOCK_MESSAGE =
  '현재 AI 작업에 사용 중인 파일은 수정·삭제·이동할 수 없습니다. 관련 없는 문서는 계속 편집할 수 있습니다.';
const key = (relative: string) => relative.replaceAll('\\', '/').toLowerCase();

export function mergeAiFileLocks(
  locks: (AiFileLock | null | undefined)[],
): AiFileLock {
  return {
    paths: [...new Set(locks.flatMap((lock) => lock?.paths ?? []))],
    folders: [...new Set(locks.flatMap((lock) => lock?.folders ?? []))],
    prefixes: [...new Set(locks.flatMap((lock) => lock?.prefixes ?? []))],
  };
}

/** Scope intersection includes empty reserved folders and dynamic output prefixes. */
export function aiScopesOverlap(a: AiFileLock, b: AiFileLock): boolean {
  if (
    a.paths.some((p) => isAiFileLocked(b, p)) ||
    b.paths.some((p) => isAiFileLocked(a, p))
  )
    return true;
  const ranges = (lock: AiFileLock) => [
    ...lock.folders.map((p) => `${key(p).replace(/\/$/, '')}/`),
    ...(lock.prefixes ?? []).map(key),
  ];
  return ranges(a).some((x) =>
    ranges(b).some((y) => x.startsWith(y) || y.startsWith(x)),
  );
}

export function taskFileScopes(files: Snapshot, taskPath: string) {
  const outputs = new Set<string>([taskPath]);
  const prefixes = new Set<string>();
  const collect = (raw: string, depth = 0) => {
    const data = matter(raw).data;
    for (const p of Array.isArray(data.expected_outputs)
      ? data.expected_outputs
      : [])
      if (typeof p === 'string') outputs.add(p);
    const bundle = documentBundleContract(raw);
    if (bundle) prefixes.add(bundle.systemPrefix);
    if (!depth)
      for (const stage of data.workflow_steps ?? [])
        if (typeof stage === 'string') collect(stage, 1);
  };
  if (!files[taskPath]) throw new Error('AI 작업 명세를 찾을 수 없습니다.');
  collect(files[taskPath]);
  // Expand output companions with the same dependency rules as inputs.
  const outputTask = '.ai/tasks/__scope__.md';
  const write = taskFileLock(
    {
      ...files,
      [outputTask]: matter.stringify('', { expected_outputs: [...outputs] }),
    },
    outputTask,
  );
  write.paths = write.paths.filter((p) => p !== outputTask);
  write.prefixes = [...prefixes];
  const protectedScope = taskFileLock(files, taskPath);
  const read: AiFileLock = {
    paths: protectedScope.paths.filter((p) => !isAiFileLocked(write, p)),
    folders: protectedScope.folders.filter((p) => !write.folders.includes(p)),
    prefixes: (protectedScope.prefixes ?? []).filter((p) => !prefixes.has(p)),
  };
  return { read, write, protectedScope };
}

/** The frozen task contract, including both workflow stages, defines the lease. */
export function taskFileLock(files: Snapshot, taskPath: string): AiFileLock {
  const paths = new Set<string>([taskPath]);
  const folders = new Set<string>();
  const prefixes = new Set<string>();
  const addTask = (raw: string, depth = 0) => {
    const data = matter(raw).data;
    const bundle = documentBundleContract(raw);
    if (bundle) prefixes.add(bundle.systemPrefix);
    for (const value of [
      ...(Array.isArray(data.inputs) ? data.inputs : []),
      ...(Array.isArray(data.expected_outputs) ? data.expected_outputs : []),
      data.base_html,
      data.html_analysis_source?.path,
    ])
      if (typeof value === 'string' && value) paths.add(value);
    for (const stage of Array.isArray(data.workflow_steps)
      ? data.workflow_steps
      : [])
      if (typeof stage === 'string' && depth === 0) addTask(stage, 1);
  };
  if (!files[taskPath]) throw new Error('AI 작업 명세를 찾을 수 없습니다.');
  addTask(files[taskPath]);
  // Sections and image cards are references to real input files, not copies.
  for (const relative of paths) {
    if (isPreviewPath(relative)) {
      paths.add(previewWindowPath(relative));
      for (const [source, raw] of Object.entries(files))
        if (
          source.startsWith('docs/html-sources/') &&
          matter(raw).data.html_source === relative
        )
          paths.add(source);
      if (isResultFolderPath(relative))
        folders.add(relative.slice(0, relative.lastIndexOf('/')));
    }
    if (!relative.endsWith('.md') || !files[relative]) continue;
    const data = matter(files[relative]).data;
    if (typeof data.asset?.path === 'string') paths.add(data.asset.path);
    if (relative.startsWith('sections/'))
      for (const member of Array.isArray(data.members) ? data.members : [])
        if (typeof member?.path === 'string') paths.add(member.path);
  }
  return {
    paths: [...paths].sort(),
    folders: [...folders].sort(),
    ...(prefixes.size ? { prefixes: [...prefixes].sort() } : {}),
  };
}

export function isAiFileLocked(
  lock: AiFileLock | null | undefined,
  relative: string,
) {
  const candidate = key(relative);
  return (
    !!lock &&
    (lock.paths.some((path) => key(path) === candidate) ||
      lock.prefixes?.some((prefix) => candidate.startsWith(key(prefix))) ||
      lock.folders.some(
        (folder) =>
          candidate === key(folder) || candidate.startsWith(`${key(folder)}/`),
      ))
  );
}

export function assertAiFilesUnlocked(
  lock: AiFileLock | null | undefined,
  paths: string[],
) {
  const blocked = paths.find((relative) => isAiFileLocked(lock, relative));
  if (blocked) throw new Error(`${AI_FILE_LOCK_MESSAGE} (${blocked})`);
}

export function assertAiMutation(
  lock: AiFileLock | null | undefined,
  before: Snapshot,
  after: Snapshot,
  channel = '',
  input: Record<string, unknown> = {},
) {
  if (!lock) return;
  const paths = Object.keys({ ...before, ...after }).filter(
    (path) => before[path] !== after[path],
  );
  if (
    (channel.startsWith('documents:') ||
      channel === 'files:set-status-property' ||
      channel === 'kanban:move-card') &&
    channel !== 'documents:duplicate' &&
    typeof input.relativePath === 'string'
  )
    paths.push(input.relativePath);
  if (channel === 'documents:delete-many')
    for (const item of (input.documents ?? []) as { relativePath: string }[])
      paths.push(item.relativePath);
  if (channel === 'layouts:update')
    for (const item of (input.updates ?? []) as { relativePath: string }[])
      paths.push(item.relativePath);
  if (
    channel === 'sections:move-document' &&
    typeof input.documentPath === 'string'
  )
    paths.push(input.documentPath);
  if (channel === 'sections:create')
    for (const item of (input.members ?? []) as { path: string }[])
      paths.push(item.path);
  if (
    channel === 'sections:delete' &&
    typeof input.relativePath === 'string' &&
    before[input.relativePath]
  )
    for (const item of matter(before[input.relativePath]).data.members ?? [])
      paths.push(item.path);
  if (before[DOCUMENT_STATUSES_PATH] !== after[DOCUMENT_STATUSES_PATH]) {
    const old = readStatuses(before[DOCUMENT_STATUSES_PATH]);
    const next = readStatuses(after[DOCUMENT_STATUSES_PATH]);
    const changed = new Set(
      old.statuses
        .filter(
          (s) =>
            JSON.stringify(s) !==
            JSON.stringify(next.statuses.find((n) => n.id === s.id)),
        )
        .map((s) => s.id),
    );
    for (const doc of workflowDocuments(before))
      if (changed.has(doc.workflowStatusId ?? 'not-started'))
        paths.push(doc.path);
  }
  assertAiFilesUnlocked(lock, paths);
}

/** Hash/compare only the frozen inputs and reserved outputs; edits elsewhere survive. */
export function aiLockedSnapshot(files: Snapshot, lock: AiFileLock): Snapshot {
  return Object.fromEntries(
    Object.keys(files)
      .filter((path) => isAiFileLocked(lock, path))
      .sort()
      .map((path) => [path, files[path]]),
  );
}

export function changedAiFile(
  before: Snapshot,
  after: Snapshot,
  lock: AiFileLock,
) {
  return Object.keys({ ...before, ...after }).find(
    (path) => isAiFileLocked(lock, path) && before[path] !== after[path],
  );
}
