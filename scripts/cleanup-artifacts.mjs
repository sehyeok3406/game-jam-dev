import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyCleanupPlan,
  createCleanupPlan,
  formatBytes,
  renderCleanupPlan,
  safeArtifactPath,
} from './artifact-cleanup.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
try {
  if (
    args.length === 3 &&
    args[0] === '--apply' &&
    args[1] === '--approved-plan' &&
    /^[a-f0-9]{64}$/.test(args[2])
  ) {
    const directory = await safeArtifactPath(root, 'out/artifact-cleanup');
    const file = path.join(directory, `${args[2]}.json`);
    if ((await fs.lstat(file)).isSymbolicLink())
      throw Error('Linked plan file');
    const plan = JSON.parse(await fs.readFile(file, 'utf8'));
    const receipt = await applyCleanupPlan(root, plan, args[2]);
    console.log(`Deleted ${receipt.deleted.length} approved cache folders.`);
  } else if (!args.length || (args.length === 1 && args[0] === '--automatic')) {
    // Reports are the only automatic operation. No automatic deletion hook exists.
    await fs.mkdir(path.join(root, 'out'), { recursive: true });
    await safeArtifactPath(root, 'out');
    const plan = await createCleanupPlan(root);
    await fs.mkdir(path.join(root, 'out/artifact-cleanup'), {
      recursive: true,
    });
    const directory = await safeArtifactPath(root, 'out/artifact-cleanup');
    await fs.writeFile(
      path.join(directory, `${plan.id}.json`),
      JSON.stringify(plan, null, 2),
      { flag: 'wx' },
    );
    await fs.writeFile(
      path.join(directory, `${plan.id}.md`),
      renderCleanupPlan(plan),
      { flag: 'wx' },
    );
    console.log(
      `Cleanup preview: ${plan.candidates.length} cache folders, ${formatBytes(plan.totalBytes)}. Nothing deleted.`,
    );
    console.log(`Review: ${path.join(directory, `${plan.id}.md`)}`);
    console.log(`Plan ID: ${plan.id}`);
  } else {
    throw Error(
      'Usage: npm run artifacts:plan | npm run artifacts:apply -- --approved-plan <reviewed-plan-id>',
    );
  }
} catch (error) {
  console.error(`Artifact cleanup: ${error.message}`);
  // A read-only maintenance report must not invalidate a successful build/release.
  process.exitCode = args.length === 1 && args[0] === '--automatic' ? 0 : 1;
}
