import fs from 'node:fs/promises';
import type {
  CanvasFileScope,
  LocalProjectRepository,
} from '../../application/ports/local-project-repository.ts';
import { CANVAS_SHEETS_PATH } from '../../canvas-sheets.ts';
import { DRAWING_DIRECTORY } from '../../drawing-model.ts';
import { GAME_UI_DIRECTORY } from '../../game-ui-types.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import type { Snapshot } from '../../contracts/project.ts';
import {
  captureProject,
  listHistory,
  readHistoryEntry,
  readHistoryFile,
  readHistorySnapshots,
  restoreHistory,
  saveHistory,
  recoverInterruptedHistory,
  projectPath,
} from '../../project-store.ts';
import { isAssetPath, encodeAsset } from '../../file-assets.ts';
import {
  applyDocumentNames,
  recoverDocumentNames,
} from './document-name-transaction.ts';

const RECENT_EDIT_LIMIT = 20;
const RECENT_EDIT_BYTES = 8 * 1024 * 1024;
type EditHistory = Awaited<ReturnType<typeof readHistorySnapshots>>;

const canvasRoots: Record<CanvasFileScope, readonly string[]> = {
  drawings: [PROJECT_LAYOUT_PATH, CANVAS_SHEETS_PATH, DRAWING_DIRECTORY],
  'game-ui': [CANVAS_SHEETS_PATH, GAME_UI_DIRECTORY],
  layout: [
    PROJECT_LAYOUT_PATH,
    CANVAS_SHEETS_PATH,
    'project.md',
    'ideas',
    'docs',
    'docs/html-sources',
    '.ai/tasks',
    'sections',
    DRAWING_DIRECTORY,
  ],
};

/** Keep the existing recovery journal, atomic apply and external modification checks. */
export function filesystemProjectRepository(
  root: string,
  assertCurrent: () => void = () => {},
  cacheUndo = false,
): LocalProjectRepository {
  const recent = new Map<string, { change: EditHistory; bytes: number }>();
  let recentBytes = 0;
  const historyEntry = async (id: string) => {
    assertCurrent();
    const entry =
      recent.get(id)?.change.entry ?? (await readHistoryEntry(root, id));
    assertCurrent();
    return entry;
  };
  return {
    captureCanvas: async (scope) => {
      assertCurrent();
      const files = await captureProject(root, canvasRoots[scope]);
      assertCurrent();
      return files;
    },
    capture: async (paths) => {
      assertCurrent();
      if (!paths) {
        const files = await captureProject(root);
        assertCurrent();
        return files;
      }
      const entries = await Promise.all(
        paths.map(async (relative) => {
          const absolute = await projectPath(root, relative);
          return [
            relative,
            isAssetPath(relative)
              ? encodeAsset(relative, await fs.readFile(absolute))
              : await fs.readFile(absolute, 'utf8'),
          ] as const;
        }),
      );
      assertCurrent();
      return Object.fromEntries(entries);
    },
    apply: (before, changes, cancelled) => {
      assertCurrent();
      return applyDocumentNames(
        root,
        before,
        changes,
        assertCurrent,
        cancelled,
      );
    },
    history: () => {
      assertCurrent();
      return listHistory(root);
    },
    historyEntry,
    readEditHistory: async (id) => {
      assertCurrent();
      const cached = recent.get(id);
      if (cached) return cached.change;
      const entry = await historyEntry(id);
      if (entry?.kind !== 'user') return null;
      const change = await readHistorySnapshots(root, entry);
      assertCurrent();
      return change;
    },
    rememberUndo: cacheUndo
      ? (entry, before, after) => {
          assertCurrent();
          if (recent.has(entry.id)) return;
          const left: Snapshot = {},
            right: Snapshot = {};
          let bytes = 0;
          for (const {
            relativePath,
            before: hasBefore,
            after: hasAfter,
          } of entry.files) {
            const previous = hasBefore ? before[relativePath] : undefined;
            const next = hasAfter ? after[relativePath] : undefined;
            bytes +=
              2 *
              (relativePath.length +
                (previous?.length ?? 0) +
                (next?.length ?? 0));
            if (bytes > RECENT_EDIT_BYTES) return;
            if (previous !== undefined) left[relativePath] = previous;
            if (next !== undefined) right[relativePath] = next;
          }
          recent.set(entry.id, {
            change: { entry, before: left, after: right },
            bytes,
          });
          recentBytes += bytes;
          for (const [id, oldest] of recent) {
            if (
              recent.size <= RECENT_EDIT_LIMIT &&
              recentBytes <= RECENT_EDIT_BYTES
            )
              break;
            recent.delete(id);
            recentBytes -= oldest.bytes;
          }
        }
      : undefined,
    readHistory: (id, relative, version) => {
      assertCurrent();
      return readHistoryFile(root, id, relative, version);
    },
    restoreHistory: (id, relative, version) => {
      assertCurrent();
      return restoreHistory(root, id, relative, version);
    },
    saveHistory: (before, after, entry) => {
      assertCurrent();
      return saveHistory(root, before, after, entry);
    },
    recover: async () => {
      await recoverDocumentNames(root, assertCurrent);
      return recoverInterruptedHistory(root);
    },
  };
}
