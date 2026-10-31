import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { projectDirectoryName } from '../../core/projects/project-name.ts';
import type {
  SharedWorkspaceEntry,
  SharedWorkspaceRegistry,
} from '../../application/ports/shared-workspace-locations.ts';
import {
  atomicJson,
  checkAncestors,
  moveChecked,
  statDirectory,
} from '../../trash-files.ts';

/** Legacy lookup is read-only. A new name is allocated only by ensure(). */
export function sharedWorkspacePath(
  userData: string,
  entry: SharedWorkspaceEntry,
) {
  if (!/^[a-f0-9-]{36}$/.test(entry.projectId ?? ''))
    throw Error('공동 프로젝트 ID가 올바르지 않습니다.');
  const base = path.resolve(userData, 'shared-workspaces');
  const root = path.resolve(
    entry.sharedRoot ?? path.join(base, entry.projectId!),
  );
  if (path.dirname(root).toLowerCase() !== base.toLowerCase())
    throw Error('공동 사본 경로가 올바르지 않습니다.');
  return root;
}

type Move = {
  version: 1;
  id: string;
  projectId: string;
  source: string;
  target: string;
  identity: string | null;
  staging?: string;
};
/** Moves the whole directory. The registry commit follows rename; the journal resumes either side. */
export class FilesystemSharedWorkspaces {
  private userData: string;
  private registry: SharedWorkspaceRegistry;
  constructor(userData: string, registry: SharedWorkspaceRegistry) {
    this.userData = userData;
    this.registry = registry;
  }
  private journal(id: string) {
    return path.join(
      this.userData,
      'workspace-locations',
      createHash('sha256').update(id).digest('hex') + '.json',
    );
  }
  private owner(root: string) {
    return path.join(root, '.gamejam/local/workspace-location.json');
  }
  private async mark(root: string, entry: SharedWorkspaceEntry) {
    await checkAncestors(this.owner(root));
    await atomicJson(this.owner(root), {
      version: 1,
      id: entry.id,
      projectId: entry.projectId,
      serverUrl: entry.serverUrl,
    });
  }
  private async owned(root: string, entry: SharedWorkspaceEntry) {
    await checkAncestors(this.owner(root));
    const owner = await fs
      .readFile(this.owner(root), 'utf8')
      .then(JSON.parse)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    return (
      owner?.projectId === entry.projectId &&
      (owner.id === entry.id ||
        (!!entry.serverUrl && owner.serverUrl === entry.serverUrl))
    );
  }
  async recover(
    id: string,
    finalize?: (from: string, to: string) => Promise<void>,
  ) {
    const entry = this.registry.get(id);
    const record: Move | null = await fs
      .readFile(this.journal(id), 'utf8')
      .then(JSON.parse)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (!record) return;
    if (!finalize)
      throw Error(
        '공유 사본 폴더 이전을 먼저 복구해주세요. 홈에서 폴더 이름 정리를 다시 실행해주세요.',
      );
    if (
      record.version !== 1 ||
      record.id !== id ||
      record.projectId !== entry.projectId ||
      typeof record.identity !== 'string' ||
      !record.identity ||
      record.source === record.target
    )
      throw Error('공유 폴더 이전 기록이 올바르지 않습니다.');
    sharedWorkspacePath(this.userData, { ...entry, sharedRoot: record.source });
    sharedWorkspacePath(this.userData, { ...entry, sharedRoot: record.target });
    if (record.staging) {
      sharedWorkspacePath(this.userData, {
        ...entry,
        sharedRoot: record.staging,
      });
      if (
        record.staging.toLowerCase() === record.source.toLowerCase() ||
        record.staging.toLowerCase() === record.target.toLowerCase()
      )
        throw Error('공유 폴더 이전 중간 경로가 올바르지 않습니다.');
      await checkAncestors(record.target);
      const finished =
        (await fs.readdir(path.dirname(record.target))).includes(
          path.basename(record.target),
        ) && (await statDirectory(record.target)) === record.identity;
      if (!finished) {
        await moveChecked(record.source, record.staging, record.identity);
        await moveChecked(record.staging, record.target, record.identity);
      }
    } else await moveChecked(record.source, record.target, record.identity);
    await finalize(record.source, record.target);
    await this.registry.setRoot(id, record.target);
    await fs.unlink(this.journal(id));
  }
  async ensure(id: string) {
    await this.recover(id);
    const entry = this.registry.get(id);
    const existing = sharedWorkspacePath(this.userData, entry);
    await checkAncestors(existing);
    if (entry.sharedRoot || (await statDirectory(existing))) {
      await fs.mkdir(existing, { recursive: true });
      await this.registry.setRoot(id, existing);
      return existing;
    }
    this.registry.assertName(entry.name, entry.id);
    const target = path.join(
      path.dirname(existing),
      projectDirectoryName(entry.name),
    );
    await checkAncestors(target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await this.owned(target, entry)))
        throw Error(
          '같은 이름의 폴더가 이미 있습니다. 이름을 바꾼 뒤 다시 시도해주세요.',
        );
    }
    await this.mark(target, entry);
    await this.registry.setRoot(id, target);
    return target;
  }
  async rename(
    id: string,
    finalize: (from: string, to: string) => Promise<void>,
  ) {
    await this.recover(id, finalize);
    const entry = this.registry.get(id);
    this.registry.assertName(entry.name, entry.id);
    const source = sharedWorkspacePath(this.userData, entry);
    await checkAncestors(source);
    const target = path.join(
      path.dirname(source),
      projectDirectoryName(entry.name),
    );
    if (source === target) return target;
    await checkAncestors(target);
    const caseOnly = source.toLowerCase() === target.toLowerCase();
    if (
      !caseOnly &&
      (await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      }))
    )
      throw Error('같은 이름의 폴더가 이미 있습니다. 덮어쓰지 않았습니다.');
    const identity = await statDirectory(source);
    if (!identity) return this.ensure(id);
    await this.mark(source, entry);
    await atomicJson(this.journal(id), {
      version: 1,
      id,
      projectId: entry.projectId!,
      source,
      target,
      identity,
      ...(caseOnly
        ? {
            staging: path.join(
              path.dirname(source),
              '.gamejam-move-' + randomUUID(),
            ),
          }
        : {}),
    } satisfies Move);
    await this.recover(id, finalize);
    return target;
  }
}
