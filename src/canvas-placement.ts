export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export const NEW_FILE_GAP = 40;

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
