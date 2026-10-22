import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BackupObject,
  BackupTarget,
} from '../../application/ports/backup-target.ts';
import { parseBackupKey } from '../../application/ports/backup-target.ts';
import { fileHash } from '../../server/operations/backup-files.ts';
import { acquireWriter } from '../../server/operations/writer-lock.ts';
import { checkAncestors } from '../../trash-files.ts';

export class LocalBackupTarget implements BackupTarget {
  private root: string;
  constructor(directory: string) {
    this.root = path.resolve(directory);
  }
  directory() {
    return this.root;
  }
  private file(object: BackupObject) {
    const p = parseBackupKey(object.key, object.size);
    if (p.sha256 !== object.sha256)
      throw new Error('백업 해시가 이름과 다릅니다.');
    return path.join(this.root, object.key);
  }
  async put(filename: string, object: BackupObject) {
    const actual = await fileHash(filename);
    if (actual.size !== object.size || actual.sha256 !== object.sha256)
      throw new Error('업로드 원본의 해시/크기가 다릅니다.');
    const lease = await acquireWriter(this.root),
      destination = this.file(object),
      temporary = path.join(this.root, `.upload-${randomUUID()}`);
    try {
      if (await fs.lstat(destination).catch(() => null)) {
        const existing = await fileHash(destination);
        if (existing.size !== object.size || existing.sha256 !== object.sha256)
          throw new Error('백업 object가 이미 다른 내용으로 존재합니다.');
        return;
      }
      await fs.copyFile(filename, temporary, fs.constants.COPYFILE_EXCL);
      const copied = await fileHash(temporary);
      if (copied.size !== object.size || copied.sha256 !== object.sha256)
        throw new Error('백업 복사 검증에 실패했습니다.');
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true });
      lease.release();
    }
  }
  async get(object: BackupObject, destination: string) {
    await checkAncestors(destination);
    const actual = await fileHash(this.file(object));
    if (actual.size !== object.size || actual.sha256 !== object.sha256)
      throw new Error('저장소 백업 해시/크기가 다릅니다.');
    await fs.copyFile(
      this.file(object),
      destination,
      fs.constants.COPYFILE_EXCL,
    );
    const copied = await fileHash(destination);
    if (copied.sha256 !== object.sha256 || copied.size !== object.size) {
      await fs.unlink(destination);
      throw new Error('내려받은 백업 검증에 실패했습니다.');
    }
  }
  async list() {
    await checkAncestors(this.root);
    const names = await fs
      .readdir(this.root)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    const result: BackupObject[] = [];
    for (const name of names) {
      if (!name.endsWith('.gjbackup')) continue;
      const object = parseBackupKey(name),
        actual = await fileHash(path.join(this.root, name));
      if (actual.sha256 !== object.sha256)
        throw new Error('저장된 백업의 해시가 다릅니다.');
      result.push({ ...object, size: actual.size });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async remove(object: BackupObject) {
    await fileHash(this.file(object));
    await fs.unlink(this.file(object));
  }
}
