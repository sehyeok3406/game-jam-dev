import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BackupTarget,
  BackupObject,
} from '../../application/ports/backup-target.ts';
import { BackupService, stoppedDatabaseBackup } from './backup.ts';
import { MaintenanceGate } from './maintenance.ts';
import { acquireWriter } from './writer-lock.ts';
import { restoreBackup } from './restore.ts';
import { verifyArchive } from './archive.ts';
import { inspectDatabase, type ProjectSummary } from './backup-database.ts';
import { atomicJson } from '../../trash-files.ts';
import { uuid } from './backup-files.ts';
import { createCollaborationServer } from '../bootstrap.ts';

export type HostHandoff = {
  format: 1;
  migrationId: string;
  sourceFrozen: true;
  backup: BackupObject;
  projects: ProjectSummary[];
};
/** Cross-host transfer has no shared filesystem. Freeze the old authority first;
 * carry the verified object digest in a separate operator-owned handoff record.
 */
export async function freezeHostForTransfer(options: {
  source: string;
  spoolDirectory: string;
  target: BackupTarget;
}) {
  const root = path.resolve(options.source),
    writer = await acquireWriter(root),
    migrationId = randomUUID();
  const marker = path.join(root, '.host-migration.json');
  let previous: { state: string } | null = null,
    marked = false,
    service: BackupService | undefined;
  try {
    previous = await fs
      .readFile(marker, 'utf8')
      .then(JSON.parse)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (previous && previous.state !== 'active')
      throw new Error('이미 진행 중인 이전이 있습니다.');
    await atomicJson(marker, {
      migrationId,
      state: 'preparing',
      transfer: true,
    });
    marked = true;
    service = new BackupService({
      dataDirectory: root,
      spoolDirectory: options.spoolDirectory,
      target: options.target,
      database: stoppedDatabaseBackup(path.join(root, 'sync.sqlite')),
      gate: new MaintenanceGate(),
      quiesce: async () => {},
    });
    const backup = await service.run(),
      verified = await verifyArchive(
        path.join(options.spoolDirectory, backup.key),
      );
    const handoff: HostHandoff = {
      format: 1,
      migrationId,
      sourceFrozen: true,
      backup,
      projects: verified.manifest.projects,
    };
    await atomicJson(marker, {
      ...handoff,
      state: 'frozen',
      transfer: true,
      frozenAt: new Date().toISOString(),
    });
    const filename = path.join(
      options.spoolDirectory,
      `handoff-${migrationId}.json`,
    );
    await atomicJson(filename, handoff);
    return { handoff, filename };
  } catch (error) {
    if (marked) {
      if (previous) await atomicJson(marker, previous);
      else await fs.unlink(marker).catch(() => undefined);
    }
    throw error;
  } finally {
    await service?.close();
    writer.release();
  }
}
export async function stageTransferredHost(
  archive: string,
  destination: string,
  handoff: HostHandoff,
) {
  if (
    !handoff ||
    handoff.format !== 1 ||
    !uuid.test(handoff.migrationId) ||
    handoff.sourceFrozen !== true
  )
    throw new Error('서버 이전 인계 기록이 올바르지 않습니다.');
  const verified = await verifyArchive(archive);
  if (
    verified.sha256 !== handoff.backup.sha256 ||
    verified.size !== handoff.backup.size ||
    verified.manifest.backupId !== handoff.backup.backupId ||
    JSON.stringify(verified.manifest.projects) !==
      JSON.stringify(handoff.projects)
  )
    throw new Error('인계 기록과 백업 지문이 다릅니다.');
  const report = await restoreBackup(archive, destination, handoff.migrationId);
  const writer = await acquireWriter(destination);
  try {
    await atomicJson(
      path.join(destination, '.migration-transfer.json'),
      handoff,
    );
  } finally {
    writer.release();
  }
  return report;
}
export async function checkTransferredHost(
  destination: string,
  migrationId: string,
  verifySessions?: (url: string) => Promise<void>,
) {
  const handoff: HostHandoff = JSON.parse(
    await fs.readFile(
      path.join(destination, '.migration-transfer.json'),
      'utf8',
    ),
  );
  if (handoff.migrationId !== migrationId)
    throw new Error('검사할 이전 ID가 다릅니다.');
  const running = await createCollaborationServer({
    dataDirectory: destination,
    host: '127.0.0.1',
    port: 0,
    migrationCheckId: migrationId,
  });
  let closed = false;
  try {
    const url = `http://127.0.0.1:${running.port}`,
      response = await fetch(url + '/health', {
        signal: AbortSignal.timeout(12000),
      });
    if (
      !response.ok ||
      ((await response.json()) as { protocol: number }).protocol !== 1
    )
      throw new Error('이전 서버 protocol 확인에 실패했습니다.');
    await verifySessions?.(url);
    closed = true;
    await running.close();
    const report = {
      migrationId,
      checkedAt: new Date().toISOString(),
      sourceArchiveSha256: handoff.backup.sha256,
      sessionsVerified: Boolean(verifySessions),
      projects: inspectDatabase(path.join(destination, 'sync.sqlite'))
        .summaries,
    };
    const writer = await acquireWriter(destination);
    try {
      await atomicJson(path.join(destination, '.migration-check.json'), report);
    } finally {
      writer.release();
    }
    return report;
  } finally {
    if (!closed) await running.close();
  }
}
export async function activateTransferredHost(
  destination: string,
  migrationId: string,
  confirmations: { sourceFrozen: boolean; sessionsVerified: boolean },
) {
  const writer = await acquireWriter(destination);
  try {
    const marker = JSON.parse(
      await fs.readFile(path.join(destination, '.host-migration.json'), 'utf8'),
    );
    const handoff: HostHandoff = JSON.parse(
      await fs.readFile(
        path.join(destination, '.migration-transfer.json'),
        'utf8',
      ),
    );
    const check = JSON.parse(
      await fs.readFile(
        path.join(destination, '.migration-check.json'),
        'utf8',
      ),
    );
    if (
      marker.state !== 'staged' ||
      marker.migrationId !== migrationId ||
      handoff.migrationId !== migrationId ||
      check.migrationId !== migrationId ||
      check.sourceArchiveSha256 !== handoff.backup.sha256 ||
      !confirmations.sourceFrozen ||
      !(check.sessionsVerified || confirmations.sessionsVerified)
    )
      throw new Error(
        '원본 동결과 세션/수정/권한 검증을 확인한 뒤 활성화해주세요.',
      );
    if (
      JSON.stringify(
        inspectDatabase(path.join(destination, 'sync.sqlite')).summaries,
      ) !== JSON.stringify(check.projects)
    )
      throw new Error('검증 후 대상 자료가 바뀌었습니다.');
    await atomicJson(path.join(destination, '.host-migration.json'), {
      ...marker,
      state: 'active',
      activatedAt: new Date().toISOString(),
      sourceArchiveSha256: handoff.backup.sha256,
    });
    return { migrationId, destination: 'active', source: 'must-remain-frozen' };
  } finally {
    writer.release();
  }
}
