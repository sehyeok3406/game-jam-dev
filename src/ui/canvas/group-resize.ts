export interface ResizeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  imageScale?: { min: number; max: number };
}

const clampScale = (
  scale: number,
  range: NonNullable<ResizeBox['imageScale']>,
) => Math.min(range.max, Math.max(range.min, scale));

/** Cards share the drag delta. Image boxes scale uniformly around the same anchor. */
export function resizeGroup(
  boxes: ResizeBox[],
  primary: ResizeBox,
  next: Pick<ResizeBox, 'x' | 'y' | 'width' | 'height'>,
) {
  const cards = boxes.filter((box) => !box.imageScale);
  let dw = Math.max(
    next.width - primary.width,
    ...cards.map((box) => box.minWidth - box.width),
  );
  let dh = Math.max(
    next.height - primary.height,
    ...cards.map((box) => box.minHeight - box.height),
  );
  if (primary.imageScale) {
    const scale = clampScale(
      1 + Math.max(dw / primary.width, dh / primary.height),
      primary.imageScale,
    );
    dw = primary.width * (scale - 1);
    dh = primary.height * (scale - 1);
  }
  const left = Math.abs(next.x - primary.x) > 0.001;
  const top = Math.abs(next.y - primary.y) > 0.001;
  return boxes.map((box) => {
    let width = box.width + dw;
    let height = box.height + dh;
    if (box.imageScale) {
      const sx = dw / box.width;
      const sy = dh / box.height;
      const scale = clampScale(
        1 + (Math.abs(sx) >= Math.abs(sy) ? sx : sy),
        box.imageScale,
      );
      width = box.width * scale;
      height = box.height * scale;
    }
    return {
      ...box,
      x: left ? box.x + box.width - width : box.x,
      y: top ? box.y + box.height - height : box.y,
      width,
      height,
    };
  });
}
