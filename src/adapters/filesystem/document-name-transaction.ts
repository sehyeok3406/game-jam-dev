import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from '../../markdown.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { applyChanges, projectPath } from '../../project-store.ts';
import { fileNameKey } from '../../core/documents/file-name.ts';
import { readFileNames } from '../../core/documents/name-registry.ts';
import { isAssetPath, encodeAsset, decodeAsset } from '../../file-assets.ts';

const JOURNAL = '.gamejam/local/document-names/pending.json';
type Journal = {
  version: 1;
  before: Snapshot;
  changes: Record<string, string | null>;
};
const read = async (filename: string) =>
  fs.readFile(filename, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
async function readProjectValue(root: string, relative: string) {
  const absolute = await projectPath(root, relative);
  if (!isAssetPath(relative)) return read(absolute);
  try {
    return encodeAsset(relative, await fs.readFile(absolute));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
function moves(before: Snapshot, changes: Record<string, string | null>) {
  const after = { ...before };
  for (const [p, raw] of Object.entries(changes)) {
    if (raw === null) delete after[p];
    else after[p] = raw;
  }
  const oldEntries = readFileNames(before).entries;
  const entries = readFileNames(after).entries;
  const html = [
    ...entries,
    ...oldEntries.filter((e) => !entries.some((next) => next.id === e.id)),
  ]
    .filter((e) => e.kind === 'html')
    .flatMap((e) => {
      const from =
        oldEntries.find((old) => old.id === e.id)?.path ?? e.originalPath;
      const to =
        entries.find((next) => next.id === e.id)?.path ?? e.originalPath;
      return from !== to &&
        changes[from] === null &&
        typeof changes[to] === 'string'
        ? [{ from, to }]
        : [];
    });
  return [
    ...html,
    ...Object.keys(changes)
      .filter(
        (from) =>
          changes[from] === null &&
          from.endsWith('.md') &&
          before[from] !== undefined,
      )
      .flatMap((from) => {
        const id = matter(before[from]).data.id ?? from;
        return Object.keys(changes)
          .filter(
            (to) =>
              to !== from &&
              before[to] === undefined &&
              typeof changes[to] === 'string' &&
              to.endsWith('.md') &&
              matter(changes[to]!).data.id === id,
          )
          .map((to) => ({ from, to }));
      }),
  ];
}

/** Roll back only known transaction bytes. An outside edit leaves the journal for explicit recovery. */
async function rollback(root: string, journal: Journal, check: () => void) {
  const paths = Object.keys(journal.changes);
  for (const relative of paths) {
    check();
    const current = await readProjectValue(root, relative);
    const related = paths.filter(
      (p) => fileNameKey(p) === fileNameKey(relative),
    );
    const allowed = related.flatMap((p) => [
      journal.before[p],
      journal.changes[p] ?? undefined,
    ]);
    if (!allowed.includes(current))
      throw Error(
        `이름 변경 복구 중 외부 변경을 발견했습니다. 복구 자료를 보존합니다: ${relative}`,
      );
  }
  for (const relative of paths.filter((p) => journal.before[p] === undefined)) {
    check();
    await fs.rm(await projectPath(root, relative), { force: true });
  }
  for (const [relative, raw] of Object.entries(journal.before)) {
    check();
    const filename = await projectPath(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.name-recovery-${randomUUID()}.tmp`;
    try {
      await fs.writeFile(
        temporary,
        isAssetPath(relative) ? decodeAsset(relative, raw) : raw,
        {
          encoding: 'utf8',
          flag: 'wx',
          flush: true,
        },
      );
      await fs.rename(temporary, filename);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}

export async function recoverDocumentNames(root: string, check = () => {}) {
  const filename = await projectPath(root, JOURNAL, true);
  const raw = await read(filename);
  if (raw === undefined) return;
  const journal = JSON.parse(raw) as Journal;
  if (
    journal.version !== 1 ||
    !journal.before ||
    !journal.changes ||
    Object.values(journal.before).some((v) => typeof v !== 'string') ||
    Object.values(journal.changes).some(
      (v) => v !== null && typeof v !== 'string',
    ) ||
    Object.keys(journal.before).some((p) => !Object.hasOwn(journal.changes, p))
  )
    throw Error(
      '문서 이름 변경 복구 자료가 올바르지 않습니다. 자료를 보존합니다.',
    );
  await rollback(root, journal, check);
  check();
  await fs.rm(filename);
}

/** Reuse the project publisher with durable recovery for MD moves, including Undo/Redo. */
export async function applyDocumentNames(
  root: string,
  before: Snapshot,
  changes: Record<string, string | null>,
  check: () => void,
  cancelled?: () => boolean,
) {
  const renamed = moves(before, changes);
  if (!renamed.length)
    return applyChanges(root, before, changes, () => {
      check();
      return cancelled?.() ?? false;
    });
  const filename = await projectPath(root, JOURNAL, true);
  if ((await read(filename)) !== undefined)
    throw Error(
      '완료되지 않은 이름 변경이 있습니다. 프로젝트를 다시 열어 복구해주세요.',
    );
  const caseMoves = renamed.filter(
    (m) => fileNameKey(m.from) === fileNameKey(m.to),
  );
  const runCheck = () => {
    check();
    if (cancelled?.()) throw Error('이름 변경을 중지했습니다.');
  };
  for (const relative of Object.keys(changes)) {
    runCheck();
    const current = await readProjectValue(root, relative);
    const previous = caseMoves.find((m) => m.to === relative);
    if (
      current !== before[relative] &&
      (!previous || current !== before[previous.from])
    )
      throw Error(
        `외부 변경을 발견했습니다. 이름 변경을 보류합니다: ${relative}`,
      );
  }
  const journal: Journal = {
    version: 1,
    before: Object.fromEntries(
      Object.keys(changes)
        .filter((p) => before[p] !== undefined)
        .map((p) => [p, before[p]]),
    ),
    changes,
  };
  await fs.mkdir(path.dirname(filename), { recursive: true });
  runCheck();
  await fs.writeFile(filename, JSON.stringify(journal), {
    encoding: 'utf8',
    flag: 'wx',
    flush: true,
  });
  try {
    const baseline = { ...before },
      effective = { ...changes };
    for (const move of caseMoves) {
      runCheck();
      await fs.rm(await projectPath(root, move.from));
      delete baseline[move.from];
      delete baseline[move.to];
      delete effective[move.from];
    }
    await applyChanges(root, baseline, effective, () => {
      runCheck();
      return false;
    });
    runCheck();
    await fs.rm(filename);
  } catch (error) {
    // Session cancellation must not write through a newly selected project's services.
    check();
    await rollback(root, journal, check);
    await fs.rm(filename);
    throw error;
  }
}
