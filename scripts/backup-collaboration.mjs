import path from 'node:path';
import fs from 'node:fs/promises';
import { argumentsFor, targetFor } from './collaboration-backup-options.mjs';
import { acquireWriter } from '../src/server/operations/writer-lock.ts';
import {
  BackupService,
  stoppedDatabaseBackup,
} from '../src/server/operations/backup.ts';
import { MaintenanceGate } from '../src/server/operations/maintenance.ts';

const args = argumentsFor({
  data: { type: 'string' },
  spool: { type: 'string' },
  'target-dir': { type: 'string' },
  retain: { type: 'string' },
});
if (!args.data || !args.spool)
  throw new Error(
    '--data와 --spool을 지정해주세요. 서버를 먼저 중지해야 합니다.',
  );
await fs.access(path.join(args.data, 'sync.sqlite'));
const writer = await acquireWriter(args.data),
  target = targetFor(args, args.data);
let service;
try {
  for (const marker of ['.restore-in-progress.json', '.host-migration.json']) {
    const value = await fs
      .readFile(path.join(args.data, marker), 'utf8')
      .catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (
      value &&
      (marker !== '.host-migration.json' ||
        JSON.parse(value).state !== 'active')
    )
      throw new Error('복원/이전 중인 폴더입니다. 해당 절차를 완료해주세요.');
  }
  service = new BackupService({
    dataDirectory: args.data,
    spoolDirectory: args.spool,
    target,
    retention: args.retain ? Number(args.retain) : 7,
    database: stoppedDatabaseBackup(path.join(args.data, 'sync.sqlite')),
    gate: new MaintenanceGate(),
    quiesce: async () => undefined,
  });
  console.log(JSON.stringify(await service.run(), null, 2));
} finally {
  await service?.close();
  target.close?.();
  writer.release();
}
