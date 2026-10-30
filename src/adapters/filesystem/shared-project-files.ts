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
import {
  installProjectLayout,
  recoverProjectLayout,
} from './layout-migration.ts';
import { hasModernLayout } from './project-location.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';

/** Every operation, including rollback, retains this root and never resolves the active workspace. */
export function filesystemSharedProjectFiles(
  root: string,
  effects: ProjectFileEffects,
  assertCurrent: () => void,
): SharedProjectFiles {
  const repository = filesystemProjectRepository(root, assertCurrent);
  return {
    ensure: async (snapshot) => {
      await recoverProjectLayout(root, assertCurrent);
      if (
        snapshot &&
        !snapshot[PROJECT_LAYOUT_PATH] &&
        (await hasModernLayout(root))
      )
        throw Error(
          '이 PC의 사본은 새 파일 구조를 사용합니다. 서버의 최신 상태를 확인한 뒤 다시 열어주세요.',
        );
      if (snapshot) await installProjectLayout(root, snapshot, assertCurrent);
      await ensureProjectLayout(root, assertCurrent);
    },
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
