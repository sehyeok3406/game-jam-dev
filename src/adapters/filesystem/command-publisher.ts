import type { EditHistoryPublisher } from '../../application/editing/edit-history-service.ts';
import type { CommandPublisher } from '../../application/editing/command-service.ts';
import type { LocalProjectRepository } from '../../application/ports/local-project-repository.ts';
import { trashDeletedFiles } from '../../result-deletion.ts';
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
            plan.files,
            effects.trashItem,
          );
        } finally {
          await resume();
        }
        // Removed targets already went to the recycle bin; do not delete them twice.
        await repository.apply(
          plan.before,
          Object.fromEntries(
            Object.entries(plan.changes).filter(([, raw]) => raw !== null),
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
