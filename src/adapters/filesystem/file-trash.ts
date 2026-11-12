import fs from 'node:fs/promises';
import type {
  FileTrashBackup,
  FileTrashStore,
} from '../../application/editing/file-trash-service.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { collaborationPath } from '../../collaboration-model.ts';
import { projectPath } from '../../project-store.ts';
import { atomicJson, checkAncestors } from '../../trash-files.ts';

const idPattern = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const idFormat = new RegExp(`^${idPattern}$`);
const fileFormat = new RegExp(`^(\\d{1,16})-(${idPattern})\\.json$`);
const directory = '.gamejam/local/file-trash';
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

function validateSnapshot(value: unknown): value is Snapshot {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([relative, raw]) =>
        collaborationPath(relative) === relative && typeof raw === 'string',
    )
  );
}

export function filesystemFileTrash(root: string): FileTrashStore {
  const storagePath = async (name = '') => {
    await checkAncestors(root);
    const target = await projectPath(
      root,
      name ? `${directory}/${name}` : directory,
      true,
    );
    await checkAncestors(target);
    return target;
  };
  const filename = (item: Pick<FileTrashBackup, 'id' | 'expiresAt'>) =>
    `${item.expiresAt}-${item.id}.json`;
  const entries = async () =>
    (
      await fs
        .readdir(await storagePath(), { withFileTypes: true })
        .catch((error) => {
          if (absent(error)) return [];
          throw error;
        })
    ).filter((entry) => entry.isFile() && fileFormat.test(entry.name));
  const read = async (name: string): Promise<FileTrashBackup> => {
    const item = JSON.parse(await fs.readFile(await storagePath(name), 'utf8'));
    if (
      !item ||
      item.version !== 1 ||
      !Number.isSafeInteger(item.expiresAt) ||
      filename(item) !== name ||
      !Array.isArray(item.files) ||
      !item.files.length ||
      !validateSnapshot(item.before) ||
      !validateSnapshot(item.after) ||
      !validateSnapshot(item.images) ||
      Object.keys(item.images).some(
        (path) => !path.startsWith('assets/images/'),
      ) ||
      item.files.some(
        (file: FileTrashBackup['files'][number]) =>
          !file ||
          typeof file.name !== 'string' ||
          typeof file.path !== 'string' ||
          !Object.hasOwn(item.before, file.path) ||
          Object.hasOwn(item.after, file.path),
      )
    )
      throw Error('파일 휴지통 기록이 손상되었습니다.');
    return item;
  };
  return {
    async list(expiredBy) {
      const result: FileTrashBackup[] = [];
      for (const { name } of await entries()) {
        if (
          expiredBy !== undefined &&
          Number(fileFormat.exec(name)![1]) > expiredBy
        )
          continue;
        result.push(await read(name));
      }
      return result;
    },
    async read(id) {
      if (typeof id !== 'string' || !idFormat.test(id))
        throw Error('파일 휴지통 ID가 올바르지 않습니다.');
      const entry = (await entries()).find(
        ({ name }) => fileFormat.exec(name)![2] === id,
      );
      if (!entry) throw Error('파일 휴지통 항목을 찾을 수 없습니다.');
      return read(entry.name);
    },
    async write(item) {
      const name = filename(item);
      if (!fileFormat.test(name))
        throw Error('파일 휴지통 ID가 올바르지 않습니다.');
      const target = await storagePath(name);
      await checkAncestors(`${target}.tmp`);
      await atomicJson(target, item);
    },
    async remove(item) {
      const name = filename(item);
      if (!fileFormat.test(name))
        throw Error('파일 휴지통 ID가 올바르지 않습니다.');
      await fs.unlink(await storagePath(name)).catch((error) => {
        if (!absent(error)) throw error;
      });
    },
  };
}
