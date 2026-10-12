export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export const NEW_FILE_GAP = 40;

export function rectDistance(a: CanvasRect, b: CanvasRect) {
  return Math.hypot(
    Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
    Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
  );
}
export function enclosingRect(rects: CanvasRect[]): CanvasRect {
  const x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
}
/** Find the largest nearby group, so isolated cards do not move the anchor. */
export function mainDocumentCluster(
  rects: CanvasRect[],
  origin = { x: 120, y: 120 },
) {
  const bounds = rects.filter(
    (r) =>
      [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
      r.width > 0 &&
      r.height > 0,
  );
  const remaining = new Set(bounds),
    groups: CanvasRect[][] = [];
  while (remaining.size) {
    const group = [remaining.values().next().value!];
    remaining.delete(group[0]);
    for (let i = 0; i < group.length; i++)
      for (const rect of remaining)
        if (rectDistance(group[i], rect) <= 160) {
          group.push(rect);
          remaining.delete(rect);
        }
    groups.push(group);
  }
  const distance = (group: CanvasRect[]) => {
    const b = enclosingRect(group);
    return Math.hypot(
      b.x + b.width / 2 - origin.x,
      b.y + b.height / 2 - origin.y,
    );
  };
  return (
    groups.sort(
      (a, b) => b.length - a.length || distance(a) - distance(b),
    )[0] ?? []
  );
}
/** Search adjacent edges and holes instead of jumping by the new object's width. */
export function nearDocumentPosition(
  size: { width: number; height: number },
  occupied: CanvasRect[],
  origin = { x: 120, y: 120 },
) {
  const bounds = occupied.filter(
    (r) =>
      [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
      r.width > 0 &&
      r.height > 0,
  );
  if (!bounds.length)
    return { x: Math.round(origin.x), y: Math.round(origin.y) };
  const group = mainDocumentCluster(bounds, origin),
    anchor = enclosingRect(group),
    gap = NEW_FILE_GAP;
  const candidates: { x: number; y: number }[] = [];
  for (const b of [anchor, ...group, ...bounds]) {
    for (const y of [b.y, b.y + b.height - size.height])
      candidates.push(
        { x: b.x + b.width + gap, y },
        { x: b.x - size.width - gap, y },
      );
    for (const x of [b.x, b.x + b.width - size.width])
      candidates.push(
        { x, y: b.y + b.height + gap },
        { x, y: b.y - size.height - gap },
      );
  }
  const free = (p: { x: number; y: number }) =>
    !bounds.some(
      (b) =>
        p.x < b.x + b.width + gap &&
        p.x + size.width + gap > b.x &&
        p.y < b.y + b.height + gap &&
        p.y + size.height + gap > b.y,
    );
  const score = (p: { x: number; y: number }) => {
    const r = { ...p, ...size };
    return (
      Math.min(...group.map((b) => rectDistance(r, b))) * 1000 +
      Math.hypot(
        p.x + size.width / 2 - anchor.x - anchor.width / 2,
        p.y + size.height / 2 - anchor.y - anchor.height / 2,
      )
    );
  };
  const best = candidates
    .filter(free)
    .map((p) => ({ ...p, score: score(p) }))
    .sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x)[0]!;
  return { x: Math.round(best.x), y: Math.round(best.y) };
}

/** Keep a column aligned, moving downward past any occupied cards. */
export function verticalLayouts(
  sizes: { width: number; height: number }[],
  occupied: CanvasRect[],
  origin: { x: number; y: number },
): CanvasRect[] {
  if (!sizes.length) return [];
  const bounds = occupied.filter((rect) =>
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
  );
  const x = Math.round(origin.x);
  let y = Math.round(origin.y);
  const blockWidth = Math.max(...sizes.map((size) => size.width));
  const blockHeight =
    sizes.reduce((total, size) => total + size.height, 0) +
    NEW_FILE_GAP * (sizes.length - 1);
  let collisions: CanvasRect[];
  do {
    collisions = bounds.filter(
      (rect) =>
        x < rect.x + rect.width + NEW_FILE_GAP &&
        x + blockWidth + NEW_FILE_GAP > rect.x &&
        y < rect.y + rect.height + NEW_FILE_GAP &&
        y + blockHeight + NEW_FILE_GAP > rect.y,
    );
    if (collisions.length)
      y = Math.max(
        ...collisions.map((rect) => rect.y + rect.height + NEW_FILE_GAP),
      );
  } while (collisions.length);
  return sizes.map(({ width, height }) => {
    const layout = { x, y, width, height };
    y += height + NEW_FILE_GAP;
    return layout;
  });
}
