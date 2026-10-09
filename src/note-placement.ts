export type NoteBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Canvas coordinates, independent of zoom and the direction of the drag. */
export function noteDragBounds(
  start: { x: number; y: number },
  end: { x: number; y: number },
): NoteBounds {
  return {
    x: Math.round(Math.min(start.x, end.x)),
    y: Math.round(Math.min(start.y, end.y)),
    width: Math.max(1, Math.round(Math.abs(end.x - start.x))),
    height: Math.max(1, Math.round(Math.abs(end.y - start.y))),
  };
}
