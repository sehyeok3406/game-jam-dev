export interface ResizeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

/** Add the same canvas-space delta to every box, preserving its opposite edge. */
export function resizeGroup(
  boxes: ResizeBox[],
  primary: ResizeBox,
  next: Pick<ResizeBox, 'x' | 'y' | 'width' | 'height'>,
) {
  const dw = Math.max(
    next.width - primary.width,
    ...boxes.map((box) => box.minWidth - box.width),
  );
  const dh = Math.max(
    next.height - primary.height,
    ...boxes.map((box) => box.minHeight - box.height),
  );
  const left = Math.abs(next.x - primary.x) > 0.001;
  const top = Math.abs(next.y - primary.y) > 0.001;
  return boxes.map((box) => ({
    ...box,
    x: box.x - (left ? dw : 0),
    y: box.y - (top ? dh : 0),
    width: box.width + dw,
    height: box.height + dh,
  }));
}
