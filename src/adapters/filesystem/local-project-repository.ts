import fs from 'node:fs/promises';
import type {
  CanvasFileScope,
  LocalProjectRepository,
} from '../../application/ports/local-project-repository.ts';
import { CANVAS_SHEETS_PATH } from '../../canvas-sheets.ts';
import { DRAWING_DIRECTORY } from '../../drawing-model.ts';
import { GAME_UI_DIRECTORY } from '../../game-ui-types.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';
import {
  captureProject,
  listHistory,
  readHistoryFile,
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

const canvasRoots: Record<CanvasFileScope, readonly string[]> = {
  drawings: [CANVAS_SHEETS_PATH, DRAWING_DIRECTORY],
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
): LocalProjectRepository {
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
