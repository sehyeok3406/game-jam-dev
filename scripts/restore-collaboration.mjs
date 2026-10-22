import {
  argumentsFor,
  archiveFor,
  archiveOptions,
} from './collaboration-backup-options.mjs';
import { restoreBackup } from '../src/server/operations/restore.ts';

const args = argumentsFor({
  ...archiveOptions,
  destination: { type: 'string' },
});
if (!args.destination)
  throw new Error('--destination에 비어 있는 별도 폴더를 지정해주세요.');
const input = await archiveFor(args);
try {
  const report = await restoreBackup(input.archive, args.destination);
  console.log(
    JSON.stringify(
      {
        backupId: report.backupId,
        restoredAt: report.restoredAt,
        projects: report.destination.projects,
        report: '.restore-report.json',
      },
      null,
      2,
    ),
  );
} finally {
  await input.cleanup();
}
