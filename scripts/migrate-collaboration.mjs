import fs from 'node:fs/promises';
import { archiveFor } from './collaboration-backup-options.mjs';
import {
  freezeHostForTransfer,
  stageTransferredHost,
  checkTransferredHost,
  activateTransferredHost,
} from '../src/server/operations/transfer-host.ts';
import { argumentsFor, targetFor } from './collaboration-backup-options.mjs';
import {
  prepareHostMigration,
  checkHostMigration,
  activateHostMigration,
  cancelHostMigration,
} from '../src/server/operations/migrate-host.ts';

const args = argumentsFor({
  source: { type: 'string' },
  destination: { type: 'string' },
  spool: { type: 'string' },
  'target-dir': { type: 'string' },
  action: { type: 'string' },
  id: { type: 'string' },
  'verified-sessions': { type: 'boolean' },
  'source-frozen': { type: 'boolean' },
  handoff: { type: 'string' },
  archive: { type: 'string' },
  key: { type: 'string' },
});
if (args.action === 'freeze') {
  if (!args.source || !args.spool)
    throw new Error('--source와 --spool을 지정해주세요.');
  const target = targetFor(args, args.source);
  try {
    console.log(
      JSON.stringify(
        await freezeHostForTransfer({
          source: args.source,
          spoolDirectory: args.spool,
          target,
        }),
        null,
        2,
      ),
    );
  } finally {
    target.close?.();
  }
} else if (args.action === 'stage') {
  if (!args.destination || !args.handoff)
    throw new Error('--destination과 --handoff를 지정해주세요.');
  const input = await archiveFor(args);
  try {
    const report = await stageTransferredHost(
      input.archive,
      args.destination,
      JSON.parse(await fs.readFile(args.handoff, 'utf8')),
    );
    console.log(
      JSON.stringify(
        { backupId: report.backupId, destination: 'staged' },
        null,
        2,
      ),
    );
  } finally {
    await input.cleanup();
  }
} else if (args.action === 'check-transfer') {
  if (!args.destination || !args.id)
    throw new Error('--destination과 --id를 지정해주세요.');
  console.log(
    JSON.stringify(
      await checkTransferredHost(args.destination, args.id),
      null,
      2,
    ),
  );
} else if (args.action === 'activate-transfer') {
  if (!args.destination || !args.id)
    throw new Error('--destination과 --id를 지정해주세요.');
  console.log(
    JSON.stringify(
      await activateTransferredHost(args.destination, args.id, {
        sourceFrozen: Boolean(args['source-frozen']),
        sessionsVerified: Boolean(args['verified-sessions']),
      }),
      null,
      2,
    ),
  );
} else {
  if (!args.source || !args.destination)
    throw new Error('--source와 --destination을 지정해주세요.');
  if (args.action === 'prepare') {
    if (!args.spool) throw new Error('--spool을 지정해주세요.');
    const target = targetFor(args, args.source);
    try {
      console.log(
        JSON.stringify(
          await prepareHostMigration({
            source: args.source,
            destination: args.destination,
            spoolDirectory: args.spool,
            target,
          }),
          null,
          2,
        ),
      );
    } finally {
      target.close?.();
    }
  } else {
    if (!args.id) throw new Error('--id에 이전 ID를 지정해주세요.');
    if (args.action === 'check')
      console.log(
        JSON.stringify(
          await checkHostMigration(args.source, args.destination, args.id),
          null,
          2,
        ),
      );
    else if (args.action === 'activate')
      console.log(
        JSON.stringify(
          await activateHostMigration(
            args.source,
            args.destination,
            args.id,
            args['verified-sessions'],
          ),
          null,
          2,
        ),
      );
    else if (args.action === 'cancel')
      await cancelHostMigration(args.source, args.destination, args.id);
    else
      throw new Error(
        '--action은 prepare/check/activate/cancel 중 하나입니다.',
      );
  }
}
