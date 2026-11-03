import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceFileWithRetry } from './atomic-replace.ts';

export async function writeExportedHtml(
  content: string,
  destination: string,
  root: string,
  check: () => Promise<void>,
) {
  const target = path.resolve(destination),
    parent = await fs.realpath(path.dirname(target));
  const workspace = await fs.realpath(root).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return path.resolve(root);
  });
  const inside = (candidate: string) => {
    const relative = path.relative(workspace, candidate);
    return (
      !relative ||
      (!relative.startsWith('..' + path.sep) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    );
  };
  if (inside(target) || inside(path.join(parent, path.basename(target))))
    throw Error(
      '프로젝트 밖의 폴더를 선택해주세요. 프로젝트 파일은 기존 저장·히스토리로 관리합니다.',
    );
  const existing = await fs.lstat(target).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (existing?.isSymbolicLink() || existing?.isDirectory())
    throw Error('일반 HTML 파일 위치를 선택해주세요.');
  const temporary = path.join(parent, `.gamejam-export-${randomUUID()}.tmp`);
  try {
    await check();
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await replaceFileWithRetry(temporary, target, check);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
