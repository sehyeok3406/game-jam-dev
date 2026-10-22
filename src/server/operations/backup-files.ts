import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkAncestors } from '../../trash-files.ts';

export const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const BackupLimits = {
  entries: 100000,
  manifestBytes: 16 * 1024 * 1024,
  archiveBytes: 4 * 1024 ** 3,
} as const;
export type BackupFile = { path: string; size: number; sha256: string };
export function portablePath(relative: string) {
  if (
    typeof relative !== 'string' ||
    relative.length > 2000 ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative)
  )
    throw new Error('백업 상대 경로가 올바르지 않습니다.');
  for (const part of relative.split('/')) {
    if (
      !part ||
      part === '.' ||
      part === '..' ||
      /[<>:"|?*]/.test(part) ||
      [...part].some((char) => char.charCodeAt(0) < 32) ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
      throw new Error('다른 운영체제에서 안전하지 않은 백업 경로입니다.');
  }
  return relative;
}
export function recoveryPath(relative: string) {
  portablePath(relative);
  const parts = relative.split('/');
  if (relative === 'sync.sqlite') return relative;
  if (
    parts[0] === '.project-lifecycle' &&
    parts.length === 2 &&
    uuid.test(parts[1].slice(0, -5)) &&
    parts[1].endsWith('.json')
  )
    return relative;
  let start = 0;
  if (parts[0] === '.project-trash') {
    if (!uuid.test(parts[1]) || parts[2] !== 'project')
      throw new Error('휴지통 백업 경로가 올바르지 않습니다.');
    start = 3;
  } else {
    if (!uuid.test(parts[0]))
      throw new Error('서버 복구 자료가 아닌 경로입니다.');
    start = 1;
  }
  // Do not collect arbitrary host folders, CLI accounts or personal authentication.
  const sub = parts.slice(start);
  if (sub.length === 1 && ['head.json', 'runtime.json'].includes(sub[0]))
    return relative;
  if (
    sub[0] === 'checkpoints' &&
    uuid.test(sub[1]) &&
    ((sub.length === 3 && sub[2] === 'state.json') ||
      (sub.length > 3 && sub[2] === 'files'))
  )
    return relative;
  throw new Error(
    '예상하지 못한 서버 파일이 있어 백업을 중단했습니다. 원본은 보존됩니다.',
  );
}
export async function regularFile(filename: string) {
  await checkAncestors(filename);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw new Error('링크 또는 일반 파일이 아닌 백업 자료입니다.');
  return stat;
}
export async function fileHash(filename: string) {
  const stat = await regularFile(filename),
    handle = await fs.open(filename, 'r');
  try {
    const opened = await handle.stat();
    if (stat.dev !== opened.dev || stat.ino !== opened.ino)
      throw new Error('백업 파일이 교체되었습니다.');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      size += chunk.length;
    }
    if (size !== stat.size) throw new Error('백업 파일 크기가 변경되었습니다.');
    return { size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}
export function recoveryDirectory(relative: string) {
  portablePath(relative);
  if (['.project-lifecycle', '.project-trash'].includes(relative))
    return relative;
  const parts = relative.split('/');
  let sub: string[];
  if (parts[0] === '.project-trash') {
    if (!uuid.test(parts[1]))
      throw new Error('휴지통 폴더가 올바르지 않습니다.');
    if (parts.length === 2) return relative;
    if (parts[2] !== 'project')
      throw new Error('휴지통 폴더가 올바르지 않습니다.');
    sub = parts.slice(3);
  } else {
    if (!uuid.test(parts[0])) throw new Error('서버 복구 폴더가 아닙니다.');
    sub = parts.slice(1);
  }
  if (
    !sub.length ||
    (sub[0] === 'checkpoints' &&
      (sub.length === 1 ||
        (uuid.test(sub[1]) && (sub.length === 2 || sub[2] === 'files'))))
  )
    return relative;
  throw new Error('예상하지 못한 서버 폴더가 있어 백업을 중단했습니다.');
}
export async function scanRecoveryFiles(
  root: string,
  includeDatabase = true,
  excludedProjects: ReadonlySet<string> = new Set(),
) {
  await checkAncestors(root);
  const result: BackupFile[] = [],
    seen = new Set<string>(),
    directories: string[] = [];
  async function walk(
    directory: string,
    prefix: string,
    selectedCheckpoint?: string,
  ) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('백업 폴더의 링크를 거절했습니다.');
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (result.length + directories.length > BackupLimits.entries)
        throw new Error('백업 파일 개수 한도를 초과했습니다.');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && excludedProjects.has(entry.name)) continue;
      if (
        !prefix &&
        !(includeDatabase && entry.name === 'sync.sqlite') &&
        entry.name !== '.project-lifecycle' &&
        entry.name !== '.project-trash' &&
        !uuid.test(entry.name)
      )
        continue;
      portablePath(relative);
      const full = path.join(root, ...relative.split('/'));
      if (entry.isSymbolicLink())
        throw new Error('백업 자료의 링크를 거절했습니다.');
      if (
        prefix === '.project-trash' &&
        entry.isDirectory() &&
        uuid.test(entry.name) &&
        !(await fs.readdir(full)).length
      )
        continue;
      if (
        prefix === '.project-lifecycle' &&
        /^[a-f0-9-]{36}\.json\.tmp$/.test(entry.name)
      )
        continue;
      const parts = prefix.split('/');
      const projectRoot =
        uuid.test(prefix) ||
        (parts.length === 3 &&
          parts[0] === '.project-trash' &&
          parts[2] === 'project');
      if (
        projectRoot &&
        (entry.name === 'runtime.tmp' ||
          /^head-[a-f0-9-]{36}\.tmp$/.test(entry.name))
      )
        continue;
      if (entry.isDirectory() && projectRoot && entry.name === 'checkpoints') {
        const head = await fs
          .readFile(path.join(directory, 'head.json'), 'utf8')
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
        if (!head) continue;
        const checkpoint = JSON.parse(head).checkpoint;
        if (!uuid.test(checkpoint))
          throw new Error('체크포인트 head가 올바르지 않습니다.');
        directories.push(relative);
        await walk(full, relative, checkpoint);
        continue;
      }
      if (selectedCheckpoint && entry.name !== selectedCheckpoint) continue;
      if (entry.isDirectory()) {
        recoveryDirectory(relative);
        directories.push(relative);
        await walk(full, relative);
        continue;
      }
      recoveryPath(relative);
      const canonical = relative.normalize('NFC').toLowerCase();
      if (seen.has(canonical)) throw new Error('중복된 백업 경로입니다.');
      seen.add(canonical);
      result.push({ path: relative, ...(await fileHash(full)) });
      if (result.length + directories.length > BackupLimits.entries)
        throw new Error('백업 파일 개수 한도를 초과했습니다.');
    }
  }
  await walk(root, '');
  return {
    files: result.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    directories: directories.sort(),
  };
}
export async function diskSpace(directory: string, required: number) {
  const info = await fs.statfs(directory);
  if (
    !Number.isSafeInteger(required) ||
    required < 0 ||
    info.bavail * info.bsize < required + 16 * 1024 * 1024
  )
    throw new Error('백업/복원 디스크 여유 공간이 부족합니다.');
}
export function disjoint(a: string, b: string) {
  const relative = path.relative(path.resolve(a), path.resolve(b));
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
    throw new Error('백업과 원본/복원 폴더는 서로 분리해야 합니다.');
}

export async function removeTemporary(parent: string, directory: string) {
  const target = path.resolve(directory),
    base = path.resolve(parent);
  if (
    path.dirname(target) !== base ||
    !/^\.(snapshot|verify)-/.test(path.basename(target))
  )
    throw new Error('임시 백업 정리 경로가 올바르지 않습니다.');
  await checkAncestors(target);
  await fs.rm(target, { recursive: true, force: true });
}
