import matter from './markdown.ts';
import {
  isPreviewPath,
  previewWindowPath,
  isResultFolderPath,
} from './preview-output.ts';
import type { Snapshot } from './project-store.ts';
import type { AiFileLock } from './shared.ts';

export const AI_FILE_LOCK_MESSAGE =
  '현재 AI 작업에 사용 중인 파일은 수정·삭제·이동할 수 없습니다. 관련 없는 문서는 계속 편집할 수 있습니다.';
const key = (relative: string) => relative.replaceAll('\\', '/').toLowerCase();

/** The frozen task contract, including both workflow stages, defines the lease. */
export function taskFileLock(files: Snapshot, taskPath: string): AiFileLock {
  const paths = new Set<string>([taskPath]);
  const folders = new Set<string>();
  const addTask = (raw: string, depth = 0) => {
    const data = matter(raw).data;
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
  return { paths: [...paths].sort(), folders: [...folders].sort() };
}

export function isAiFileLocked(
  lock: AiFileLock | null | undefined,
  relative: string,
) {
  const candidate = key(relative);
  return (
    !!lock &&
    (lock.paths.some((path) => key(path) === candidate) ||
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
    channel.startsWith('documents:') &&
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
