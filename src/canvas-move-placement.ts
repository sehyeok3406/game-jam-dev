import matter from './markdown.ts';
import { canvasId } from './canvas-sheets.ts';
import { htmlSourcePath, sourceMetadata } from './html-source.ts';
import { isPreviewPath } from './preview-output.ts';
import {
  enclosingRect,
  nearDocumentPosition,
  type CanvasRect,
} from './canvas-placement.ts';
import type { Snapshot } from './project-store.ts';

export function filePlacementRect(path: string, raw: string): CanvasRect {
  const d = matter(raw).data,
    finite = (n: unknown, f: number) =>
      typeof n === 'number' && Number.isFinite(n) ? n : f;
  const section = path.startsWith('sections/'),
    html = !!d.html_source;
  return {
    x: finite(d.x, 120),
    y: finite(d.y, 120),
    width: Math.max(
      section ? 420 : html ? 420 : 260,
      finite(d.width, html ? 720 : section ? 860 : 340),
    ),
    height:
      d.collapsed === true
        ? 38
        : Math.max(
            section ? 280 : html ? 300 : 180,
            finite(d.height, html ? 520 : section ? 620 : 300),
          ),
  };
}
export function canvasDocumentRects(files: Snapshot, id: string): CanvasRect[] {
  return Object.entries(files).flatMap(([path, raw]) => {
    if (
      !path.endsWith('.md') ||
      path.startsWith('.ai/') ||
      path.startsWith('sections/') ||
      path.startsWith('output/')
    )
      return [];
    const d = matter(raw).data;
    return canvasId(d.canvas_id) === id && d.type !== 'ai-task'
      ? [filePlacementRect(path, raw)]
      : [];
  });
}
/** Translate a selected group once, preserving the distances within sections. */
export function placeMovedDocuments(
  files: Snapshot,
  next: Snapshot,
  paths: Set<string>,
  target: string,
) {
  const records = new Set<string>();
  for (const path of paths) {
    if (isPreviewPath(path)) {
      const source = htmlSourcePath(path);
      next[source] ??= sourceMetadata(path, next[path]);
      records.add(source);
    } else records.add(path);
  }
  const moving = [...records].filter(
    (p) => next[p] && p.endsWith('.md') && !p.startsWith('.ai/'),
  );
  if (!moving.length) return;
  const bounds = enclosingRect(
    moving.map((p) => filePlacementRect(p, next[p])),
  );
  const position = nearDocumentPosition(
    bounds,
    canvasDocumentRects(files, target),
  );
  const dx = position.x - bounds.x,
    dy = position.y - bounds.y,
    placementId = globalThis.crypto.randomUUID();
  for (const path of moving) {
    const parsed = matter(next[path]),
      rect = filePlacementRect(path, next[path]);
    next[path] = matter.stringify(parsed.content, {
      ...parsed.data,
      x: rect.x + dx,
      y: rect.y + dy,
      ...(parsed.data.html_source ? { canvas_placement_id: placementId } : {}),
    });
  }
}
