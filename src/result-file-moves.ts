import fs from 'node:fs/promises';
import path from 'node:path';
import { projectPath, type Snapshot } from './project-store.ts';
import {
  previewDeletionTarget,
  previewWindowPath,
  RESULT_CATEGORIES,
  isResultFolderPath,
} from './preview-output.ts';
import { resultMoves } from './result-structure.ts';

async function exists(absolute: string) {
  try {
    await fs.lstat(absolute);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function inspect(absolute: string): Promise<void> {
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink())
    throw new Error('결과물 폴더의 심볼릭 링크는 이동할 수 없습니다.');
  if (stat.isDirectory())
    for (const entry of await fs.readdir(absolute))
      await inspect(path.join(absolute, entry));
}
/** Only physical HTML/assets move before the metadata transaction is applied. */
export function resultFileBaseline(
  before: Snapshot,
  after: Snapshot,
): Snapshot {
  const baseline = { ...before };
  for (const move of resultMoves(before, after)) {
    const owned = previewDeletionTarget(move.from),
      target = previewDeletionTarget(move.to);
    for (const key of Object.keys(before)) {
      if (
        key === move.from ||
        (isResultFolderPath(move.from) &&
          isResultFolderPath(move.to) &&
          key.startsWith(`${owned}/`))
      ) {
        const destination =
          key === move.from ? move.to : `${target}${key.slice(owned.length)}`;
        delete baseline[key];
        baseline[destination] = before[key];
      }
    }
  }
  return baseline;
}

/** Preflight every destination, then rename entire folders with rollback. */
export async function moveResultFiles(
  root: string,
  before: Snapshot,
  after: Snapshot,
) {
  const moves = resultMoves(before, after);
  const targets: { from: string; to: string }[] = [];
  for (const move of moves) {
    if (
      !isResultFolderPath(move.from) &&
      isResultFolderPath(move.to) &&
      (await exists(await projectPath(root, previewDeletionTarget(move.to))))
    )
      throw new Error('이동할 위치에 이미 결과 폴더가 있습니다.');
    const source =
      isResultFolderPath(move.from) && isResultFolderPath(move.to)
        ? previewDeletionTarget(move.from)
        : move.from;
    const destination =
      isResultFolderPath(move.from) && isResultFolderPath(move.to)
        ? previewDeletionTarget(move.to)
        : move.to;
    for (const [oldRelative, newRelative] of [
      [source, destination],
      [previewWindowPath(move.from), previewWindowPath(move.to)],
    ]) {
      const from = await projectPath(root, oldRelative),
        to = await projectPath(root, newRelative);
      if (from === to || !(await exists(from))) continue;
      if (await exists(to))
        throw new Error(
          `이동할 위치에 이미 파일·폴더가 있습니다: ${newRelative}`,
        );
      await inspect(from);
      targets.push({ from, to });
    }
  }
  const completed: typeof targets = [];
  try {
    for (const target of targets) {
      await fs.mkdir(path.dirname(target.to), { recursive: true });
      await fs.rename(target.from, target.to);
      completed.push(target);
    }
  } catch (error) {
    for (const target of completed.reverse()) {
      await fs.mkdir(path.dirname(target.from), { recursive: true });
      await fs.rename(target.to, target.from);
    }
    throw error;
  }
  return async () => {
    for (const target of [...completed].reverse()) {
      await fs.mkdir(path.dirname(target.from), { recursive: true });
      await fs.rename(target.to, target.from);
    }
  };
}

export async function removeEmptyResultParents(
  root: string,
  before: Snapshot,
  after: Snapshot,
) {
  for (const { from } of resultMoves(before, after)) {
    let relative = isResultFolderPath(from)
      ? previewDeletionTarget(from)
      : path.posix.dirname(from);
    while (
      relative.startsWith('output/') &&
      !Object.keys(RESULT_CATEGORIES).some(
        (category) => relative === `output/${category}`,
      )
    ) {
      try {
        await fs.rmdir(await projectPath(root, relative));
      } catch {
        break; /* Empty parent cleanup must not fail an already committed move. */
      }
      relative = path.posix.dirname(relative);
    }
  }
}
