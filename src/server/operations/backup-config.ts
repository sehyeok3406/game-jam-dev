import path from 'node:path';
import { S3BackupTarget } from '../../adapters/backup/s3-target.ts';
import type { BackupTarget } from '../../application/ports/backup-target.ts';

export type ScheduledBackup = {
  target: BackupTarget;
  spoolDirectory: string;
  intervalMs?: number;
  retention?: number;
  localRetention?: number;
  waitMs?: number;
};
export function backupEnvironment(
  dataDirectory: string,
  env = process.env,
): ScheduledBackup | undefined {
  const names = [
    'GAMEJAM_BACKUP_S3_ENDPOINT',
    'GAMEJAM_BACKUP_S3_BUCKET',
    'GAMEJAM_BACKUP_S3_REGION',
    'GAMEJAM_BACKUP_S3_ACCESS_KEY_ID',
    'GAMEJAM_BACKUP_S3_SECRET_ACCESS_KEY',
  ];
  if (!names.some((name) => env[name])) return undefined;
  if (names.some((name) => !env[name]))
    throw new Error('백업 S3 환경 설정을 모두 입력해야 합니다.');
  const hours = Number(env.GAMEJAM_BACKUP_INTERVAL_HOURS ?? 24),
    retention = Number(env.GAMEJAM_BACKUP_RETAIN ?? 7),
    localRetention = Number(env.GAMEJAM_BACKUP_LOCAL_RETAIN ?? 2);
  if (!Number.isFinite(hours) || hours < 1 / 60 || hours > 24 * 365)
    throw new Error('백업 간격이 올바르지 않습니다.');
  return {
    target: new S3BackupTarget({
      endpoint: env[names[0]]!,
      bucket: env[names[1]]!,
      region: env[names[2]]!,
      accessKeyId: env[names[3]]!,
      secretAccessKey: env[names[4]]!,
      prefix: env.GAMEJAM_BACKUP_S3_PREFIX,
      sessionToken: env.GAMEJAM_BACKUP_S3_SESSION_TOKEN,
    }),
    spoolDirectory:
      env.GAMEJAM_BACKUP_SPOOL ??
      path.join(
        path.dirname(path.resolve(dataDirectory)),
        path.basename(dataDirectory) + '-backups',
      ),
    intervalMs: hours * 3600000,
    retention,
    localRetention,
  };
}
