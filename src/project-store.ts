import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HistoryEntry } from './shared';
import { isPreviewPath } from './preview-output.ts';
import { isAssetPath, encodeAsset, decodeAsset } from './file-assets.ts';
import {
  advanceAuthorship,
  rebuildAuthorship,
  resolveAuthorship,
} from './file-authorship.ts';
import type { FileAuthorshipMap } from './shared';
import { isImportedPreviewPath } from './preview-output.ts';
import { taskHistoryRecord, withTaskHistory } from './ai-task-history.ts';
import { historyTaskPath } from './ai-task-records.ts';

export type Snapshot = Record<string, string>;

async function readSnapshotFile(absolute: string, relative: string) {
  return isAssetPath(relative)
    ? encodeAsset(relative, await fs.readFile(absolute))
    : fs.readFile(absolute, 'utf8');
}
function snapshotBytes(relative: string, content: string) {
  return isAssetPath(relative) ? decodeAsset(relative, content) : content;
}

export async function projectPath(root: string, relativePath: string) {
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    path.isAbsolute(relativePath)
  )
    throw new Error('올바르지 않은 프로젝트 경로입니다.');
  const realRoot = await fs.realpath(root);
  const target = path.resolve(realRoot, relativePath);
  const isInside = (candidate: string) => {
    const relative = path.relative(realRoot, candidate);
    return (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  if (!isInside(target)) throw new Error('프로젝트 밖에는 접근할 수 없습니다.');
  let ancestor = target;
  for (;;) {
    try {
      if (!isInside(await fs.realpath(ancestor)))
        throw new Error('외부 심볼릭 링크는 허용되지 않습니다.');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  return target;
}

export async function captureProject(root: string): Promise<Snapshot> {
  const snapshot: Snapshot = {};
  const walk = async (relative: string) => {
    const absolute = await projectPath(root, relative);
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error(`심볼릭 링크는 작업에 포함할 수 없습니다: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(absolute))
        await walk(`${relative}/${entry}`);
    } else if (
      relative.endsWith('.md') ||
      isPreviewPath(relative) ||
      isAssetPath(relative)
    ) {
      snapshot[relative] = await readSnapshotFile(absolute, relative);
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
  ])
    await walk(relative);
  return snapshot;
}

export async function materialize(root: string, snapshot: Snapshot) {
  for (const [relative, content] of Object.entries(snapshot)) {
    const absolute = await projectPath(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, snapshotBytes(relative, content), 'utf8');
  }
}

function validateId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error('올바르지 않은 기록 ID입니다.');
}

export async function saveHistory(
  root: string,
  before: Snapshot,
  after: Snapshot,
  meta: Omit<HistoryEntry, 'files'>,
) {
  validateId(meta.id);
  const files = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((relative) => before[relative] !== after[relative])
    .map((relativePath) => ({
      relativePath,
      before: before[relativePath] !== undefined,
      after: after[relativePath] !== undefined,
    }));
  const entry = withTaskHistory({ ...meta, files }, before, after);
  const folder = await projectPath(root, `.history/${entry.id}`);
  await fs.mkdir(folder, { recursive: true });
  for (const version of ['before', 'after'] as const) {
    const snapshot = version === 'before' ? before : after;
    const selected: Snapshot = {};
    for (const file of files)
      if (snapshot[file.relativePath] !== undefined)
        selected[file.relativePath] = snapshot[file.relativePath];
    const versionRoot = path.join(folder, version);
    await fs.mkdir(versionRoot, { recursive: true });
    await materialize(versionRoot, selected);
  }
  await writeHistoryEntry(root, entry);
  if (entry.status === 'completed' && files.length) {
    const ledger = advanceAuthorship(
      await localAuthorshipMap(root),
      before,
      after,
      entry,
    );
    await writeLocalAuthorshipMap(root, ledger);
  }
  return entry;
}

async function writeLocalAuthorshipMap(
  root: string,
  ledger: FileAuthorshipMap,
) {
  const absolute = await projectPath(root, '.canvas/authorship.json');
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      temporary,
      JSON.stringify({ version: 1, files: ledger }, null, 2),
    );
    await fs.rename(temporary, absolute);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function localAuthorshipMap(root: string): Promise<FileAuthorshipMap> {
  try {
    const stored = JSON.parse(
      await fs.readFile(
        await projectPath(root, '.canvas/authorship.json'),
        'utf8',
      ),
    );
    if (
      stored.version === 1 &&
      stored.files &&
      typeof stored.files === 'object' &&
      !Array.isArray(stored.files)
    )
      return stored.files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const records = [];
  for (const entry of (await listHistory(root)).reverse()) {
    if (entry.status !== 'completed') continue;
    const before: Snapshot = {},
      after: Snapshot = {};
    for (const file of entry.files) {
      const left = file.before
        ? await readSnapshotFile(
            await projectPath(
              root,
              `.history/${entry.id}/before/${file.relativePath}`,
            ),
            file.relativePath,
          )
        : null;
      const right = file.after
        ? await readSnapshotFile(
            await projectPath(
              root,
              `.history/${entry.id}/after/${file.relativePath}`,
            ),
            file.relativePath,
          )
        : null;
      if (left !== null) before[file.relativePath] = left;
      if (right !== null) after[file.relativePath] = right;
    }
    records.push({ entry, before, after });
  }
  const ledger = rebuildAuthorship(records);
  await writeLocalAuthorshipMap(root, ledger);
  return ledger;
}

export async function localFileAuthorship(root: string, relative: string) {
  const content = await readSnapshotFile(
    await projectPath(root, relative),
    relative,
  );
  return resolveAuthorship(await localAuthorshipMap(root), relative, content);
}

async function writeHistoryEntry(root: string, entry: HistoryEntry) {
  validateId(entry.id);
  const absolute = await projectPath(root, `.history/${entry.id}/entry.json`);
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(entry, null, 2));
    await fs.rename(temporary, absolute);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function recoverInterruptedHistory(root: string) {
  for (const entry of await listHistory(root)) {
    if (!['starting', 'running', 'validating'].includes(entry.status)) continue;
    let message = '앱 종료로 작업이 중단되었습니다. 기존 결과를 유지합니다.';
    if (entry.status === 'validating' && entry.files.length) {
      try {
        const current = await captureProject(root);
        const rollback: Record<string, string | null> = {};
        for (const file of entry.files) {
          const before = await readHistoryFile(
            root,
            entry.id,
            file.relativePath,
            'before',
          );
          const after = await readHistoryFile(
            root,
            entry.id,
            file.relativePath,
            'after',
          );
          const actual = current[file.relativePath] ?? null;
          if (actual !== before && actual !== after)
            throw new Error(
              `외부 변경 때문에 자동 복원을 보류합니다: ${file.relativePath}`,
            );
          if (actual === after) rollback[file.relativePath] = before;
        }
        await applyChanges(root, current, rollback);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
    }
    await writeHistoryEntry(root, {
      ...entry,
      status: 'failed',
      error: message,
      finishedAt: Date.now(),
    });
  }
}

export function historyId() {
  return `${Date.now()}-${randomUUID()}`;
}

export async function listHistory(root: string): Promise<HistoryEntry[]> {
  const folder = await projectPath(root, '.history');
  let ids: string[];
  try {
    ids = await fs.readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries: HistoryEntry[] = [];
  for (const id of ids) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
    try {
      let entry = JSON.parse(
        await fs.readFile(
          await projectPath(root, `.history/${id}/entry.json`),
          'utf8',
        ),
      ) as HistoryEntry;
      const taskPath = historyTaskPath(entry);
      if (!entry.aiTask && taskPath) {
        for (const version of ['input', 'after', 'before']) {
          try {
            const raw = await fs.readFile(
              await projectPath(root, `.history/${id}/${version}/${taskPath}`),
              'utf8',
            );
            const aiTask = taskHistoryRecord(raw);
            if (aiTask) {
              entry = { ...entry, aiTask };
              break;
            }
          } catch {
            /* Old histories do not always include the task snapshot. */
          }
        }
        if (!entry.aiTask) {
          try {
            const aiTask = taskHistoryRecord(
              await fs.readFile(await projectPath(root, taskPath), 'utf8'),
              'legacy',
            );
            if (aiTask) entry = { ...entry, aiTask };
          } catch {
            /* Deleted old task files remain ordinary readable history. */
          }
        }
      }
      entries.push(entry);
    } catch {
      /* Ignore incomplete entries left by an interrupted write. */
    }
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export async function readHistoryFile(
  root: string,
  id: string,
  relative: string,
  version: 'before' | 'after',
) {
  validateId(id);
  if (version !== 'before' && version !== 'after')
    throw new Error('올바르지 않은 버전입니다.');
  const entry = (await listHistory(root)).find((item) => item.id === id);
  const file = entry?.files.find((item) => item.relativePath === relative);
  if (!file) throw new Error('기록에 없는 파일입니다.');
  if (!file[version]) return null;
  return readSnapshotFile(
    await projectPath(root, `.history/${id}/${version}/${relative}`),
    relative,
  );
}

export async function applyChanges(
  root: string,
  baseline: Snapshot,
  changes: Record<string, string | null>,
  shouldCancel = () => false,
) {
  // Check every target before writing, and restore already-written targets if a write fails.
  for (const relative of Object.keys(changes)) {
    const absolute = await projectPath(root, relative);
    let current: string | undefined;
    try {
      current = await readSnapshotFile(absolute, relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (current !== baseline[relative])
      throw new Error(
        `외부 변경을 발견했습니다. 덮어쓰기를 보류합니다: ${relative}`,
      );
  }
  const written: string[] = [];
  try {
    for (const [relative, content] of Object.entries(changes)) {
      if (shouldCancel()) throw new Error('결과 반영을 중지했습니다.');
      const absolute = await projectPath(root, relative);
      if (content === null) await fs.rm(absolute, { force: true });
      else {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        const temporary = `${absolute}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(
            temporary,
            snapshotBytes(relative, content),
            'utf8',
          );
          await fs.rename(temporary, absolute);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
      written.push(relative);
    }
  } catch (error) {
    for (const relative of written.reverse()) {
      const absolute = await projectPath(root, relative);
      if (baseline[relative] === undefined)
        await fs.rm(absolute, { force: true });
      else
        await fs.writeFile(
          absolute,
          snapshotBytes(relative, baseline[relative]),
          'utf8',
        );
    }
    throw error;
  }
}

export async function restoreHistory(
  root: string,
  id: string,
  relative?: string,
  requestedVersion?: 'before' | 'after',
) {
  if (
    requestedVersion !== undefined &&
    requestedVersion !== 'before' &&
    requestedVersion !== 'after'
  )
    throw new Error('올바르지 않은 복원 버전입니다.');
  const entry = (await listHistory(root)).find((item) => item.id === id);
  if (!entry || entry.status !== 'completed')
    throw new Error('완료된 기록만 복원할 수 있습니다.');
  if (relative?.startsWith('sections/'))
    throw new Error('섹션은 연결된 파일과 함께 전체 기록으로 복원해주세요.');
  if (relative && entry.files.some((file) => isAssetPath(file.relativePath)))
    throw new Error(
      '이미지가 포함된 기록은 설명 문서와 원본 파일을 함께 전체 기록으로 복원해주세요.',
    );
  if (
    relative &&
    entry.files.some((file) => isImportedPreviewPath(file.relativePath))
  )
    throw new Error(
      '불러온 HTML이 포함된 기록은 관리 문서와 함께 전체 기록으로 복원해주세요.',
    );
  const files = relative
    ? entry.files.filter((item) => item.relativePath === relative)
    : entry.files;
  if (!files.length) throw new Error('복원할 파일이 없습니다.');
  const before = await captureProject(root);
  const changes: Record<string, string | null> = {};
  const restoreBefore = entry.files.some((file) => !file.after);
  for (const file of files) {
    // For a deletion, restore the last content. For other changes restore the selected version.
    const version = requestedVersion ?? (restoreBefore ? 'before' : 'after');
    changes[file.relativePath] = await readHistoryFile(
      root,
      id,
      file.relativePath,
      version,
    );
  }
  await applyChanges(root, before, changes);
  await saveHistory(root, before, await captureProject(root), {
    id: historyId(),
    label: `${entry.label} 버전 복원`,
    kind: 'restore',
    status: 'completed',
    createdAt: Date.now(),
    finishedAt: Date.now(),
  });
}
