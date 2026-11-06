export type NodeBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function fileNodeEdgePath(from: NodeBounds, to: NodeBounds) {
  const ax = from.x + from.width / 2;
  const ay = from.y + from.height / 2;
  const bx = to.x + to.width / 2;
  const by = to.y + to.height / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const gapX = Math.abs(dx) - (from.width + to.width) / 2;
  const gapY = Math.abs(dy) - (from.height + to.height) / 2;
  const horizontal =
    gapX >= 0 || gapY >= 0 ? gapX >= gapY : Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    const direction = dx < 0 ? -1 : 1;
    const start = ax + (direction * from.width) / 2;
    const end = bx - (direction * to.width) / 2;
    const bend =
      direction * Math.max(8, Math.min(64, Math.abs(end - start) / 2));
    return {
      d: `M ${start} ${ay} C ${start + bend} ${ay}, ${end - bend} ${by}, ${end} ${by}`,
      x: (start + end) / 2,
      y: (ay + by) / 2,
    };
  }
  const direction = dy < 0 ? -1 : 1;
  const start = ay + (direction * from.height) / 2;
  const end = by - (direction * to.height) / 2;
  const bend = direction * Math.max(8, Math.min(64, Math.abs(end - start) / 2));
  return {
    d: `M ${ax} ${start} C ${ax} ${start + bend}, ${bx} ${end - bend}, ${bx} ${end}`,
    x: (ax + bx) / 2,
    y: (start + end) / 2,
  };
}
