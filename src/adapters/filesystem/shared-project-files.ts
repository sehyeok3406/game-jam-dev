import type {
  SharedProjectFiles,
  ProjectFileEffects,
} from '../../application/ports/shared-project-files.ts';
import { filesystemProjectRepository } from './local-project-repository.ts';
import { ensureProjectLayout } from './project-layout.ts';
import {
  moveResultFiles,
  resultFileBaseline,
  removeEmptyResultParents,
} from '../../result-file-moves.ts';
import { trashDeletedFiles } from '../../result-deletion.ts';

/** Every operation, including rollback, retains this root and never resolves the active workspace. */
export function filesystemSharedProjectFiles(
  root: string,
  effects: ProjectFileEffects,
  assertCurrent: () => void,
): SharedProjectFiles {
  const repository = filesystemProjectRepository(root, assertCurrent);
  return {
    ensure: () => ensureProjectLayout(root, assertCurrent),
    capture: () => repository.capture(),
    apply: (before, changes) => repository.apply(before, changes),
    async move(before, after) {
      assertCurrent();
      const baseline = resultFileBaseline(before, after);
      const resume = await effects.pauseWatcher();
      try {
        const rollback = await moveResultFiles(root, before, after);
        return { baseline, rollback, finish: resume };
      } catch (error) {
        await resume();
        throw error;
      }
    },
    async trash(before, after) {
      assertCurrent();
      const resume = await effects.pauseWatcher();
      try {
        assertCurrent();
        await trashDeletedFiles(root, before, after, async (absolute) => {
          assertCurrent();
          await effects.trashItem(absolute);
        });
      } finally {
        await resume();
      }
    },
    async cleanup(before, after) {
      assertCurrent();
      await removeEmptyResultParents(root, before, after);
    },
  };
}
