import type { CanvasDocument } from './documents.ts';
import type { CanvasSection, CanvasSheets } from './canvas.ts';
import type { PreviewResult } from './preview.ts';
export type CanvasViewChanges = {
  documents: CanvasDocument[];
  sections: CanvasSection[];
  previews: PreviewResult[];
  removed: string[];
  signatures: Record<string, string>;
  sheets: CanvasSheets & {
    raw: string | null;
  };
};
