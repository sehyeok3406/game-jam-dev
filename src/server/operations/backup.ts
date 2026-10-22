import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import packageInfo from '../../../package.json' with { type: 'json' };
import type {
  BackupTarget,
  BackupObject,
} from '../../application/ports/backup-target.ts';
import { backupKey } from '../../application/ports/backup-target.ts';
import {
  scanRecoveryFiles,
  disjoint,
  diskSpace,
  fileHash,
  regularFile,
  BackupLimits,
  removeTemporary,
} from './backup-files.ts';
import {
  inspectDatabase,
  verifyRecoveryTree,
  verifySourceLifecycles,
} from './backup-database.ts';
import { writeArchive, verifyArchive, type BackupManifest } from './archive.ts';
import { MaintenanceGate } from './maintenance.ts';
import { atomicJson, checkAncestors } from '../../trash-files.ts';
import { LocalBackupTarget } from '../../adapters/backup/local-target.ts';
import { acquireWriter } from './writer-lock.ts';

export type BackupOptions = {
  dataDirectory: string;
  spoolDirectory: string;
  target: BackupTarget;
  database: { backup: (destination: string) => Promise<void> };
  gate: MaintenanceGate;
  quiesce: () => Promise<void>;
  waitMs?: number;
  retention?: number;
  localRetention?: number;
};
export type BackupStatus = {
  phase: 'idle' | 'snapshot' | 'archive' | 'upload' | 'complete' | 'failed';
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  backup?: BackupObject;
  error?: string;
};
export function stoppedDatabaseBackup(filename: string) {
  return {
    async backup(destination: string) {
      await regularFile(filename);
      const db = new DatabaseSync(filename, { readOnly: true });
      try {
        await sqliteBackup(db, destination);
      } finally {
        db.close();
      }
    },
  };
}
/** Snapshot freezes server writes only while capturing one generation. Hashing,
 * archive verification, remote upload and retention run after writes resume.
 */
