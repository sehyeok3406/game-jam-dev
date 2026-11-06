import { canvasId, assertCanvas } from './canvas-sheets.ts';
import { snapshotDrawings } from './drawing-model.ts';
import { drawingBounds } from './drawing-geometry.ts';
import { isPreviewPath, managedPreviewPaths } from './preview-output.ts';
import { htmlSourcePath, sourceMetadata } from './html-source.ts';
import matter from './markdown.ts';
import { verticalLayouts, type CanvasRect } from './canvas-placement.ts';
import type { Snapshot } from './project-store.ts';
import { readNodePlacement } from './core/canvas/file-node-style.ts';
import { placeResultGroup } from './core/canvas/result-placement.ts';
import type { PreviewWindowState } from './contracts/preview.ts';

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
  compact?: { width: number; height: number },
  windows?: ReadonlyMap<string, PreviewWindowState>,
): CanvasRect[] {
  return [
    ...snapshotDrawings(files)
      .filter((o) => !selectedCanvas || o.canvasId === selectedCanvas)
      .map(drawingBounds),
    ...Object.entries(files).flatMap(([path, raw]) => {
      if (!path.endsWith('.md')) return [];
      const { data } = matter(raw);
      if (selectedCanvas && canvasId(data.canvas_id) !== selectedCanvas)
        return [];
      if (!visible(path, data) && !data.html_source) return [];
      const saved =
        typeof data.html_source === 'string'
          ? windows?.get(data.html_source)
          : undefined;
      const rect = saved ?? {
        x: finite(data.x, 120),
        y: finite(data.y, 120),
        ...dimensions(data),
      };
      return [
        {
          x: rect.x,
          y: rect.y,
          width: compact ? Math.max(rect.width, compact.width) : rect.width,
          height: compact
            ? Math.max(rect.height, compact.height)
            : data.collapsed === true
              ? 38
              : rect.height,
        },
      ];
    }),
    ...(compact && (!selectedCanvas || selectedCanvas === 'default')
      ? managedPreviewPaths(files).flatMap((path) => {
          if (files[htmlSourcePath(path)] || !windows?.has(path)) return [];
          const { x, y, width, height } = windows.get(path)!;
          return [
            {
              x,
              y,
              width: Math.max(width, compact.width),
              height: Math.max(height, compact.height),
            },
          ];
        })
      : []),
  ];
}

/** App-owned geometry overrides AI coordinates; existing cards keep their layout. */
export function layoutNewDocuments(
  before: Snapshot,
  changes: Snapshot,
  origin: {
    x: number;
    y: number;
    canvasId?: string;
    nodePlacement?: unknown;
    inputs?: unknown;
    windows?: ReadonlyMap<string, PreviewWindowState>;
  },
  includeHtmlRecords = false,
): Snapshot {
  const selectedCanvas = assertCanvas(before, origin.canvasId);
  const compact = readNodePlacement(origin.nodePlacement);
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
    const existingHtml =
      compact &&
      typeof parsed.data.html_source === 'string' &&
      before[parsed.data.html_source] !== undefined;
    const targetCanvas =
      previous || existingHtml ? canvasId(previous?.canvas_id) : selectedCanvas;
    if (previous?.canvas_id !== undefined || targetCanvas !== 'default')
      parsed.data.canvas_id = targetCanvas;
    else delete parsed.data.canvas_id;
    result[path] = matter.stringify(parsed.content, parsed.data);
  }
  const added = Object.entries(result).flatMap(([path, raw]) => {
    if (!path.endsWith('.md')) return [];
    const parsed = matter(raw);
    if (
      !visible(path, parsed.data) &&
      !((includeHtmlRecords || compact) && parsed.data.html_source)
    )
      return [];
    if (before[path] !== undefined) {
      const old = matter(before[path]).data;
      for (const key of [
        'x',
        'y',
        'width',
        'height',
        'collapsed',
        'canvas_placement_id',
      ]) {
        if (old[key] !== undefined) parsed.data[key] = old[key];
        else delete parsed.data[key];
      }
      result[path] = matter.stringify(parsed.content, parsed.data);
      return [];
    }
    if (
      compact &&
      typeof parsed.data.html_source === 'string' &&
      before[parsed.data.html_source] !== undefined
    )
      return [];
    return [{ path, parsed }];
  });
  const occupied = documentBounds(
    before,
    selectedCanvas,
    compact,
    origin.windows,
  );
  const layouts = compact
    ? []
    : verticalLayouts(
        added.map(({ parsed }) => dimensions(parsed.data)),
        occupied,
        origin,
      );
  const inputBounds =
    compact && Array.isArray(origin.inputs)
      ? origin.inputs.flatMap((value: unknown) => {
          if (typeof value !== 'string') return [];
          const path = isPreviewPath(value) ? htmlSourcePath(value) : value;
          const raw = before[path];
          const saved = origin.windows?.get(value);
          if (
            saved &&
            canvasId(raw ? matter(raw).data.canvas_id : undefined) ===
              selectedCanvas
          )
            return [
              {
                x: saved.x,
                y: saved.y,
                width: Math.max(saved.width, compact.width),
                height: Math.max(saved.height, compact.height),
              },
            ];
          if (!raw || !path.endsWith('.md')) return [];
          const { data } = matter(raw);
          if (canvasId(data.canvas_id) !== selectedCanvas) return [];
          const size = dimensions(data);
          return [
            {
              x: finite(data.x, 120),
              y: finite(data.y, 120),
              width: Math.max(size.width, compact.width),
              height: Math.max(size.height, compact.height),
            },
          ];
        })
      : [];
  const group = compact
    ? placeResultGroup(
        added.map(({ path, parsed }) => {
          const size = dimensions(parsed.data);
          return {
            key: path,
            html: typeof parsed.data.html_source === 'string',
            width: Math.max(size.width, compact.width),
            height: Math.max(size.height, compact.height),
          };
        }),
        occupied,
        inputBounds,
        origin,
      )
    : undefined;
  added.forEach(({ path, parsed }, index) => {
    result[path] = matter.stringify(parsed.content, {
      ...parsed.data,
      ...(group
        ? { ...dimensions(parsed.data), ...group.get(path) }
        : layouts[index]),
      ...(compact && parsed.data.html_source
        ? { canvas_placement_id: `result:${parsed.data.id}` }
        : {}),
      collapsed: false,
    });
  });
  return result;
}
