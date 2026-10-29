import { getStroke } from 'perfect-freehand';
import { textDocumentHtml } from './text-document.ts';
import polygonClipping from 'polygon-clipping';
import type {
  DrawingObject,
  DrawingStyle,
  DrawingTransform,
  ShapeKind,
  StrokeObject,
  DrawingPolygon,
  ErasureRegion,
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
  if (o.kind === 'text') return { ...o.transform };
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
export function strokeOutline(o: StrokeObject) {
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
  return outline as [number, number][];
}
const visibleCache = new WeakMap<
  StrokeObject['geometry'],
  Map<string, DrawingPolygon[]>
>();
export function visibleStroke(o: StrokeObject): DrawingPolygon[] {
  const key = `${o.transform.width}:${o.transform.height}:${o.style.strokeWidth}`;
  let cache = visibleCache.get(o.geometry);
  if (cache?.has(key)) return cache.get(key)!;
  const outline = strokeOutline(o);
  let result: DrawingPolygon[] = outline.length >= 3 ? [[outline]] : [];
  if (result.length && o.geometry.erasures?.length) {
    const cuts = o.geometry.erasures.map((e) =>
      e.polygons.map((poly) =>
        poly.map((ring) =>
          ring.map(
            ([x, y]) =>
              [
                (x * o.transform.width) / o.geometry.sourceWidth,
                (y * o.transform.height) / o.geometry.sourceHeight,
              ] as [number, number],
          ),
        ),
      ),
    );
    result = polygonClipping.difference(result, ...cuts);
  }
  if (!cache) {
    cache = new Map();
    visibleCache.set(o.geometry, cache);
  }
  if (cache.size >= 4) cache.clear();
  cache.set(key, result);
  return result;
}
export function polygonPath(polygons: DrawingPolygon[]) {
  return polygons
    .map((poly) =>
      poly
        .map((ring) => `M ${ring.map((p) => p.join(' ')).join(' L ')} Z`)
        .join(' '),
    )
    .join(' ');
}
export function strokePath(o: StrokeObject) {
  return polygonPath(visibleStroke(o));
}
/** Fixed 32-sided circles have <0.2 CSS px radial error at the largest brush. */
export function eraserSweep(
  a: Point,
  b: Point,
  radius: number,
): DrawingPolygon[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const ring: [number, number][] = [];
  for (const [p, offset] of [
    [a, Math.PI / 2],
    [b, -Math.PI / 2],
  ] as const)
    for (let i = 0; i <= 16; i++) {
      const t = angle + offset + (Math.PI * i) / 16;
      ring.push([p.x + Math.cos(t) * radius, p.y + Math.sin(t) * radius]);
    }
  ring.push(ring[0]);
  return [[ring]];
}
function localSweep(
  o: StrokeObject,
  a: Point,
  b: Point,
  radius: number,
  source: boolean,
) {
  const t = o.transform;
  return eraserSweep(a, b, radius).map((poly) =>
    poly.map((ring) =>
      ring.map(([x, y]) => {
        const p = rotatePoint({ x, y }, -t.rotation, {
          x: t.x + t.width / 2,
          y: t.y + t.height / 2,
        });
        return [
          (p.x - t.x) * (source ? o.geometry.sourceWidth / t.width : 1),
          (p.y - t.y) * (source ? o.geometry.sourceHeight / t.height : 1),
        ] as [number, number];
      }),
    ),
  );
}
export function eraseRegion(
  o: StrokeObject,
  a: Point,
  b: Point,
  radius: number,
  id: string,
  previous?: ErasureRegion,
): ErasureRegion {
  const next = localSweep(o, a, b, radius, true);
  return {
    id,
    polygons: previous ? polygonClipping.union(previous.polygons, next) : next,
  };
}
export function withErasure(
  o: StrokeObject,
  region: ErasureRegion,
): StrokeObject {
  const old = o.geometry.erasures ?? [];
  return {
    ...o,
    geometry: {
      ...o.geometry,
      erasures: [...old.filter((e) => e.id !== region.id), region].sort(
        (a, b) => a.id.localeCompare(b.id),
      ),
    },
  };
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
  if (o.kind === 'text') {
    const g = o.geometry;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font:${g.fontSize}px ${g.fontFamily};line-height:1.4;color:${g.color};text-align:${g.align};overflow-wrap:anywhere;opacity:${s.opacity};padding:4px">${textDocumentHtml(g.document, g.align)}</div></foreignObject></svg>`;
  }
  const path = o.kind === 'stroke' ? strokePath(o) : shapePath(o),
    head = arrowHead(o);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}"><g transform="translate(${t.x - b.x} ${t.y - b.y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2})" opacity="${s.opacity}"><path d="${path}" fill-rule="${o.kind === 'stroke' && o.geometry.erasures?.length ? 'evenodd' : 'nonzero'}" fill="${o.kind === 'stroke' ? (s.stroke ?? 'none') : (s.fill ?? 'none')}" stroke="${o.kind === 'stroke' ? 'none' : (s.stroke ?? 'none')}" stroke-width="${s.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${s.strokePattern === 'dashed' ? ' stroke-dasharray="6 4"' : ''}/>${head ? `<path d="${head}" fill="none" stroke="${s.stroke ?? 'none'}" stroke-width="${s.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</g></svg>`;
}
const pointSegmentDistance2 = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const u = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return (p.x - a.x - u * dx) ** 2 + (p.y - a.y - u * dy) ** 2;
};
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function strokeHit(o: StrokeObject, a: Point, b: Point, radius: number) {
  const bounds = drawingBounds(o);
  if (
    Math.max(a.x, b.x) + radius < bounds.x ||
    Math.min(a.x, b.x) - radius > bounds.x + bounds.width ||
    Math.max(a.y, b.y) + radius < bounds.y ||
    Math.min(a.y, b.y) - radius > bounds.y + bounds.height
  )
    return false;
  const t = o.transform,
    center = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  const local = (p: Point) => {
    const q = rotatePoint(p, -t.rotation, center);
    return { x: q.x - t.x, y: q.y - t.y };
  };
  a = local(a);
  b = local(b);
  // A swept disc intersects visible ink when its center is in the ink, or
  // it comes within its radius of a visible boundary (including hole edges).
  for (const polygon of visibleStroke(o)) {
    let winding = 0;
    for (const ring of polygon)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const p = { x: ring[j][0], y: ring[j][1] },
          q = { x: ring[i][0], y: ring[i][1] };
        const side = cross(p, q, a);
        if (p.y <= a.y && q.y > a.y && side > 0) winding++;
        if (p.y > a.y && q.y <= a.y && side < 0) winding--;
        if (
          Math.min(
            pointSegmentDistance2(p, a, b),
            pointSegmentDistance2(q, a, b),
            pointSegmentDistance2(a, p, q),
            pointSegmentDistance2(b, p, q),
          ) <=
            radius * radius ||
          (cross(a, b, p) * cross(a, b, q) < 0 && side * cross(p, q, b) < 0)
        )
          return true;
      }
    if (winding !== 0) return true;
  }
  return false;
}
