import fs from 'node:fs/promises';
import path from 'node:path';
import { projectPath, type Snapshot } from './project-store.ts';
import {
  isPreviewPath,
  previewDeletionTarget,
  previewWindowPath,
} from './preview-output.ts';

/** Validate every target before moving any file or owned result folder to trash. */
export async function trashDeletedFiles(
  root: string,
  before: Snapshot,
  after: Snapshot,
  trash: (absolute: string) => Promise<void>,
) {
  const removed = Object.keys(before).filter((key) => after[key] === undefined);
  const targets = new Set(removed);
  for (const relative of removed.filter(isPreviewPath)) {
    const target = previewDeletionTarget(relative);
    for (const key of targets)
      if (key.startsWith(`${target}/`)) targets.delete(key);
    targets.add(target);
    targets.add(previewWindowPath(relative));
  }
  const absoluteTargets: string[] = [];
  for (const relative of targets) {
    const absolute = await projectPath(root, relative);
    // A result's parent must remain inside the workspace, including real paths.
    if (
      absolute === (await fs.realpath(root)) ||
      !path.relative(root, absolute)
    )
      throw new Error('프로젝트 폴더 자체는 삭제할 수 없습니다.');
    try {
      await fs.lstat(absolute);
      absoluteTargets.push(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  for (const absolute of absoluteTargets) await trash(absolute);
}
