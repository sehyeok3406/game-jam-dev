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

export function documentBounds(files: Snapshot): CanvasRect[] {
  return Object.entries(files).flatMap(([path, raw]) => {
    if (!path.endsWith('.md')) return [];
    const { data } = matter(raw);
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
  origin: { x: number; y: number },
  includeHtmlRecords = false,
): Snapshot {
  const result = { ...changes };
  const added = Object.entries(changes).flatMap(([path, raw]) => {
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
    documentBounds(before),
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
