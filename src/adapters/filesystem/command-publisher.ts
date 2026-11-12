import type { EditHistoryPublisher } from '../../application/editing/edit-history-service.ts';
import type { CommandPublisher } from '../../application/editing/command-service.ts';
import type { LocalProjectRepository } from '../../application/ports/local-project-repository.ts';
import { trashDeletedFiles } from '../../result-deletion.ts';
import { localMediaFromMarkdown } from './local-media.ts';
import {
  moveResultFiles,
  resultFileBaseline,
  removeEmptyResultParents,
} from '../../result-file-moves.ts';

type FileEffects = {
  pauseWatcher: () => Promise<() => Promise<void>>;
  trashItem: (absolute: string) => Promise<void>;
};
/** Native folder moves/recycle-bin behavior stays outside application/IPC handlers. */
export function filesystemCommandPublisher(
  root: string,
  repository: LocalProjectRepository,
  effects: FileEffects,
): CommandPublisher {
  return {
    publish: async (channel, plan) => {
      const removed = Object.entries(plan.changes)
        .filter(([, value]) => value === null)
        .map(([relative]) => relative);
      const mediaCards = new Set(
        removed.filter(
          (relative) =>
            relative.endsWith('.md') &&
            localMediaFromMarkdown(plan.before[relative]),
        ),
      );
      if (
        channel === 'sections:delete' ||
        (channel === 'canvas:batch' &&
          removed.some((path) => path.startsWith('sections/')) &&
          removed.every(
            (path) =>
              !path.startsWith('output/') && !path.startsWith('.game-builds/'),
          ))
      ) {
        const resume = await effects.pauseWatcher();
        const deleted: string[] = [];
        try {
          const touched = Object.keys(plan.changes);
          const actual = await repository.capture(touched);
          if (
            touched.some(
              (relative) => actual[relative] !== plan.before[relative],
            )
          )
            throw Error('외부 변경을 발견했습니다. 섹션을 다시 확인해주세요.');
          for (const relative of removed.filter(
            (item) => !mediaCards.has(item),
          )) {
            if (
              (await repository.capture([relative]))[relative] !==
              plan.before[relative]
            )
              throw Error(
                '외부 변경을 발견했습니다. 섹션을 다시 확인해주세요.',
              );
            await trashDeletedFiles(
              root,
              { [relative]: plan.before[relative] },
              {},
              effects.trashItem,
            );
            deleted.push(relative);
          }
          await repository.apply(
            plan.before,
            Object.fromEntries(
              Object.entries(plan.changes).filter(
                ([relative, value]) =>
                  value !== null || mediaCards.has(relative),
              ),
            ),
          );
        } catch (error) {
          if (deleted.length)
            await repository.apply(
              {},
              Object.fromEntries(
                deleted.map((relative) => [relative, plan.before[relative]]),
              ),
            );
          throw error;
        } finally {
          await resume();
        }
        return;
      }
      if (channel === 'results:move' || channel === 'results:organize') {
        const resume = await effects.pauseWatcher();
        let rollback: (() => Promise<void>) | undefined;
        try {
          rollback = await moveResultFiles(root, plan.before, plan.files);
          await repository.apply(
            resultFileBaseline(plan.before, plan.files),
            Object.fromEntries(
              Object.keys({ ...plan.before, ...plan.files }).map((key) => [
                key,
                plan.files[key] ?? null,
              ]),
            ),
          );
          await removeEmptyResultParents(root, plan.before, plan.files);
        } catch (error) {
          await rollback?.();
          throw error;
        } finally {
          await resume();
        }
        return;
      }
      if (
        ['documents:delete', 'documents:delete-many', 'canvas:batch'].includes(
          channel,
        )
      ) {
        const resume = await effects.pauseWatcher();
        try {
          await trashDeletedFiles(
            root,
            plan.before,
            {
              ...plan.files,
              ...Object.fromEntries(
                [...mediaCards].map((relative) => [
                  relative,
                  plan.before[relative],
                ]),
              ),
            },
            effects.trashItem,
          );
        } finally {
          await resume();
        }
        // Removed targets already went to the recycle bin; do not delete them twice.
        await repository.apply(
          plan.before,
          Object.fromEntries(
            Object.entries(plan.changes).filter(
              ([relative, raw]) => raw !== null || mediaCards.has(relative),
            ),
          ),
        );
        return;
      }
      await repository.apply(plan.before, plan.changes);
    },
  };
}

/** Preserve result-folder rollback and OS trash ordering for local Undo/Redo. */
export function filesystemHistoryPublisher(
  root: string,
  repository: LocalProjectRepository,
  effects: FileEffects,
): EditHistoryPublisher {
  const suspended = async <T>(action: () => Promise<T>) => {
    const resume = await effects.pauseWatcher();
    try {
      return await action();
    } finally {
      await resume();
    }
  };
  return {
    publish: async (before, after, paths) => {
      const rollback = await suspended(() =>
        moveResultFiles(root, before, after),
      );
      try {
        await repository.apply(
          resultFileBaseline(before, after),
          Object.fromEntries(paths.map((path) => [path, after[path] ?? null])),
        );
      } catch (error) {
        await suspended(rollback);
        throw error;
      }
      await suspended(() =>
        trashDeletedFiles(root, before, after, effects.trashItem),
      );
      await removeEmptyResultParents(root, before, after);
    },
  };
}
