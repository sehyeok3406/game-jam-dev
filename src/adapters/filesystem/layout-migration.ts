import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Snapshot } from '../../contracts/project.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import {
  physicalProjectPath,
  readProjectLayout,
} from '../../core/projects/project-layout.ts';
import {
  captureProject,
  projectPath,
  applyChanges,
} from '../../project-store.ts';
import { checkSnapshot } from '../../collaboration-model.ts';
import { hasModernLayout } from './project-location.ts';

const JOURNAL = '.gamejam/local/migrations/pending.json';
type Journal = {
  version: 1;
  before: Snapshot;
  after: Snapshot;
  files: { from: string; to: string; hash: string }[];
};
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const atomic = async (filename: string, bytes: string | Uint8Array) => {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flush: true });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
};

/** A durable, forward-recoverable physical relocation. Sources survive until the marker commits. */
export async function installProjectLayout(
  root: string,
  target: Snapshot,
  assertCurrent = () => {},
) {
  assertCurrent();
  if (!readProjectLayout(target)) return;
  const journalPath = await projectPath(root, JOURNAL, true);
  let journal: Journal | null = null;
  try {
    journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!journal) {
    if (await hasModernLayout(root)) return;
    const before = await captureProject(root);
    const files: Journal['files'] = [];
    const walk = async (relative: string) => {
      const source = await projectPath(root, relative, true);
      const stat = await fs
        .lstat(source)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      if (!stat) return;
      if (stat.isSymbolicLink())
        throw Error(
          `파일 구조 정리에서 링크를 처리할 수 없습니다: ${relative}`,
        );
      if (stat.isDirectory()) {
        for (const item of await fs.readdir(source))
          await walk(`${relative}/${item}`);
      } else {
        const to = physicalProjectPath(relative, true);
        if (to !== relative)
          files.push({
            from: relative,
            to,
            hash: digest(await fs.readFile(source)),
          });
      }
    };
    for (const relative of [
      '.canvas',
      'sections',
      '.ai/tasks',
      '.history',
      'docs/html-sources',
      'docs/text-sources',
      'server-cache.json',
      '.sync-blobs',
    ])
      await walk(relative);
    journal = { version: 1, before, after: target, files };
    assertCurrent();
    await atomic(journalPath, JSON.stringify(journal));
  }
  if (journal.version !== 1 || !Array.isArray(journal.files))
    throw Error('파일 구조 이전 기록을 확인해주세요.');
  checkSnapshot(journal.before);
  checkSnapshot(journal.after);
  if (!readProjectLayout(journal.after))
    throw Error('파일 구조 이전 대상이 올바르지 않습니다.');
  const committed = await hasModernLayout(root);
  if (!committed) {
    for (const file of journal.files) {
      assertCurrent();
      if (
        file.from.includes('..') ||
        file.from.includes('\\') ||
        file.to !== physicalProjectPath(file.from, true) ||
        file.to === file.from ||
        !/^[a-f0-9]{64}$/.test(file.hash)
      )
        throw Error('파일 구조 이전 경로가 올바르지 않습니다.');
      const source = await projectPath(root, file.from, true);
      const destination = await projectPath(root, file.to, true);
      const bytes = await fs.readFile(source);
      if (digest(bytes) !== file.hash)
        throw Error(`외부 변경으로 파일 구조 정리를 보류합니다: ${file.from}`);
      const existing = await fs
        .readFile(destination)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      const planned = journal.after[file.from];
      if (
        existing &&
        digest(existing) !== file.hash &&
        (planned === undefined || existing.toString('utf8') !== planned)
      )
        throw Error(`새 저장 위치에 다른 파일이 있습니다: ${file.to}`);
      if (!existing) await atomic(destination, bytes);
    }
    // New internal snapshots are ready before switching the physical path resolver.
    for (const [relative, raw] of Object.entries(journal.after)) {
      if (
        relative === PROJECT_LAYOUT_PATH ||
        physicalProjectPath(relative, true) === relative
      )
        continue;
      assertCurrent();
      const destination = await projectPath(
        root,
        physicalProjectPath(relative, true),
        true,
      );
      await atomic(destination, raw);
    }
    const current = await captureProject(root);
    const changes: Record<string, string | null> = {};
    for (const relative of new Set([
      ...Object.keys(journal.before),
      ...Object.keys(journal.after),
    ])) {
      if (
        relative === PROJECT_LAYOUT_PATH ||
        physicalProjectPath(relative, true) !== relative
      )
        continue;
      const actual = current[relative],
        before = journal.before[relative],
        after = journal.after[relative];
      if (actual !== before && actual !== after)
        throw Error(`외부 변경으로 파일 구조 정리를 보류합니다: ${relative}`);
      if (actual !== after) changes[relative] = after ?? null;
    }
    await applyChanges(root, current, changes, () => {
      assertCurrent();
      return false;
    });
    // Recheck legacy sources immediately before committing; a failed check leaves a recoverable journal.
    for (const file of journal.files) {
      if (
        digest(await fs.readFile(await projectPath(root, file.from, true))) !==
        file.hash
      )
        throw Error(`파일 구조 정리 중 파일이 변경되었습니다: ${file.from}`);
      const destination = await fs.readFile(
        await projectPath(root, file.to, true),
      );
      const expected = journal.after[file.from];
      if (
        expected === undefined
          ? digest(destination) !== file.hash
          : destination.toString('utf8') !== expected
      )
        throw Error(`새 저장 위치의 파일 검증에 실패했습니다: ${file.to}`);
    }
    assertCurrent();
    await atomic(
      await projectPath(
        root,
        physicalProjectPath(PROJECT_LAYOUT_PATH, true),
        true,
      ),
      journal.after[PROJECT_LAYOUT_PATH],
    );
  }
  // Only remove exact verified source files. Unknown and externally modified files survive.
  for (const file of journal.files) {
    assertCurrent();
    const source = await projectPath(root, file.from, true);
    const bytes = await fs
      .readFile(source)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (bytes && digest(bytes) === file.hash) await fs.unlink(source);
  }
  const clean = async (relative: string) => {
    const absolute = await projectPath(root, relative, true);
    const entries = await fs
      .readdir(absolute, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries)
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await clean(`${relative}/${entry.name}`);
    await fs.rmdir(absolute).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code ?? ''))
        throw error;
    });
  };
  for (const relative of [
    'ideas',
    'sections',
    '.ai',
    '.canvas',
    '.history',
    '.sync-blobs',
    'docs/imported',
    'docs/ui',
    'docs/html-sources',
    'docs/text-sources',
    'docs/versions',
  ])
    await clean(relative);
  await atomic(
    await projectPath(root, '.gamejam/local/migrations/completed.json', true),
    JSON.stringify({ ...journal, version: 2, finishedAt: Date.now() }),
  );
  await fs.unlink(journalPath);
}

export async function recoverProjectLayout(
  root: string,
  assertCurrent = () => {},
) {
  const filename = await projectPath(root, JOURNAL, true);
  const journal = await fs
    .readFile(filename, 'utf8')
    .then((raw) => JSON.parse(raw) as Journal)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (journal) await installProjectLayout(root, journal.after, assertCurrent);
}
