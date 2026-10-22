import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BackupTarget } from '../../application/ports/backup-target.ts';
import { BackupService, stoppedDatabaseBackup } from './backup.ts';
import { MaintenanceGate } from './maintenance.ts';
import { restoreBackup } from './restore.ts';
import { acquireWriter } from './writer-lock.ts';
import { disjoint } from './backup-files.ts';
import { inspectDatabase } from './backup-database.ts';
import { atomicJson } from '../../trash-files.ts';
import { createCollaborationServer } from '../bootstrap.ts';

const marker = (root: string) => path.join(root, '.host-migration.json');
async function readMarker(root: string) {
  return JSON.parse(await fs.readFile(marker(root), 'utf8'));
}
function separate(source: string, destination: string) {
  disjoint(source, destination);
  disjoint(destination, source);
}

/** A stopped source stays frozen after the final backup. Neither host accepts
 * ordinary startup until checks and the explicit activation step finish.
 */
export async function prepareHostMigration(options: {
  source: string;
  destination: string;
  spoolDirectory: string;
  target: BackupTarget;
}) {
  const source = path.resolve(options.source),
    destination = path.resolve(options.destination);
  separate(source, destination);
  const writer = await acquireWriter(source),
    migrationId = randomUUID();
  let service: BackupService | undefined,
    previous: unknown = null,
    marked = false;
  try {
    previous = await fs
      .readFile(marker(source), 'utf8')
      .then(JSON.parse)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (previous && (previous as { state: string }).state !== 'active')
      throw new Error('이미 진행 중인 서버 이전이 있습니다.');
    await atomicJson(marker(source), {
      migrationId,
      state: 'preparing',
      destination,
    });
    marked = true;
    service = new BackupService({
      dataDirectory: source,
      spoolDirectory: options.spoolDirectory,
      target: options.target,
      database: stoppedDatabaseBackup(path.join(source, 'sync.sqlite')),
      gate: new MaintenanceGate(),
      quiesce: async () => undefined,
    });
    const object = await service.run();
    const restored = await restoreBackup(
      path.join(options.spoolDirectory, object.key),
      destination,
      migrationId,
    );
    const record = {
      migrationId,
      state: 'frozen',
      source,
      destination,
      backup: object,
      projects: restored.destination.projects,
      preparedAt: new Date().toISOString(),
    };
    await atomicJson(marker(source), record);
    return record;
  } catch (error) {
    if (marked) {
      if (previous) await atomicJson(marker(source), previous);
      else await fs.unlink(marker(source)).catch(() => undefined);
    }
    throw error;
  } finally {
    await service?.close();
    writer.release();
  }
}

export async function checkHostMigration(
  sourceDirectory: string,
  destinationDirectory: string,
  migrationId: string,
  verifySessions?: (url: string) => Promise<void>,
) {
  const source = path.resolve(sourceDirectory),
    destination = path.resolve(destinationDirectory);
  separate(source, destination);
  const writer = await acquireWriter(source);
  let running:
    | Awaited<ReturnType<typeof createCollaborationServer>>
    | undefined;
  try {
    const from = await readMarker(source),
      to = await readMarker(destination);
    if (
      from.migrationId !== migrationId ||
      from.state !== 'frozen' ||
      from.destination !== destination ||
      to.migrationId !== migrationId ||
      to.state !== 'staged'
    )
      throw new Error('검사할 이전 세대/경로/상태가 다릅니다.');
    running = await createCollaborationServer({
      dataDirectory: destination,
      host: '127.0.0.1',
      port: 0,
      migrationCheckId: migrationId,
    });
    const url = `http://127.0.0.1:${running.port}`;
    const health = (await fetch(url + '/health').then((r) => r.json())) as {
      protocol: number;
    };
    if (health.protocol !== 1)
      throw new Error('이전 서버 protocol 검사가 실패했습니다.');
    await verifySessions?.(url);
    await running.close();
    running = undefined;
    const data = inspectDatabase(path.join(destination, 'sync.sqlite'));
    const report = {
      migrationId,
      checkedAt: new Date().toISOString(),
      protocol: 1,
      sessionsVerified: Boolean(verifySessions),
      projects: data.summaries,
    };
    await atomicJson(path.join(destination, '.migration-check.json'), report);
    return report;
  } finally {
    await running?.close();
    writer.release();
  }
}

/** Activate source-retired first, destination-active second. A partial failure
 * leaves both blocked and can be retried; it never starts two authorities.
 */
export async function activateHostMigration(
  sourceDirectory: string,
  destinationDirectory: string,
  migrationId: string,
  sessionsVerified = false,
) {
  const source = path.resolve(sourceDirectory),
    destination = path.resolve(destinationDirectory);
  separate(source, destination);
  const fromWriter = await acquireWriter(source);
  let toWriter: Awaited<ReturnType<typeof acquireWriter>> | undefined;
  try {
    toWriter = await acquireWriter(destination);
    const from = await readMarker(source),
      to = await readMarker(destination),
      check = JSON.parse(
        await fs.readFile(
          path.join(destination, '.migration-check.json'),
          'utf8',
        ),
      );
    if (
      from.migrationId !== migrationId ||
      !['frozen', 'retired'].includes(from.state) ||
      from.destination !== destination ||
      to.migrationId !== migrationId ||
      to.state !== 'staged' ||
      check.migrationId !== migrationId ||
      !(check.sessionsVerified || sessionsVerified)
    )
      throw new Error(
        '이전 세대 또는 검증 기록을 확인해주세요. 세션/수정/히스토리/권한 검증 후 활성화해야 합니다.',
      );
    const current = inspectDatabase(
      path.join(destination, 'sync.sqlite'),
    ).summaries;
    if (JSON.stringify(current) !== JSON.stringify(check.projects))
      throw new Error('검증 후 대상 데이터가 바뀌었습니다. 다시 검사해주세요.');
    await atomicJson(marker(source), {
      ...from,
      state: 'retired',
      retiredAt: new Date().toISOString(),
    });
    await atomicJson(marker(destination), {
      ...to,
      state: 'active',
      activatedAt: new Date().toISOString(),
    });
    return { migrationId, source: 'retired', destination: 'active' };
  } finally {
    toWriter?.release();
    fromWriter.release();
  }
}

export async function cancelHostMigration(
  sourceDirectory: string,
  destinationDirectory: string,
  migrationId: string,
) {
  const source = path.resolve(sourceDirectory),
    destination = path.resolve(destinationDirectory);
  separate(source, destination);
  const fromWriter = await acquireWriter(source);
  let toWriter: Awaited<ReturnType<typeof acquireWriter>> | undefined;
  try {
    toWriter = await acquireWriter(destination);
    const from = await readMarker(source),
      to = await readMarker(destination);
    if (
      from.migrationId !== migrationId ||
      from.state !== 'frozen' ||
      to.migrationId !== migrationId ||
      to.state !== 'staged'
    )
      throw new Error('활성화된 서버 이전은 이 명령으로 취소할 수 없습니다.');
    await atomicJson(marker(destination), { ...to, state: 'cancelled' });
    await atomicJson(marker(source), {
      ...from,
      state: 'active',
      cancelledAt: new Date().toISOString(),
    });
  } finally {
    toWriter?.release();
    fromWriter.release();
  }
}
