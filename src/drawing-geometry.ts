import { getStroke } from 'perfect-freehand';
import type {
  DrawingObject,
  DrawingStyle,
  DrawingTransform,
  ShapeKind,
  StrokeObject,
} from './drawing-types.ts';
export type Point = { x: number; y: number };
export const DEFAULT_SHAPE_STYLE: DrawingStyle = {
  fill: '#dbeafe',
  stroke: '#2563eb',
  strokeWidth: 2,
  opacity: 1,
  strokePattern: 'solid',
};
export const DEFAULT_PEN_STYLE: DrawingStyle = {
  fill: null,
  stroke: '#172554',
  strokeWidth: 3,
  opacity: 1,
  strokePattern: 'solid',
};
export const DEFAULT_HIGHLIGHT_STYLE: DrawingStyle = {
  fill: null,
  stroke: '#facc15',
  strokeWidth: 16,
  opacity: 0.3,
  strokePattern: 'solid',
};
export function rotatePoint(p: Point, angle: number, center: Point): Point {
  const a = (angle * Math.PI) / 180,
    x = p.x - center.x,
    y = p.y - center.y;
  return {
    x: center.x + x * Math.cos(a) - y * Math.sin(a),
    y: center.y + x * Math.sin(a) + y * Math.cos(a),
  };
}
export function drawingBounds(o: DrawingObject) {
  const t = o.transform,
    center = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  const pts = [
    { x: t.x, y: t.y },
    { x: t.x + t.width, y: t.y },
    { x: t.x, y: t.y + t.height },
    { x: t.x + t.width, y: t.y + t.height },
  ].map((p) => rotatePoint(p, t.rotation, center));
  const pad =
    o.style.strokeWidth *
      (o.kind === 'shape' && o.geometry.shape === 'arrow' ? 4 : 1) +
    8;
  const x = Math.min(...pts.map((p) => p.x)) - pad,
    y = Math.min(...pts.map((p) => p.y)) - pad;
  return {
    x,
    y,
    width: Math.max(...pts.map((p) => p.x)) - x + pad,
    height: Math.max(...pts.map((p) => p.y)) - y + pad,
  };
}
export function shapeFromDrag(
  shape: ShapeKind,
  start: Point,
  end: Point,
  shift = false,
  alt = false,
  click = false,
) {
  let dx = end.x - start.x,
    dy = end.y - start.y;
  const line = shape === 'line' || shape === 'arrow';
  if (click) {
    dx = line ? 180 : 160;
    dy = line ? 0 : shape === 'triangle' ? 140 : 120;
  }
  if (shift) {
    if (line) {
      const length = Math.hypot(dx, dy),
        a = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
      dx = length * Math.cos(a);
      dy = length * Math.sin(a);
    } else {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * d;
      dy = (dy < 0 ? -1 : 1) * d;
    }
  }
  const a = alt ? { x: start.x - dx, y: start.y - dy } : start,
    b = { x: start.x + dx, y: start.y + dy };
  const t: DrawingTransform = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(1, Math.abs(b.x - a.x)),
    height: Math.max(1, Math.abs(b.y - a.y)),
    rotation: 0,
  };
  const geometry = {
    shape,
    ...(shape === 'rounded-rectangle' ? { cornerRadius: 16 } : {}),
    ...(line
      ? {
          endpoints: [
            [(a.x - t.x) / t.width, (a.y - t.y) / t.height],
            [(b.x - t.x) / t.width, (b.y - t.y) / t.height],
          ] as [[number, number], [number, number]],
        }
      : {}),
  };
  return { transform: t, geometry };
}
export function strokeGeometry(
  points: [number, number, number][],
  brush: 'pen' | 'highlighter',
  pressureEnabled: boolean,
) {
  const x = Math.min(...points.map((p) => p[0])),
    y = Math.min(...points.map((p) => p[1]));
  const width = Math.max(1, Math.max(...points.map((p) => p[0])) - x),
    height = Math.max(1, Math.max(...points.map((p) => p[1])) - y);
  return {
    transform: { x, y, width, height, rotation: 0 },
    geometry: {
      brush,
      sourceWidth: width,
      sourceHeight: height,
      points: points.map(
        (p) => [p[0] - x, p[1] - y, p[2]] as [number, number, number],
      ),
      pressureEnabled,
      rendererVersion: 1 as const,
    },
  };
}
export function shapePath(o: DrawingObject) {
  if (o.kind !== 'shape') return '';
  const w = o.transform.width,
    h = o.transform.height,
    g = o.geometry;
  if (g.shape === 'ellipse')
    return `M ${w} ${h / 2} A ${w / 2} ${h / 2} 0 1 0 0 ${h / 2} A ${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} Z`;
  if (g.shape === 'triangle') return `M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`;
  if (g.shape === 'diamond')
    return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
  if (g.endpoints) {
    const [a, b] = g.endpoints;
    return `M ${a[0] * w} ${a[1] * h} L ${b[0] * w} ${b[1] * h}`;
  }
  const r =
    g.shape === 'rounded-rectangle'
      ? Math.min(g.cornerRadius ?? 16, w / 2, h / 2)
      : 0;
  return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
}
export function strokePath(o: StrokeObject) {
  const g = o.geometry,
    t = o.transform;
  const outline = getStroke(
    g.points.map((p) => [
      (p[0] * t.width) / g.sourceWidth,
      (p[1] * t.height) / g.sourceHeight,
      p[2],
    ]),
    {
      size: o.style.strokeWidth,
      thinning: g.pressureEnabled ? 0.5 : 0,
      simulatePressure: false,
      smoothing: 0.5,
      streamline: 0.3,
      last: true,
    },
  );
  return outline.length
    ? `M ${outline.map((p) => p.join(' ')).join(' L ')} Z`
    : '';
}
export function arrowHead(o: DrawingObject) {
  if (o.kind !== 'shape' || o.geometry.shape !== 'arrow') return '';
  const [a, b] = o.geometry.endpoints!,
    w = o.transform.width,
    h = o.transform.height;
  const x = b[0] * w,
    y = b[1] * h,
    angle = Math.atan2((b[1] - a[1]) * h, (b[0] - a[0]) * w),
    s = Math.max(10, o.style.strokeWidth * 4);
  return `M ${x - Math.cos(angle - 0.5) * s} ${y - Math.sin(angle - 0.5) * s} L ${x} ${y} L ${x - Math.cos(angle + 0.5) * s} ${y - Math.sin(angle + 0.5) * s}`;
}
export function drawingSvg(o: DrawingObject) {
  const b = drawingBounds(o),
    t = o.transform,
    s = o.style;
  const path = o.kind === 'stroke' ? strokePath(o) : shapePath(o),
    head = arrowHead(o);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}"><g transform="translate(${t.x - b.x} ${t.y - b.y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2})" opacity="${s.opacity}"><path d="${path}" fill="${o.kind === 'stroke' ? (s.stroke ?? 'none') : (s.fill ?? 'none')}" stroke="${o.kind === 'stroke' ? 'none' : (s.stroke ?? 'none')}" stroke-width="${s.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${s.strokePattern === 'dashed' ? ' stroke-dasharray="6 4"' : ''}/>${head ? `<path d="${head}" fill="none" stroke="${s.stroke ?? 'none'}" stroke-width="${s.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</g></svg>`;
}
const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy,
    u = l
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l))
      : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
};
export function strokeHit(o: StrokeObject, a: Point, b: Point, radius: number) {
  const t = o.transform,
    c = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  const pts = o.geometry.points.map((p) =>
    rotatePoint(
      {
        x: t.x + (p[0] * t.width) / o.geometry.sourceWidth,
        y: t.y + (p[1] * t.height) / o.geometry.sourceHeight,
      },
      t.rotation,
      c,
    ),
  );
  const r = radius + o.style.strokeWidth;
  if (pts.length === 1) return segmentDistance(pts[0], a, b) <= r;
  const cross = (p: Point, q: Point, v: Point) =>
    (q.x - p.x) * (v.y - p.y) - (q.y - p.y) * (v.x - p.x);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1],
      q = pts[i];
    if (
      Math.min(
        segmentDistance(p, a, b),
        segmentDistance(q, a, b),
        segmentDistance(a, p, q),
        segmentDistance(b, p, q),
      ) <= r
    )
      return true;
    if (
      cross(a, b, p) * cross(a, b, q) < 0 &&
      cross(p, q, a) * cross(p, q, b) < 0
    )
      return true;
  }
  return false;
}
