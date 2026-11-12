import {
  TRASH_RETENTION,
  type FileTrashEntry,
} from '../../contracts/file-trash.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { LocalProjectRepository } from '../ports/local-project-repository.ts';
import { localHistoryInverse } from './edit-history-service.ts';
import { snapshotChanges } from './command-service.ts';

export type FileTrashBackup = Omit<
  FileTrashEntry,
  'projectId' | 'projectName'
> & {
  version: 1;
  before: Snapshot;
  after: Snapshot;
  images: Snapshot;
};

export interface FileTrashStore {
  list(expiredBy?: number): Promise<FileTrashBackup[]>;
  read(id: string): Promise<FileTrashBackup>;
  write(backup: FileTrashBackup): Promise<void>;
  remove(backup: FileTrashBackup): Promise<void>;
}

export class FileTrashService {
  private readonly store: FileTrashStore;
  private readonly repository: Pick<
    LocalProjectRepository,
    'capture' | 'apply'
  >;
  private readonly environment: { now: () => number; id: () => string };
  constructor(
    store: FileTrashStore,
    repository: Pick<LocalProjectRepository, 'capture' | 'apply'>,
    environment: { now: () => number; id: () => string },
  ) {
    this.store = store;
    this.repository = repository;
    this.environment = environment;
  }

  async move(
    before: Snapshot,
    after: Snapshot,
    files: FileTrashBackup['files'],
    images: Snapshot,
  ) {
    const changes = snapshotChanges(before, after);
    const paths = Object.keys(changes);
    const pick = (snapshot: Snapshot) =>
      Object.fromEntries(
        paths.flatMap((path) =>
          snapshot[path] === undefined ? [] : [[path, snapshot[path]]],
        ),
      );
    const backup: FileTrashBackup = {
      version: 1,
      id: this.environment.id(),
      expiresAt: this.environment.now() + TRASH_RETENTION,
      files,
      images,
      before: pick(before),
      after: pick(after),
    };
    // Persist recovery bytes before touching the project. A failed apply that
    // rolls back leaves a hidden record, which expires with the others.
    await this.store.write(backup);
    await this.repository.apply(before, changes);
  }

  async list(project: { id: string; name: string }): Promise<FileTrashEntry[]> {
    const backups = (await this.store.list()).filter(
      (item) => item.expiresAt > this.environment.now(),
    );
    if (!backups.length) return [];
    const current = await this.repository
      .capture()
      .catch(() => ({}) as Snapshot);
    return backups.flatMap(({ id, expiresAt, files, before, after }) =>
      Object.keys(before)
        .filter((path) => after[path] === undefined)
        .every((path) => current[path] === before[path])
        ? []
        : [
            {
              id,
              expiresAt,
              files,
              projectId: project.id,
              projectName: project.name,
            },
          ],
    );
  }

  async restore(id: string) {
    const backup = await this.store.read(id);
    if (backup.expiresAt <= this.environment.now())
      throw Error('파일 보관 기간이 지났습니다.');
    const current = await this.repository.capture();
    const before = { ...backup.before },
      after = { ...backup.after };
    for (const [path, image] of Object.entries(backup.images)) {
      if (current[path] !== undefined && current[path] !== image)
        throw Error(`이미지 원본 경로에 다른 파일이 있습니다: ${path}`);
      if (current[path] === undefined) before[path] = image;
    }
    // A prior Undo, interrupted write, or retry may already have restored some paths.
    for (const path of Object.keys({ ...before, ...after }))
      if (current[path] === before[path]) {
        delete before[path];
        delete after[path];
      }
    if (Object.keys({ ...before, ...after }).length) {
      const next = localHistoryInverse(current, before, after, 'undo');
      await this.repository.apply(current, snapshotChanges(current, next));
    }
    await this.store.remove(backup);
  }

  async purge(id: string, confirmed: boolean) {
    if (confirmed !== true)
      throw Error('파일을 휴지통에서 제거할지 확인해주세요.');
    await this.store.remove(await this.store.read(id));
  }

  async maintain() {
    for (const backup of await this.store.list(this.environment.now()))
      await this.store.remove(backup);
  }
}
