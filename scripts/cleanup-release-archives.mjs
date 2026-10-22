import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeArtifactPath } from './artifact-cleanup.mjs';
import {
  createReleaseArchivePlan,
  renderReleaseArchivePlan,
  applyReleaseArchivePlan,
} from './release-archive-cleanup.mjs';

const root = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
try {
  await fs.mkdir(path.join(root, 'out'), { recursive: true });
  await safeArtifactPath(root, 'out');
  await fs.mkdir(path.join(root, 'out/artifact-cleanup'), { recursive: true });
  const directory = await safeArtifactPath(root, 'out/artifact-cleanup');
  if (!args.length) {
    const plan = await createReleaseArchivePlan(root);
    await fs.writeFile(
      path.join(directory, `release-${plan.id}.json`),
      JSON.stringify(plan, null, 2),
      { flag: 'wx' },
    );
    await fs.writeFile(
      path.join(directory, `release-${plan.id}.md`),
      renderReleaseArchivePlan(plan),
      { flag: 'wx' },
    );
    console.log(
      `Release cleanup preview: ${plan.candidates.length} binaries, ${(plan.totalBytes / 1024 ** 3).toFixed(3)} GiB. Nothing deleted.`,
    );
    console.log(`Deferred: ${plan.deferred.length} version directories.`);
    for (const item of plan.deferred)
      console.log(`${item.tag}: ${item.reason}`);
    console.log(`Review: ${path.join(directory, `release-${plan.id}.md`)}`);
    console.log(`Plan ID: ${plan.id}`);
  } else if (
    args.length === 3 &&
    args[0] === '--apply' &&
    args[1] === '--approved-plan' &&
    /^[a-f0-9]{64}$/.test(args[2])
  ) {
    const file = path.join(directory, `release-${args[2]}.json`);
    if ((await fs.lstat(file)).isSymbolicLink())
      throw Error('Linked release plan');
    const plan = JSON.parse(await fs.readFile(file, 'utf8'));
    const receipt = await applyReleaseArchivePlan(root, plan, args[2]);
    console.log(`Deleted ${receipt.deleted.length} approved release binaries.`);
  } else
    throw Error(
      'Usage: npm run artifacts:release-plan | npm run artifacts:release-apply -- --approved-plan <reviewed-plan-id>',
    );
} catch (error) {
  console.error(`Release archive cleanup: ${error.message}`);
  process.exitCode = 1;
}
