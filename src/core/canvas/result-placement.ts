import type { NodeBounds } from './file-node-edge.ts';

const gap = 40;
type Point = { x: number; y: number };

function overlaps(a: NodeBounds, b: NodeBounds) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function placeResultGroup(
  items: { key: string; width: number; height: number; html: boolean }[],
  occupied: NodeBounds[],
  inputs: NodeBounds[],
  fallback: Point,
) {
  if (!items.length) return new Map<string, Point>();
  const mdWidth = Math.max(
    0,
    ...items.filter((item) => !item.html).map((item) => item.width),
  );
  let mdY = 0;
  let htmlY = 0;
  const boxes = items.map((item) => {
    const x = item.html && mdWidth ? mdWidth + gap : 0;
    const y = item.html ? htmlY : mdY;
    if (item.html) htmlY += item.height + gap;
    else mdY += item.height + gap;
    return { ...item, x, y };
  });
  const origin = inputs.length
    ? {
        x: Math.max(...inputs.map((input) => input.x + input.width)) + gap,
        y: Math.min(...inputs.map((input) => input.y)),
      }
    : fallback;
  const below = inputs.length
    ? {
        x: Math.min(...inputs.map((input) => input.x)),
        y: Math.max(...inputs.map((input) => input.y + input.height)) + gap,
      }
    : fallback;
  const fits = (at: Point) =>
    !boxes.some((box) =>
      occupied.some((item) =>
        overlaps({ ...box, x: box.x + at.x, y: box.y + at.y }, item),
      ),
    );
  const at = [origin, below].find(fits) ?? {
    x: below.x,
    y: Math.max(below.y, ...occupied.map((box) => box.y + box.height + gap)),
  };
  return new Map(
    boxes.map((box) => [
      box.key,
      { x: Math.round(at.x + box.x), y: Math.round(at.y + box.y) },
    ]),
  );
}

export function arrangeFileNodes(
  items: (NodeBounds & { key: string })[],
  mode: 'row' | 'column' | 'grid',
) {
  if (!items.length) return new Map<string, Point>();
  const ordered = [...items].sort((a, b) =>
    mode === 'row' ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x,
  );
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const columns =
    mode === 'row'
      ? items.length
      : mode === 'column'
        ? 1
        : Math.ceil(Math.sqrt(items.length));
  const widths = Array<number>(columns).fill(0);
  const heights = Array<number>(Math.ceil(items.length / columns)).fill(0);
  ordered.forEach(({ width, height }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    widths[column] = Math.max(widths[column], width);
    heights[row] = Math.max(heights[row], height);
  });
  const offsets = (sizes: number[], start: number) =>
    sizes.map((size) => {
      const offset = start;
      start += size + gap;
      return offset;
    });
  const xs = offsets(widths, left);
  const ys = offsets(heights, top);
  return new Map(
    ordered.map((item, index) => [
      item.key,
      { x: xs[index % columns], y: ys[Math.floor(index / columns)] },
    ]),
  );
}
