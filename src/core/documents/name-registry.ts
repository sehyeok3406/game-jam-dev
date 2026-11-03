import {
  FILE_NAMES_PATH,
  type FileNames,
  type NamedFile,
} from '../../contracts/document-names.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { documentName, fileNameKey } from './file-name.ts';

const safePath = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length <= 240 &&
  !p.includes('\\') &&
  !p.startsWith('/') &&
  p
    .split('/')
    .every(
      (s) =>
        !!s &&
        s !== '.' &&
        s !== '..' &&
        !/[<>:"|?*]/.test(s) &&
        ![...s].some((c) => c.charCodeAt(0) < 32),
    );
export function readFileNames(files: Snapshot): FileNames {
  const raw = files[FILE_NAMES_PATH];
  if (raw === undefined) return { version: 1, entries: [] };
  const value = JSON.parse(raw) as FileNames;
  if (
    value?.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 5000
  )
    throw Error('파일 이름 이력이 올바르지 않습니다.');
  const ids = new Set<string>(),
    paths = new Set<string>();
  for (const e of value.entries) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      !e.id ||
      ids.has(e.id) ||
      !['markdown', 'html'].includes(e.kind) ||
      !safePath(e.path) ||
      !safePath(e.originalPath) ||
      paths.has(fileNameKey(e.path)) ||
      !Array.isArray(e.previousPaths) ||
      !e.previousPaths.every(safePath) ||
      e.previousPaths.length > 500 ||
      documentName(e.name) !== e.name ||
      !e.path.endsWith(e.kind === 'html' ? '.html' : '.md')
    )
      throw Error('파일 이름 이력의 식별자·경로가 올바르지 않습니다.');
    ids.add(e.id);
    paths.add(fileNameKey(e.path));
  }
  return value;
}
export function rememberFileName(
  files: Snapshot,
  id: string,
  kind: NamedFile['kind'],
  from: string,
  to: string,
  name: string,
) {
  const registry = readFileNames(files);
  const old = registry.entries.find((e) => e.id === id);
  const entry: NamedFile = {
    id,
    kind,
    path: to,
    name,
    originalPath: old?.originalPath ?? from,
    previousPaths: [...new Set([...(old?.previousPaths ?? []), from])].filter(
      (p) => p !== to,
    ),
  };
  if (entry.previousPaths.length > 500)
    throw Error('이 문서의 이름 변경 이력이 너무 많습니다.');
  registry.entries = [
    ...registry.entries.filter(
      (e) => e.id !== id && fileNameKey(e.path) !== fileNameKey(to),
    ),
    entry,
  ];
  const next = { ...files, [FILE_NAMES_PATH]: JSON.stringify(registry) };
  readFileNames(next);
  return next;
}
export function namedPath(files: Snapshot, id: string, fallback: string) {
  return (
    readFileNames(files).entries.find((e) => e.id === id)?.path ?? fallback
  );
}
