import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { checkAncestors } from '../../trash-files.ts';

/** OS-owned SQLite writer transaction releases even after abrupt process death.
 * The sidecar contains no project data; never copy it into an archive.
 */
export async function acquireWriter(directory: string) {
  const root = path.resolve(directory);
  await checkAncestors(root);
  await fs.mkdir(root, { recursive: true });
  const filename = path.join(root, '.writer.sqlite');
  await checkAncestors(filename);
  const stat = await fs.lstat(filename).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (stat && (!stat.isFile() || stat.nlink !== 1))
    throw new Error('서버 writer 잠금 파일이 올바르지 않습니다.');
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      'PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS writer_lock(id INTEGER PRIMARY KEY, nonce TEXT NOT NULL); BEGIN IMMEDIATE;',
    );
    db.prepare('INSERT OR REPLACE INTO writer_lock VALUES (1, ?)').run(
      randomUUID(),
    );
  } catch (error) {
    db.close();
    throw new Error(
      '다른 서버 또는 백업/복원 도구가 이 데이터 폴더를 사용 중입니다.',
      { cause: error },
    );
  }
  let released = false;
  return {
    root,
    release() {
      if (released) return;
      try {
        if (db.isTransaction) db.exec('ROLLBACK');
      } finally {
        db.close();
        released = true;
      }
    },
  };
}
