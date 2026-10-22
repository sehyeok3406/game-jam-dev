import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { LocalBackupTarget } from '../src/adapters/backup/local-target.ts';
import { backupEnvironment } from '../src/server/operations/backup-config.ts';
import { parseBackupKey } from '../src/application/ports/backup-target.ts';
import { disjoint } from '../src/server/operations/backup-files.ts';

export function argumentsFor(options) {
  return parseArgs({ options, allowPositionals: false }).values;
}
export function targetFor(args, dataDirectory) {
  if (args['target-dir']) {
    if (dataDirectory) {
      disjoint(dataDirectory, args['target-dir']);
      disjoint(args['target-dir'], dataDirectory);
    }
    return new LocalBackupTarget(args['target-dir']);
  }
  const configured = backupEnvironment(
    dataDirectory ?? path.resolve('collaboration-data'),
  );
  if (!configured)
    throw new Error(
      '--target-dir(로컬 검사) 또는 GAMEJAM_BACKUP_S3_* 환경 설정이 필요합니다.',
    );
  return configured.target;
}
export async function archiveFor(args) {
  if (Boolean(args.archive) === Boolean(args.key))
    throw new Error('--archive 또는 --key 중 하나를 지정해주세요.');
  if (args.archive)
    return {
      archive: path.resolve(args.archive),
      cleanup: async () => undefined,
    };
  const target = targetFor(args),
    selected = (await target.list()).find(
      (object) => object.key === parseBackupKey(args.key).key,
    );
  if (!selected) throw new Error('선택한 백업이 저장소에 없습니다.');
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-backup-download-'),
  );
  const archive = path.join(directory, selected.key);
  try {
    await target.get(selected, archive);
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    target.close?.();
  }
  return {
    archive,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}
export const archiveOptions = {
  archive: { type: 'string' },
  key: { type: 'string' },
  'target-dir': { type: 'string' },
};
