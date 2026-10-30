import fs from 'node:fs/promises';
import path from 'node:path';
import { physicalProjectPath } from '../../core/projects/project-layout.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';

/** Never cache across a migration or a reused project root. */
export async function readDiskProjectLayout(root: string) {
  try {
    const filename = path.join(root, '.gamejam/project/layout.json');
    const realRoot = await fs.realpath(root),
      realFile = await fs.realpath(filename);
    const relative = path.relative(realRoot, realFile);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw Error('프로젝트 관리 파일의 외부 링크는 허용되지 않습니다.');
    return readProjectLayout({
      [PROJECT_LAYOUT_PATH]: await fs.readFile(realFile, 'utf8'),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export async function hasModernLayout(root: string) {
  return !!(await readDiskProjectLayout(root));
}
export async function projectRelativeLocation(root: string, relative: string) {
  const modern = !!(await readDiskProjectLayout(root));
  if (relative === '.canvas/layout.json' && !modern) {
    if (await fs.stat(path.join(root, relative)).catch(() => null))
      return relative;
  }
  return physicalProjectPath(relative, modern);
}
