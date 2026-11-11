import {
  MAX_LAYOUT_VALUE,
  MIN_LAYOUT_HEIGHT,
  MIN_LAYOUT_WIDTH,
} from '../editing/layout.ts';

type Size = { width: number; height: number };
type Position = { x: number; y: number };

/** The bitmap was centered within the stored box. Keep its footprint in place. */
export function fittedImage(box: Size, aspect: number) {
  const width = Math.min(box.width, box.height * aspect);
  const height = Math.min(box.height, box.width / aspect);
  return {
    width,
    height,
    x: (box.width - width) / 2,
    y: (box.height - height) / 2,
  };
}

export function imageResizeRange(box: Size) {
  return {
    min: Math.max(MIN_LAYOUT_WIDTH / box.width, MIN_LAYOUT_HEIGHT / box.height),
    max: MAX_LAYOUT_VALUE / Math.max(box.width, box.height),
  };
}

/** Shared documents still store the original box. Scale it uniformly on resize. */
export function storedImageLayout(
  box: Size,
  aspect: number,
  position: Position,
  visibleWidth?: number,
) {
  const range = imageResizeRange(box);
  const scale =
    visibleWidth === undefined
      ? 1
      : Math.min(
          range.max,
          Math.max(range.min, visibleWidth / fittedImage(box, aspect).width),
        );
  const size =
    scale === 1
      ? { width: box.width, height: box.height }
      : {
          width: Math.round(box.width * scale),
          height: Math.round(box.height * scale),
        };
  const inset = fittedImage(size, aspect);
  return { ...size, x: position.x - inset.x, y: position.y - inset.y };
}
