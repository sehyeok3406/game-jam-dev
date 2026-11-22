import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HistoryEntry } from '../../contracts/history.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { isDrawingPath } from '../../core/editing/drawing-path.ts';
import {
  applyChanges,
  projectPath,
  ProjectRollbackError,
  publishHistory,
  readHistoryEntry,
  readHistorySnapshots,
  readProjectValue,
  replaceProjectValue,
  stageHistory,
} from '../../project-store.ts';
import { replaceFileWithRetry } from './atomic-replace.ts';

const pendingPath = (root: string) =>
  projectPath(root, '.gamejam/local/edit-batch.json', true);
type Pending = { version: 1; entry: HistoryEntry };

function checkEntry(entry: HistoryEntry) {
  if (
    !entry ||
    typeof entry.id !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(entry.id) ||
    entry.kind !== 'user' ||
    entry.status !== 'completed' ||
    !Array.isArray(entry.files) ||
    !entry.files.length ||
    entry.files.some((file) => {
      const relative = file?.relativePath;
      return (
        typeof relative !== 'string' ||
        relative
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        relative.includes('\\') ||
        !(
          isDrawingPath(relative) ||
          relative === 'project.md' ||
          /^(ideas|docs|sections|\.ai\/tasks)\/.+\.md$/.test(relative)
        ) ||
        typeof file.before !== 'boolean' ||
        typeof file.after !== 'boolean' ||
        (!file.before && !file.after)
      );
    })
  )
    throw Error('편집 저장 복구 자료가 올바르지 않습니다. 파일을 보존합니다.');
}

async function readPending(filename: string) {
  const raw = await fs
    .readFile(filename, 'utf8')
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
  if (raw === undefined) return;
  const pending = JSON.parse(raw) as Pending;
  if (pending?.version !== 1)
    throw Error('편집 저장 복구 형식을 확인해주세요.');
  checkEntry(pending.entry);
  return pending.entry;
}

async function removeAbortedPublication(
  root: string,
  filename: string,
  entry: HistoryEntry,
) {
  const folder = await projectPath(root, `.history/${entry.id}`);
  if (path.dirname(folder) !== (await projectPath(root, '.history')))
    throw Error('편집 저장 복구 경로를 확인해주세요.');
  // Original rollback has finished. A crash during scratch cleanup needs no recovery.
  await fs.rm(filename, { force: true });
  await fs.rm(folder, { recursive: true, force: true });
}

export async function recoverLocalEditPublication(
  root: string,
  check = () => {},
) {
  const filename = await pendingPath(root);
  const entry = await readPending(filename);
  if (!entry) return;
  const { before, after } = await readHistorySnapshots(root, entry);
  const observed = await Promise.all(
    entry.files.map(async ({ relativePath }) => ({
      path: relativePath,
      value: await readProjectValue(root, relativePath),
    })),
  );
  check();
  if (
    (await readHistoryEntry(root, entry.id)) ||
    observed.every(({ path, value }) => value === after[path])
  ) {
    await publishHistory(root, before, after, entry);
    await fs.rm(filename, { force: true });
    return;
  }
  for (const { path, value } of observed) {
    if (value === after[path] && value !== before[path])
      await replaceProjectValue(
        root,
        path,
        value,
        before[path] ?? null,
        check,
        true,
      );
  }
  check();
  await removeAbortedPublication(root, filename, entry);
}

/** Stage the existing history snapshots before the first original is touched. */
export async function prepareLocalEditPublication(
  root: string,
  before: Snapshot,
  after: Snapshot,
  meta: Omit<HistoryEntry, 'files'>,
  check: () => void,
) {
  await recoverLocalEditPublication(root, check);
  check();
  const entry = await stageHistory(root, before, after, meta, true);
  checkEntry(entry);
  const filename = await pendingPath(root);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(filename), { recursive: true });
  try {
    await fs.writeFile(
      temporary,
      JSON.stringify({ version: 1, entry } satisfies Pending),
      { flag: 'wx', flush: true },
    );
    await replaceFileWithRetry(temporary, filename, async () => {
      check();
      if (await readPending(filename))
        throw Error('완료되지 않은 편집 저장이 있습니다.');
    });
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return {
    async apply() {
      const changes = Object.fromEntries(
        entry.files.map(({ relativePath }) => [
          relativePath,
          after[relativePath] ?? null,
        ]),
      );
      try {
        await applyChanges(
          root,
          before,
          changes,
          () => {
            check();
            return false;
          },
          true,
        );
      } catch (error) {
        check();
        if (!(error instanceof ProjectRollbackError))
          await removeAbortedPublication(root, filename, entry);
        throw error;
      }
    },
    async finish() {
      check();
      await publishHistory(root, before, after, entry);
      await fs.rm(filename, { force: true });
    },
  };
}
