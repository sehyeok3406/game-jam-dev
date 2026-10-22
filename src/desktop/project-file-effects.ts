import type { ProjectFileEffects } from '../application/ports/shared-project-files.ts';

type Watcher = { close(): Promise<unknown> };
type TrackedWatcher = Watcher & {
  on(event: 'all', changed: () => void): unknown;
};
/** Guard the asynchronous close before installing a replacement at the captured root. */
export async function startSessionProjectWatcher(
  root: string | null,
  ports: {
    isCurrent(): boolean;
    watcher(): Watcher | null;
    set(watcher: TrackedWatcher | null): void;
    create(root: string): TrackedWatcher;
    changed(): void;
  },
) {
  if (!ports.isCurrent()) return;
  await ports.watcher()?.close();
  if (!ports.isCurrent()) return;
  ports.set(null);
  if (!root) return;
  const watcher = ports.create(root);
  ports.set(watcher);
  watcher.on('all', () => {
    if (ports.isCurrent()) ports.changed();
  });
}
type Ports = {
  assertCurrent(): void;
  isCurrent(): boolean;
  watcher(): Watcher | null;
  clear(): void;
  restart(): Promise<void>;
  trashItem(absolute: string): Promise<void>;
};
/** A late finalizer may release its old watcher, but cannot clear/restart a new session's watcher. */
export function sessionProjectFileEffects(ports: Ports): ProjectFileEffects {
  return {
    trashItem: async (absolute) => {
      ports.assertCurrent();
      await ports.trashItem(absolute);
    },
    async pauseWatcher() {
      ports.assertCurrent();
      const watcher = ports.watcher();
      if (watcher) {
        await watcher.close();
        ports.assertCurrent();
        if (ports.watcher() === watcher) ports.clear();
      }
      let resumed = false;
      return async () => {
        if (resumed) return;
        resumed = true;
        if (watcher && ports.isCurrent() && !ports.watcher())
          await ports.restart();
      };
    },
  };
}
