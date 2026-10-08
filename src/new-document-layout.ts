import { canvasId, assertCanvas } from './canvas-sheets.ts';
import { isPreviewPath } from './preview-output.ts';
import { htmlSourcePath, sourceMetadata } from './html-source.ts';
import matter from './markdown.ts';
import { verticalLayouts, type CanvasRect } from './canvas-placement.ts';
import type { Snapshot } from './project-store.ts';

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const dimensions = (data: Record<string, unknown>) => ({
  width: Math.max(260, finite(data.width, 340)),
  height: Math.max(180, finite(data.height, 300)),
});
const visible = (path: string, data: Record<string, unknown>) =>
  path.endsWith('.md') &&
  !path.startsWith('.ai/') &&
  data.type !== 'ai-task' &&
  !data.html_source;

export function documentBounds(
  files: Snapshot,
  selectedCanvas?: string,
): CanvasRect[] {
  return Object.entries(files).flatMap(([path, raw]) => {
    if (!path.endsWith('.md')) return [];
    const { data } = matter(raw);
    if (selectedCanvas && canvasId(data.canvas_id) !== selectedCanvas)
      return [];
    if (!visible(path, data) && !data.html_source) return [];
    return [
      {
        x: finite(data.x, 120),
        y: finite(data.y, 120),
        ...dimensions(data),
        ...(data.collapsed === true ? { height: 38 } : {}),
      },
    ];
  });
}

/** App-owned geometry overrides AI coordinates; existing cards keep their layout. */
export function layoutNewDocuments(
  before: Snapshot,
  changes: Snapshot,
  origin: { x: number; y: number; canvasId?: string },
  includeHtmlRecords = false,
): Snapshot {
  const selectedCanvas = assertCanvas(before, origin.canvasId);
  const result = { ...changes };
  for (const path of Object.keys(changes).filter(isPreviewPath)) {
    const source = htmlSourcePath(path);
    if (!before[source] && !result[source])
      result[source] = sourceMetadata(path, changes[path], {
        x: origin.x,
        y: origin.y,
      });
  }
  for (const [path, raw] of Object.entries(result)) {
    if (!path.endsWith('.md') || path.startsWith('output/')) continue;
    const parsed = matter(raw);
    const previous = before[path] ? matter(before[path]).data : undefined;
    if (previous?.canvas_id !== undefined || selectedCanvas !== 'default')
      parsed.data.canvas_id = previous
        ? canvasId(previous.canvas_id)
        : selectedCanvas;
    else delete parsed.data.canvas_id;
    result[path] = matter.stringify(parsed.content, parsed.data);
  }
  const added = Object.entries(result).flatMap(([path, raw]) => {
    if (!path.endsWith('.md')) return [];
    const parsed = matter(raw);
    if (
      !visible(path, parsed.data) &&
      !(includeHtmlRecords && parsed.data.html_source)
    )
      return [];
    if (before[path] !== undefined) {
      const old = matter(before[path]).data;
      for (const key of ['x', 'y', 'width', 'height', 'collapsed']) {
        if (old[key] !== undefined) parsed.data[key] = old[key];
        else delete parsed.data[key];
      }
      result[path] = matter.stringify(parsed.content, parsed.data);
      return [];
    }
    return [{ path, parsed }];
  });
  const layouts = verticalLayouts(
    added.map(({ parsed }) => dimensions(parsed.data)),
    documentBounds(before, selectedCanvas),
    origin,
  );
  added.forEach(({ path, parsed }, index) => {
    result[path] = matter.stringify(parsed.content, {
      ...parsed.data,
      ...layouts[index],
      collapsed: false,
    });
  });
  return result;
}
