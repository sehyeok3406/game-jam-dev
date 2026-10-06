import fs from 'node:fs/promises';
import path from 'node:path';
import { isPreviewPath } from './preview-output.ts';
import { isAssetPath } from './file-assets.ts';

/** Read metadata only, never game contents or history backups. Do not follow links. */
export async function localProjectTimestamps(root: string) {
  const realRoot = await fs.realpath(root);
  let modifiedAt = 0;
  const walk = async (relative: string) => {
    const absolute = path.join(realRoot, relative);
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      modifiedAt = Math.max(modifiedAt, stat.mtimeMs);
      for (const item of await fs.readdir(absolute))
        await walk(`${relative}/${item}`);
    } else if (
      stat.isFile() &&
      (relative.endsWith('.md') ||
        isPreviewPath(relative) ||
        isAssetPath(relative) ||
        (relative.startsWith('.canvas/') && relative.endsWith('.json')))
    ) {
      modifiedAt = Math.max(modifiedAt, stat.mtimeMs);
    }
  };
  for (const relative of [
    'project.md',
    'ideas',
    'docs',
    'sections',
    '.ai/tasks',
    'output',
    'assets/images',
    '.canvas',
  ]) {
    const segments = relative.split('/');
    let linkedParent = false;
    for (let index = 1; index < segments.length; index++) {
      try {
        if (
          (
            await fs.lstat(path.join(realRoot, ...segments.slice(0, index)))
          ).isSymbolicLink()
        )
          linkedParent = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (!linkedParent) await walk(relative);
  }
  // The folder stays stable when project.md is atomically replaced on rename.
  const directory = await fs.stat(realRoot);
  return {
    createdAt: directory.birthtimeMs > 0 ? directory.birthtimeMs : undefined,
    modifiedAt: modifiedAt || undefined,
  };
}