export class BackupService {
  private options: BackupOptions;
  private pending?: Promise<BackupObject>;
  private stopping = false;
  private status: BackupStatus = { phase: 'idle' };
  constructor(options: BackupOptions) {
    this.options = options;
    for (const count of [options.retention ?? 7, options.localRetention ?? 2])
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000)
        throw new Error('백업 보관 개수가 올바르지 않습니다.');
    if (
      !Number.isFinite(options.waitMs ?? 15000) ||
      (options.waitMs ?? 15000) < 1
    )
      throw new Error('백업 대기 한도가 올바르지 않습니다.');
    disjoint(options.dataDirectory, options.spoolDirectory);
    disjoint(options.spoolDirectory, options.dataDirectory);
    if (options.target instanceof LocalBackupTarget) {
      for (const base of [options.dataDirectory, options.spoolDirectory]) {
        disjoint(base, options.target.directory());
        disjoint(options.target.directory(), base);
      }
    }
  }
  current() {
    return structuredClone(this.status);
  }
  run() {
    if (this.stopping)
      return Promise.reject(
        new Error('서버 종료 중에는 백업을 시작할 수 없습니다.'),
      );
    if (this.pending) return this.pending;
    const work = this.perform();
    this.pending = work;
    void work
      .finally(() => {
        if (this.pending === work) this.pending = undefined;
      })
      .catch(() => undefined);
    return work;
  }
  async close() {
    this.stopping = true;
    await this.pending?.catch(() => undefined);
  }
  private async record(status: Partial<BackupStatus>) {
    this.status = { ...this.status, ...status };
    await atomicJson(
      path.join(this.options.spoolDirectory, 'backup-status.json'),
      this.status,
    );
  }
  private async perform(): Promise<BackupObject> {
    const o = this.options,
      backupId = randomUUID(),
      createdAt = new Date().toISOString();
    await checkAncestors(o.spoolDirectory);
    await fs.mkdir(o.spoolDirectory, { recursive: true, mode: 0o700 });
    const spoolWriter = await acquireWriter(o.spoolDirectory);
    let workspace: string | undefined;
    try {
      workspace = await fs.mkdtemp(path.join(o.spoolDirectory, '.snapshot-'));
      const payload = path.join(workspace, 'payload');
      await fs.mkdir(payload, { mode: 0o700 });
      const temporary = path.join(workspace, 'archive.partial');
      try {
        await this.record({
          phase: 'snapshot',
          lastAttemptAt: createdAt,
          error: undefined,
        });
        const manifest = await o.gate.snapshot(
          o.quiesce,
          async (): Promise<BackupManifest> => {
            const dbSize = (
              await regularFile(path.join(o.dataDirectory, 'sync.sqlite'))
            ).size;
            const walSize =
              (
                await fs
                  .stat(path.join(o.dataDirectory, 'sync.sqlite-wal'))
                  .catch(() => null)
              )?.size ?? 0;
            await diskSpace(
              o.spoolDirectory,
              (dbSize + walSize) * 3 + BackupLimits.manifestBytes,
            );
            await o.database.backup(path.join(payload, 'sync.sqlite'));
            const data = inspectDatabase(path.join(payload, 'sync.sqlite'));
            await verifySourceLifecycles(o.dataDirectory, data);
            const source = await scanRecoveryFiles(
              o.dataDirectory,
              false,
              new Set(data.tombstones.map(([id]) => id)),
            );
            const expected = source.files.reduce(
              (n, f) => n + f.size,
              dbSize + walSize,
            );
            if (expected > BackupLimits.archiveBytes)
              throw new Error('초기 백업 크기 한도 4GiB를 초과했습니다.');
            await diskSpace(
              o.spoolDirectory,
              expected * 3 + BackupLimits.manifestBytes,
            );
            for (const directory of source.directories)
              await fs.mkdir(path.join(payload, ...directory.split('/')), {
                recursive: true,
                mode: 0o700,
              });
            for (const file of source.files) {
              const from = path.join(o.dataDirectory, ...file.path.split('/')),
                to = path.join(payload, ...file.path.split('/'));
              await regularFile(from);
              await fs.mkdir(path.dirname(to), { recursive: true });
              await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
              await fs.chmod(to, 0o600);
              const actual = await fileHash(to);
              if (actual.size !== file.size || actual.sha256 !== file.sha256)
                throw new Error('백업 세대의 파일이 변경되었습니다.');
            }
            const files = [
              {
                path: 'sync.sqlite',
                ...(await fileHash(path.join(payload, 'sync.sqlite'))),
              },
              ...source.files,
            ].sort((a, b) => a.path.localeCompare(b.path));
            await verifyRecoveryTree(payload, data, files, source.directories);
            return {
              format: 1,
              backupId,
              createdAt,
              appVersion: packageInfo.version,
              schemaVersion: data.schemaVersion,
              protocolVersion: 1,
              projects: data.summaries,
              tombstones: data.tombstones,
              files,
              directories: source.directories,
            };
          },
          o.waitMs,
        );
        await this.record({ phase: 'archive' });
        await writeArchive(payload, temporary, manifest);
        const verified = await verifyArchive(temporary, workspace);
        const object: BackupObject = {
          backupId,
          createdAt,
          size: verified.size,
          sha256: verified.sha256,
          key: backupKey(backupId, createdAt, verified.sha256),
        };
        const archive = path.join(o.spoolDirectory, object.key);
        await fs.rename(temporary, archive);
        // Local copies remain bounded even when remote storage is unavailable.
        const local = new LocalBackupTarget(o.spoolDirectory);
        for (const old of (await local.list())
          .filter((item) => item.key !== object.key)
          .slice((o.localRetention ?? 2) - 1))
          await local.remove(old);
        await this.record({ phase: 'upload', backup: object });
        await o.target.put(archive, object);
        const remote = await o.target.list();
        if (
          !remote.some(
            (item) =>
              item.key === object.key &&
              item.sha256 === object.sha256 &&
              item.size === object.size,
          )
        )
          throw new Error(
            '업로드된 백업을 저장소 목록에서 확인하지 못했습니다.',
          );
        for (const old of remote
          .filter((item) => item.key !== object.key)
          .slice((o.retention ?? 7) - 1))
          await o.target.remove(old);
        await this.record({
          phase: 'complete',
          lastSuccessAt: new Date().toISOString(),
          error: undefined,
        });
        return object;
      } catch (error) {
        await this.record({
          phase: 'failed',
          error: `BACKUP_${this.status.phase.toUpperCase()}_FAILED`,
        }).catch(() => undefined);
        throw error;
      }
    } finally {
      try {
        if (workspace) await removeTemporary(o.spoolDirectory, workspace);
      } finally {
        spoolWriter.release();
      }
    }
  }
}
