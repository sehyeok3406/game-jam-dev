import type { AppApi } from '../../contracts/app-api.ts';
import type { WorkspaceState } from '../../contracts/project.ts';
import type { CanvasDocument } from '../../contracts/documents.ts';
import type { CanvasSection } from '../../contracts/canvas.ts';
import type { PreviewResult } from '../../contracts/preview.ts';

type CanvasData = {
  documents: CanvasDocument[];
  sections: CanvasSection[];
  previews: PreviewResult[];
};
function patch<T extends { relativePath: string }>(
  before: T[],
  changed: T[],
  removed: string[],
): T[] {
  const deleted = new Set(removed);
  const values = new Map(
    before
      .filter((item) => !deleted.has(item.relativePath))
      .map((item) => [item.relativePath, item]),
  );
  for (const item of changed) values.set(item.relativePath, item);
  return [...values.values()];
}

/** Owns data-read generations and delta baselines; never owns editor drafts or selection. */
export class WorkspaceDataLoader {
  private api: AppApi;
  private generation = 0;
  private cache:
    | (CanvasData & { key: string; signatures: Record<string, string> })
    | null = null;
  constructor(api: AppApi) {
    this.api = api;
  }
  invalidate() {
    this.generation++;
  }
  watch(changed: () => void) {
    const stop = this.api.projects.onWorkspaceChanged(() => {
      this.invalidate();
      changed();
    });
    return () => {
      this.invalidate();
      stop();
    };
  }
  begin() {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    return {
      current,
      workspace: () => this.api.projects.getWorkspace(),
      canvas: async (state: WorkspaceState) => {
        const key = JSON.stringify([
          state.root,
          state.session?.sessionId ?? null,
        ]);
        const previous =
          this.cache?.key === key
            ? this.cache
            : { documents: [], sections: [], previews: [], signatures: {} };
        const delta = await this.api.editor.getCanvasChanges?.(
          previous.signatures,
        );
        if (!current()) return null;
        if (delta) {
          const next = {
            documents: patch(
              previous.documents,
              delta.documents,
              delta.removed,
            ),
            sections: patch(previous.sections, delta.sections, delta.removed),
            previews: patch(previous.previews, delta.previews, delta.removed),
          };
          this.cache = { ...next, key, signatures: delta.signatures };
          return { ...next, sheets: delta.sheets };
        }
        const [documents, sections, previews, sheets] = await Promise.all([
          this.api.editor.listDocuments(),
          this.api.editor.listSections(),
          this.api.preview.listPreviews(),
          this.api.editor.getCanvasSheets(),
        ]);
        return current() ? { documents, sections, previews, sheets } : null;
      },
    };
  }
}
