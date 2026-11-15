import type { ProjectFileEffects } from '../application/ports/shared-project-files.ts';
import type { Snapshot } from '../contracts/project.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import matter from '../markdown.ts';

const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Recognize watcher echoes of confirmed layout writes by their on-disk contents. */
export function documentLayoutWrites() {
  let session: string | undefined;
  const recent = new Map<string, { digest: string; expires: number }>();
  return {
    record(
      sessionId: string,
      before: Snapshot,
      after: Snapshot,
      paths = Object.keys(before).filter(
        (path) => before[path] !== after[path],
      ),
    ): string[] | null {
      const withoutLayout = (raw: string) => {
        const { data, content } = matter(raw);
        const {
          x: _x,
          y: _y,
          width: _width,
          height: _height,
          ...metadata
        } = data;
        return JSON.stringify([content, metadata]);
      };
      try {
        if (
          paths.some(
            (path) =>
              !/^(?:project\.md$|(?:ideas|docs)\/.+\.md$)/.test(path) ||
              path.startsWith('docs/html-sources/') ||
              path.startsWith('docs/text-sources/') ||
              before[path] === undefined ||
              after[path] === undefined ||
              withoutLayout(before[path]) !== withoutLayout(after[path]),
          )
        )
          return null;
      } catch {
        return null;
      }
      if (session !== sessionId || recent.size > 1000) recent.clear();
      session = sessionId;
      const expires = Date.now() + 5000;
      for (const path of paths)
        recent.set(path, { digest: digest(after[path]), expires });
      return paths;
    },
    async matches(sessionId: string, relative: string, absolute: string) {
      const write = session === sessionId ? recent.get(relative) : undefined;
      if (!write || write.expires <= Date.now()) return false;
      const actual = await readFile(absolute, 'utf8').catch(() => null);
      return (
        actual !== null &&
        session === sessionId &&
        recent.get(relative) === write &&
        digest(actual) === write.digest
      );
    },
  };
}

type Watcher = { close(): Promise<unknown> };
type TrackedWatcher = Watcher & {
  on(event: 'all', changed: (event: string, path: string) => void): unknown;
};
/** Guard the asynchronous close before installing a replacement at the captured root. */
export async function startSessionProjectWatcher(
  root: string | null,
  ports: {
    isCurrent(): boolean;
    watcher(): Watcher | null;
    set(watcher: TrackedWatcher | null): void;
    create(root: string): TrackedWatcher;
    changed(event: string, path: string): void;
  },
) {
  if (!ports.isCurrent()) return;
  await ports.watcher()?.close();
  if (!ports.isCurrent()) return;
  ports.set(null);
  if (!root) return;
  const watcher = ports.create(root);
  ports.set(watcher);
  watcher.on('all', (event, path) => {
    if (ports.isCurrent()) ports.changed(event, path);
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
