import fs from 'node:fs/promises';
import path from 'node:path';
export const TRASH_RETENTION = 7 * 24 * 60 * 60 * 1000;
export const canonical = (p: string) => {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
export const inside = (parent: string, child: string) => {
  const relative = path.relative(canonical(parent), canonical(child));
  return (
    !relative ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};
export async function statDirectory(p: string) {
  try {
    const stat = await fs.lstat(p);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw Error('폴더 또는 링크 상태가 변경되었습니다.');
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function checkAncestors(p: string) {
  for (let current = path.resolve(p); ; ) {
    const stat = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (stat?.isSymbolicLink())
      throw Error(
        '링크 또는 junction 경로는 휴지통 작업에 사용할 수 없습니다.',
      );
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export async function atomicJson(p: string, data: unknown) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const temporary = `${p}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data), {
    mode: 0o600,
    flush: true,
  });
  await fs.rename(temporary, p);
}
export async function moveChecked(
  from: string,
  to: string,
  identity: string | null,
) {
  await checkAncestors(from);
  await checkAncestors(to);
  const source = await statDirectory(from),
    target = await statDirectory(to);
  if (target) {
    if (!source && target === identity) return; // durable resume after rename
    throw Error('대상 경로에 다른 폴더가 있습니다. 덮어쓰지 않았습니다.');
  }
  if (source !== identity) throw Error('프로젝트 폴더가 변경되었습니다.');
  if (!source) return;
  await fs.mkdir(path.dirname(to), { recursive: true });
  await checkAncestors(to);
  await fs.rename(from, to);
}
export async function purgeChecked(
  target: string,
  expected: string,
  identity: string | null,
) {
  if (canonical(target) !== canonical(expected))
    throw Error('휴지통 경로가 올바르지 않습니다.');
  await checkAncestors(target);
  const actual = await statDirectory(target);
  if (!actual) return;
  if (actual !== identity)
    throw Error('휴지통 폴더가 교체되었습니다. 삭제하지 않았습니다.');
  await fs.rm(target, {
    recursive: true,
    force: true,
    maxRetries: 2,
    retryDelay: 100,
  });
}
