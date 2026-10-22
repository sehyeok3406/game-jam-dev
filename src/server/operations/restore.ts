import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { acquireWriter } from './writer-lock.ts';
import { extractArchive } from './archive.ts';
import { disjoint, fileHash, scanRecoveryFiles, uuid } from './backup-files.ts';
import { inspectDatabase, verifyRecoveryTree } from './backup-database.ts';
import {
  atomicJson,
  statDirectory,
  checkAncestors,
} from '../../trash-files.ts';

/** After original archive hash verification, bind only verified new directories.
 * JSON is updated directly so version 0 backups need not migrate during restore.
 */
export async function rebindLifecycles(directory: string) {
  const data = inspectDatabase(path.join(directory, 'sync.sqlite'));
  const changes: {
    projectId: string;
    before: string | null;
    after: string | null;
  }[] = [];
  const db = new DatabaseSync(path.join(directory, 'sync.sqlite'));
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const project of data.projects) {
      if (!project.lifecycle) continue;
      const lifecycle = project.lifecycle,
        live = path.join(directory, project.id);
      if (!uuid.test(lifecycle.trashId))
        throw new Error('수명 폴더 ID가 올바르지 않습니다.');
      const retained = path.join(
        directory,
        '.project-trash',
        lifecycle.trashId,
        'project',
      );
      const liveId = await statDirectory(live),
        trashId = await statDirectory(retained);
      if (liveId && trashId)
        throw new Error('복원 자료에 원본/휴지통 폴더가 동시에 있습니다.');
      if (lifecycle.status === 'active' && trashId)
        throw new Error('활성 자료의 휴지통 위치가 올바르지 않습니다.');
      if (lifecycle.status === 'trashed' && liveId)
        throw new Error('휴지통 자료의 원본 위치가 올바르지 않습니다.');
      const identity =
        lifecycle.status === 'active'
          ? liveId
          : lifecycle.status === 'trashed' || lifecycle.status === 'purging'
            ? trashId
            : (liveId ?? trashId);
      if (!identity && lifecycle.identity && lifecycle.status !== 'purging')
        throw new Error('보관할 수명 폴더가 누락되었습니다.');
      const row = db
        .prepare('SELECT value FROM projects WHERE id=?')
        .get(project.id)!;
      const value = JSON.parse(String(row.value));
      changes.push({
        projectId: project.id,
        before: lifecycle.identity,
        after: identity,
      });
      value.lifecycle.identity = identity;
      db.prepare('UPDATE projects SET value=? WHERE id=?').run(
        JSON.stringify(value),
        project.id,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
  return changes;
}

export async function restoreBackup(
  archive: string,
  destination: string,
  migrationId?: string,
) {
  const root = path.resolve(destination);
  disjoint(root, archive);
  await checkAncestors(root);
  const existed = await fs.stat(root).catch(() => null);
  if (existed && (await fs.readdir(root)).length)
    throw new Error('복원 대상은 비어 있는 별도 폴더여야 합니다.');
  if (migrationId && !uuid.test(migrationId))
    throw new Error('이전 ID가 올바르지 않습니다.');
  const lease = await acquireWriter(root);
  const marker = path.join(root, '.restore-in-progress.json');
  let stage: string | undefined;
  try {
    const allowed = new Set([
      '.writer.sqlite',
      '.writer.sqlite-journal',
      '.writer.sqlite-wal',
      '.writer.sqlite-shm',
    ]);
    if ((await fs.readdir(root)).some((name) => !allowed.has(name)))
      throw new Error('복원 대상에 다른 자료가 있습니다.');
    await atomicJson(marker, { id: randomUUID(), state: 'verifying' });
    stage = await fs.mkdtemp(path.join(root, '.restore-'));
    const originalArchive = await fileHash(archive);
    const manifest = await extractArchive(archive, stage);
    const afterRead = await fileHash(archive);
    if (
      afterRead.sha256 !== originalArchive.sha256 ||
      afterRead.size !== originalArchive.size
    )
      throw new Error('복원 검사 중 원본 백업이 변경되었습니다.');
    // First preserve proof of the untouched source, then perform destination transforms.
    await atomicJson(marker, {
      backupId: manifest.backupId,
      source: originalArchive,
      state: 'rebinding',
    });
    const transformations = await rebindLifecycles(stage);
    const scanned = await scanRecoveryFiles(stage),
      transformed = inspectDatabase(path.join(stage, 'sync.sqlite'));
    await verifyRecoveryTree(
      stage,
      transformed,
      scanned.files,
      scanned.directories,
    );
    for (const name of await fs.readdir(stage))
      await fs.rename(path.join(stage, name), path.join(root, name));
    await fs.rmdir(stage);
    stage = undefined;
    // Directory identity is unchanged by rename within the same volume, but prove it.
    const final = inspectDatabase(path.join(root, 'sync.sqlite'));
    const finalFiles = await scanRecoveryFiles(root);
    await verifyRecoveryTree(
      root,
      final,
      finalFiles.files,
      finalFiles.directories,
    );
    const report = {
      backupId: manifest.backupId,
      restoredAt: new Date().toISOString(),
      source: {
        archive: originalArchive,
        files: manifest.files,
        projects: manifest.projects,
        tombstones: manifest.tombstones,
      },
      transformations,
      destination: {
        files: finalFiles.files,
        projects: final.summaries,
        tombstones: final.tombstones,
      },
      aiPolicy:
        'Running jobs expire via existing server recovery; queued reservations are preserved.',
    };
    await atomicJson(path.join(root, '.restore-report.json'), report);
    if (migrationId)
      await atomicJson(path.join(root, '.host-migration.json'), {
        migrationId,
        state: 'staged',
        backupId: manifest.backupId,
      });
    await fs.unlink(marker);
    return report;
  } finally {
    // Failed staging and its marker remain inspectable; bootstrap refuses to serve it.
    lease.release();
  }
}
