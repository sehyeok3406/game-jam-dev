import type { CanvasDocument } from '../../contracts/documents.ts';
import type { PreviewResult } from '../../contracts/preview.ts';

export const markdownNodeKey = (document: CanvasDocument) =>
  `md:${document.id}`;
export const htmlNodeKey = (preview: PreviewResult) =>
  `html:${preview.sourceId ?? preview.identityPath ?? preview.relativePath}`;
