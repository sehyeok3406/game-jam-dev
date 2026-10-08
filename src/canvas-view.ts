import { randomUUID } from 'node:crypto';
import { snapshotDocuments, snapshotSections } from './collaboration-model.ts';
import { describePreview, htmlSourcePath } from './html-source.ts';
import { isPreviewPath } from './preview-output.ts';
import { RESULT_CATALOG_PATH } from './result-structure.ts';
import { CANVAS_SHEETS_PATH, readCanvasSheets } from './canvas-sheets.ts';
import type { Snapshot } from './project-store.ts';
import type { PropertyVersions } from './sync-properties.ts';
import type { CanvasDocument, CanvasSection, PreviewResult } from './shared.ts';
export type CanvasViewChanges = {
  documents: CanvasDocument[];
  sections: CanvasSection[];
  previews: PreviewResult[];
  removed: string[];
  signatures: Record<string, string>;
  sheets: ReturnType<typeof readCanvasSheets> & { raw: string | null };
};
/** Stable item cache; unchanged HTML content never crosses IPC on a text/layout save. */
export class CanvasView {
  private items = new Map<
    string,
    {
      sources: unknown[];
      signature: string;
      value: CanvasDocument | CanvasSection | PreviewResult;
    }
  >();
  read(
    files: Snapshot,
    revisions: Record<string, number>,
    properties: PropertyVersions,
    collapsed: Map<string, boolean>,
    known: Record<string, string>,
  ): CanvasViewChanges {
    const result: CanvasViewChanges = {
      documents: [],
      sections: [],
      previews: [],
      removed: [],
      signatures: {},
      sheets: {
        ...readCanvasSheets(files[CANVAS_SHEETS_PATH]),
        raw: files[CANVAS_SHEETS_PATH] ?? null,
      },
    };
    for (const relative of Object.keys(files)) {
      const preview = isPreviewPath(relative),
        section = relative.startsWith('sections/');
      if (!preview && !relative.endsWith('.md')) continue;
      let item = this.items.get(relative);
      const assetPath =
        item && 'asset' in item.value ? item.value.asset?.path : undefined;
      const sources = [
        files[relative],
        revisions[relative],
        properties[relative]?.content,
        collapsed.get(relative),
        assetPath ? files[assetPath] : undefined,
        ...(preview
          ? [files[htmlSourcePath(relative)], files[RESULT_CATALOG_PATH]]
          : []),
      ];
      if (
        !item ||
        sources.some((source, index) => source !== item!.sources[index])
      ) {
        const value = preview
          ? {
              ...describePreview(files, relative),
              revision: revisions[relative],
              structureRevision: properties[relative]?.structure ?? 0,
            }
          : section
            ? {
                ...snapshotSections({ [relative]: files[relative] })[0],
                revision: revisions[relative],
                structureRevision: properties[relative]?.structure ?? 0,
              }
            : snapshotDocuments({ [relative]: files[relative] })[0];
        if (!value) continue;
        if (!preview && !section) {
          const document = value as CanvasDocument;
          document.revision = revisions[relative];
          document.structureRevision = properties[relative]?.structure ?? 0;
          document.contentRevision = properties[relative]?.content ?? 0;
          document.assetVersion = document.asset
            ? revisions[document.asset.path]
            : undefined;
          document.collapsed = collapsed.get(relative) ?? document.collapsed;
          sources[4] = document.asset ? files[document.asset.path] : undefined;
        }
        item = { sources, value, signature: randomUUID() };
        this.items.set(relative, item);
      }
      result.signatures[relative] = item.signature;
      if (known[relative] !== item.signature) {
        if (preview) result.previews.push(item.value as PreviewResult);
        else if (section) result.sections.push(item.value as CanvasSection);
        else result.documents.push(item.value as CanvasDocument);
      }
    }
    for (const relative of Object.keys(known))
      if (!result.signatures[relative]) result.removed.push(relative);
    for (const relative of this.items.keys())
      if (!files[relative]) this.items.delete(relative);
    return result;
  }
}
