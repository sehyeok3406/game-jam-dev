import {
  argumentsFor,
  archiveFor,
  archiveOptions,
} from './collaboration-backup-options.mjs';
import { verifyArchive } from '../src/server/operations/archive.ts';

const args = argumentsFor(archiveOptions),
  input = await archiveFor(args);
try {
  const verified = await verifyArchive(input.archive);
  console.log(
    JSON.stringify(
      {
        backupId: verified.manifest.backupId,
        size: verified.size,
        sha256: verified.sha256,
        projects: verified.manifest.projects,
        schemaVersion: verified.manifest.schemaVersion,
        protocolVersion: verified.manifest.protocolVersion,
      },
      null,
      2,
    ),
  );
} finally {
  await input.cleanup();
}
