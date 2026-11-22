import type { ProjectFileEffects } from '../application/ports/shared-project-files.ts';
import type { Snapshot, WorkspaceCanvasChange } from '../contracts/project.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import matter from '../markdown.ts';
import { isDrawingPath } from '../drawing-model.ts';
import { isGameUiPath } from '../game-ui-model.ts';
import { KANBAN_VIEW_PATH } from '../features/kanban/view.ts';

const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');

const isDocument = (path: string) =>
  /^(?:project\.md$|(?:ideas|docs)\/.+\.md$)/.test(path) &&
  !path.startsWith('docs/text-sources/');
const isSection = (path: string) => /^sections\/.+\.md$/.test(path);
export const isOrdinaryMarkdownPath = (path: string) =>
  isDocument(path) && !path.startsWith('docs/html-sources/');
export const isScopedCanvasFile = (path: string) =>
  isDocument(path) ||
  isSection(path) ||
  isDrawingPath(path) ||
  isGameUiPath(path) ||
  path === KANBAN_VIEW_PATH;

/** Only omit a full refresh after classifying the confirmed file changes. */
export function canvasWrites() {
  let session: string | undefined;
  const recent = new Map<string, { digest: string | null; expires: number }>();
  const remember = (sessionId: string, paths: string[], after: Snapshot) => {
    if (session !== sessionId || recent.size > 1000) recent.clear();
    session = sessionId;
    const expires = Date.now() + 5000;
    for (const path of paths)
      recent.set(path, {
        digest: after[path] === undefined ? null : digest(after[path]),
        expires,
      });
  };
  return {
    acknowledgeDocumentSave(sessionId: string, path: string, written: string) {
      remember(sessionId, [path], { [path]: written });
      return { sessionId, paths: [] } satisfies WorkspaceCanvasChange;
    },
    record(
      sessionId: string,
      before: Snapshot,
      after: Snapshot,
      paths = [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ].filter((path) => before[path] !== after[path]),
    ): WorkspaceCanvasChange | null {
      const change: WorkspaceCanvasChange = { sessionId, paths: [] };
      const withoutCanvasMetadata = (raw: string, section: boolean) => {
        const { data, content } = matter(raw);
        const ignored = section
          ? [
              'x',
              'y',
              'width',
              'height',
              'members',
              'parent_section_id',
              'updated_at',
            ]
          : [
              'x',
              'y',
              'width',
              'height',
              'status_property_enabled',
              'workflow_status_id',
              'workflow_order',
              'updated_at',
            ];
        return JSON.stringify([
          content,
          Object.entries(data).filter(([key]) => !ignored.includes(key)),
        ]);
      };
      try {
        for (const path of paths) {
          if (isDrawingPath(path)) change.drawings = true;
          else if (isGameUiPath(path)) change.gameUi = true;
          else if (path === KANBAN_VIEW_PATH) change.kanban = true;
          else {
            const section = isSection(path);
            if (
              (!section && !isDocument(path)) ||
              before[path] === undefined ||
              after[path] === undefined ||
              withoutCanvasMetadata(before[path], section) !==
                withoutCanvasMetadata(after[path], section)
            )
              return null;
            if (section) change.sections = true;
            else change.paths.push(path);
          }
        }
      } catch {
        return null;
      }
      remember(sessionId, paths, after);
      return change;
    },
    async matches(sessionId: string, relative: string, absolute: string) {
      const write = session === sessionId ? recent.get(relative) : undefined;
      if (!write || write.expires <= Date.now()) return false;
      const actual = await readFile(absolute, 'utf8').catch((error) =>
        error.code === 'ENOENT' ? null : undefined,
      );
      return (
        actual !== undefined &&
        session === sessionId &&
        recent.get(relative) === write &&
        (actual === null ? null : digest(actual)) === write.digest
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
