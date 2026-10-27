import {
  memo,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EraserPreviewContext } from './eraserPreview';
import { TextDrawingNode } from './TextDrawingNode';
import { textDocumentHtml } from '../../text-document';
import { useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import {
  arrowHead,
  drawingBounds,
  rotatePoint,
  shapePath,
  strokePath,
} from '../../drawing-geometry';
import {
  drawingName,
  type DrawingObject,
  type DrawingPatch,
  type DrawingTransform,
} from '../../drawing-types';
export type DrawingNodeData = {
  onCommand: (
    command: Omit<
      import('../../drawing-types').DrawingCommand,
      'canvasId' | 'scope'
    >,
  ) => Promise<void>;
  scope?: string;
  draftRegistry: import('../editor/draft-flushers').DraftFlusherRegistry;
  onSave: (patch: DrawingPatch) => Promise<void>;
  kind: 'drawing';
  object: DrawingObject;
  locked: boolean;
  textAlignmentSupported?: boolean;
  zoom: number;
  onGesture: (active: boolean) => void;
  onPatch: (patch: DrawingPatch) => void;
  onContext: () => void;
};
export type DrawingCanvasNode = Node<DrawingNodeData, 'drawing'>;
export function DrawingGraphic({
  object,
  hit = false,
  zoom = 1,
}: {
  object: DrawingObject;
  hit?: boolean;
  zoom?: number;
}) {
  const clipId = useId().replace(/:/g, '_');
  const path = useMemo(
    () => (object.kind === 'stroke' ? strokePath(object) : shapePath(object)),
    [
      object.kind,
      object.geometry,
      object.transform.width,
      object.transform.height,
      object.style.strokeWidth,
    ],
  );
  const head = arrowHead(object),
    s = object.style;
  if (object.kind === 'text')
    return (
      <foreignObject
        width={object.transform.width}
        height={object.transform.height}
      >
        <div
          style={{
            fontSize: object.geometry.fontSize,
            fontFamily: object.geometry.fontFamily,
            color: object.geometry.color,
            textAlign: object.geometry.align,
            lineHeight: 1.4,
            overflowWrap: 'anywhere',
          }}
          dangerouslySetInnerHTML={{
            __html: textDocumentHtml(
              object.geometry.document,
              object.geometry.align,
            ),
          }}
        />
      </foreignObject>
    );
  return (
    <g opacity={s.opacity}>
      {object.kind === 'stroke' && object.geometry.erasures?.length ? (
        <defs>
          <clipPath id={clipId}>
            <path d={path} clipRule="evenodd" />
          </clipPath>
        </defs>
      ) : null}
      <path
        d={path}
        fillRule={
          object.kind === 'stroke' && object.geometry.erasures?.length
            ? 'evenodd'
            : undefined
        }
        fill={
          object.kind === 'stroke' ? (s.stroke ?? 'none') : (s.fill ?? 'none')
        }
        stroke={object.kind === 'stroke' ? 'none' : (s.stroke ?? 'none')}
        strokeWidth={s.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={s.strokePattern === 'dashed' ? '6 4' : undefined}
        style={{ pointerEvents: hit ? 'visiblePainted' : 'none' }}
      />
      {head && (
        <path
          d={head}
          fill="none"
          stroke={s.stroke ?? 'none'}
          strokeWidth={s.strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ pointerEvents: hit ? 'stroke' : 'none' }}
        />
      )}
      {hit && (
        <path
          d={path}
          fill={
            object.kind === 'stroke'
              ? 'transparent'
              : s.fill
                ? 'transparent'
                : 'none'
          }
          stroke="transparent"
          strokeWidth={Math.max(s.strokeWidth, 10 / zoom)}
          fillRule="evenodd"
          clipPath={
            object.kind === 'stroke' && object.geometry.erasures?.length
              ? `url(#${clipId})`
              : undefined
          }
          style={{
            pointerEvents:
              object.kind === 'stroke' ? 'all' : s.fill ? 'all' : 'stroke',
          }}
        />
      )}
    </g>
  );
}
export const DrawingNode = memo(function DrawingNode(
  props: NodeProps<DrawingCanvasNode>,
) {
  return props.data.object.kind === 'text' ? (
    <TextDrawingNode {...props} object={props.data.object} />
  ) : (
    <GraphicDrawingNode {...props} />
  );
});
const GraphicDrawingNode = memo(function GraphicDrawingNode({
  data,
  selected,
}: NodeProps<DrawingCanvasNode>) {
  const [draft, setDraft] = useState<DrawingObject | null>(null),
    flow = useReactFlow();
  const draftRef = useRef<DrawingObject | null>(null);
  const gesture = useRef<{
    pointerId: number;
    handle: string;
    object: DrawingObject;
    start: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    const cancel = () => {
      if (!gesture.current) return;
      gesture.current = null;
      draftRef.current = null;
      setDraft(null);
      data.onGesture(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('canvas-clipboard-paste', cancel);
    window.addEventListener('keydown', escape, true);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      window.removeEventListener('canvas-clipboard-paste', cancel);
      window.removeEventListener('keydown', escape, true);
    };
  }, [data.onGesture]);
  const erasePreview = useContext(EraserPreviewContext).get(data.object.id);
  const preview =
    erasePreview?.generation === data.object.generation
      ? erasePreview
      : undefined;
  const object = draft ?? preview?.object ?? data.object,
    t = object.transform,
    base = drawingBounds(data.object),
    z = data.zoom;
  const patch = (next: DrawingObject, original: DrawingObject) =>
    data.onPatch({
      id: original.id,
      generation: original.generation,
      transform: next.transform,
      ...(next.geometry !== original.geometry
        ? { geometry: next.geometry, expectedGeometry: original.geometry }
        : {}),
    });
  return (
    <div
      className="drawing-node"
      data-erase-pending={preview && !preview.object ? 'true' : undefined}
      style={preview && !preview.object ? { opacity: 0.3 } : undefined}
      aria-label={drawingName(object)}
      onContextMenu={(e) => {
        e.preventDefault();
        data.onContext();
      }}
    >
      <svg
        width={base.width}
        height={base.height}
        overflow="visible"
        className="drawing-node__svg"
      >
        <g
          transform={`translate(${t.x - base.x} ${t.y - base.y}) rotate(${t.rotation} ${t.width / 2} ${t.height / 2})`}
        >
          <DrawingGraphic object={object} hit zoom={z} />
          {selected && !data.locked && (
            <g
              className="drawing-handles nodrag nopan"
              opacity="1"
              onPointerDown={(e) => {
                const handle = (e.target as Element).getAttribute(
                  'data-handle',
                );
                if (!handle) return;
                e.preventDefault();
                e.stopPropagation();
                gesture.current = {
                  pointerId: e.pointerId,
                  handle,
                  object: data.object,
                  start: flow.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }),
                };
                e.currentTarget.setPointerCapture(e.pointerId);
                data.onGesture(true);
              }}
              onPointerMove={(e) => {
                const g = gesture.current;
                if (!g || g.pointerId !== e.pointerId) return;
                e.preventDefault();
                e.stopPropagation();
                const p = flow.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }),
                  o = g.object,
                  a = o.transform,
                  c = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
                let tr: DrawingTransform = { ...a };
                let geometry = o.geometry;
                if (g.handle === 'rotate') {
                  let angle =
                    (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
                  if (e.shiftKey) angle = Math.round(angle / 15) * 15;
                  tr.rotation = (angle + 360) % 360;
                } else if (g.handle.startsWith('end')) {
                  if (o.kind !== 'shape' || !o.geometry.endpoints) return;
                  const i = Number(g.handle.slice(3)),
                    other = o.geometry.endpoints[1 - i],
                    fixed = rotatePoint(
                      {
                        x: a.x + other[0] * a.width,
                        y: a.y + other[1] * a.height,
                      },
                      a.rotation,
                      c,
                    );
                  let dx = p.x - fixed.x,
                    dy = p.y - fixed.y;
                  if (e.shiftKey) {
                    const l = Math.hypot(dx, dy),
                      ang =
                        (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) *
                          Math.PI) /
                        4;
                    dx = l * Math.cos(ang);
                    dy = l * Math.sin(ang);
                  }
                  const moving = { x: fixed.x + dx, y: fixed.y + dy };
                  tr = {
                    x: Math.min(fixed.x, moving.x),
                    y: Math.min(fixed.y, moving.y),
                    width: Math.max(1, Math.abs(dx)),
                    height: Math.max(1, Math.abs(dy)),
                    rotation: 0,
                  };
                  const ep = [fixed, moving].map(
                    (v) =>
                      [(v.x - tr.x) / tr.width, (v.y - tr.y) / tr.height] as [
                        number,
                        number,
                      ],
                  );
                  geometry = {
                    ...o.geometry,
                    endpoints: (i === 0 ? [ep[1], ep[0]] : ep) as [
                      [number, number],
                      [number, number],
                    ],
                  };
                } else {
                  const local = rotatePoint(p, -a.rotation, c),
                    start = rotatePoint(g.start, -a.rotation, c),
                    dx = local.x - start.x,
                    dy = local.y - start.y;
                  const left = g.handle.includes('w'),
                    right = g.handle.includes('e'),
                    top = g.handle.includes('n'),
                    bottom = g.handle.includes('s');
                  let w = Math.max(4, a.width + (right ? dx : left ? -dx : 0)),
                    h = Math.max(4, a.height + (bottom ? dy : top ? -dy : 0));
                  if (e.shiftKey) {
                    if (Math.abs(w - a.width) > Math.abs(h - a.height))
                      h = (w * a.height) / a.width;
                    else w = (h * a.width) / a.height;
                  }
                  if (e.altKey) {
                    w = Math.max(4, a.width + (w - a.width) * 2);
                    h = Math.max(4, a.height + (h - a.height) * 2);
                  }
                  const center = e.altKey
                    ? c
                    : rotatePoint(
                        {
                          x:
                            c.x +
                            (left
                              ? -(w - a.width) / 2
                              : right
                                ? (w - a.width) / 2
                                : 0),
                          y:
                            c.y +
                            (top
                              ? -(h - a.height) / 2
                              : bottom
                                ? (h - a.height) / 2
                                : 0),
                        },
                        a.rotation,
                        c,
                      );
                  tr = {
                    ...a,
                    x: center.x - w / 2,
                    y: center.y - h / 2,
                    width: w,
                    height: h,
                  };
                }
                draftRef.current = {
                  ...o,
                  transform: tr,
                  geometry,
                } as DrawingObject;
                setDraft(draftRef.current);
              }}
              onPointerUp={(e) => {
                if (gesture.current?.pointerId !== e.pointerId) return;
                e.preventDefault();
                e.stopPropagation();
                const original = gesture.current.object;
                gesture.current = null;
                if (draftRef.current) patch(draftRef.current, original);
                draftRef.current = null;
                data.onGesture(false);
                setDraft(null);
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                gesture.current = null;
                draftRef.current = null;
                data.onGesture(false);
                setDraft(null);
              }}
              onLostPointerCapture={() => {
                gesture.current = null;
                draftRef.current = null;
                data.onGesture(false);
                setDraft(null);
              }}
            >
              <rect
                x="0"
                y="0"
                width={t.width}
                height={t.height}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1 / z}
                pointerEvents="none"
              />
              {(object.kind === 'shape' && object.geometry.endpoints
                ? object.geometry.endpoints.map((p, i) => ({
                    name: `end${i}`,
                    x: p[0] * t.width,
                    y: p[1] * t.height,
                  }))
                : [
                    { name: 'nw', x: 0, y: 0 },
                    { name: 'n', x: t.width / 2, y: 0 },
                    { name: 'ne', x: t.width, y: 0 },
                    { name: 'e', x: t.width, y: t.height / 2 },
                    { name: 'se', x: t.width, y: t.height },
                    { name: 's', x: t.width / 2, y: t.height },
                    { name: 'sw', x: 0, y: t.height },
                    { name: 'w', x: 0, y: t.height / 2 },
                  ]
              ).map((h) => (
                <rect
                  key={h.name}
                  data-handle={h.name}
                  x={h.x - 4 / z}
                  y={h.y - 4 / z}
                  width={8 / z}
                  height={8 / z}
                  fill="white"
                  stroke="#3b82f6"
                  strokeWidth={1 / z}
                  style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                />
              ))}
              <line
                x1={t.width / 2}
                y1="0"
                x2={t.width / 2}
                y2={-24 / z}
                stroke="#3b82f6"
                strokeWidth={1 / z}
              />
              <circle
                data-handle="rotate"
                cx={t.width / 2}
                cy={-24 / z}
                r={5 / z}
                fill="white"
                stroke="#3b82f6"
                strokeWidth={1 / z}
                style={{ pointerEvents: 'all', cursor: 'grab' }}
              />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
});
