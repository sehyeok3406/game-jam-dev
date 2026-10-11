import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  drawingBounds,
  shapeFromDrag,
  strokeGeometry,
  strokeHit,
  type Point,
} from '../../drawing-geometry';
import { MAX_DRAWING_POINTS } from '../../drawing-model';
import type {
  DrawingItem,
  DrawingObject,
  DrawingStyle,
  DrawingTool,
} from '../../drawing-types';
import { DrawingGraphic } from './DrawingNode';
export function DrawingInputLayer({
  tool,
  style,
  enabled,
  scope,
  canvasId,
  items,
  pressure,
  touch,
  onCreate,
  onErase,
  onPartial,
  onFinished,
  onGesture,
}: {
  tool: DrawingTool;
  style: DrawingStyle;
  enabled: boolean;
  scope: string;
  canvasId: string;
  items: DrawingItem[];
  pressure: boolean;
  touch: boolean;
  onCreate: (o: DrawingObject) => void;
  onErase: (targets: { id: string; generation: string }[]) => void;
  onPartial: (o: DrawingObject | null) => void;
  onFinished: () => void;
  onGesture: (active: boolean) => void;
}) {
  const flow = useReactFlow(),
    [draft, setDraft] = useState<DrawingObject | null>(null),
    [cursor, setCursor] = useState<Point | null>(null),
    [count, setCount] = useState(0),
    [limit, setLimit] = useState(false);
  const gesture = useRef<{
    pointerId: number;
    start: Point;
    screen: Point;
    last: Point;
    points: [number, number, number][];
    object: DrawingObject;
    erased: Map<string, string>;
    backupAt: number;
    zoom: number;
    shift: boolean;
    alt: boolean;
  } | null>(null);
  const frame = useRef<number | null>(null),
    element = useRef<HTMLDivElement>(null);
  const cancel = () => {
    const active = !!gesture.current;
    gesture.current = null;
    setDraft(null);
    setCount(0);
    setLimit(false);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    onGesture(false);
    if (active) onPartial(null);
  };
  useEffect(() => {
    cancel();
  }, [enabled, tool, scope, canvasId]);
  useEffect(() => {
    window.addEventListener('blur', cancel);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current) {
        e.stopImmediatePropagation();
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', esc, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  });
  if (!enabled) return null;
  const p = (e: { clientX: number; clientY: number }) =>
    flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const update = (end: Point, shift: boolean, alt: boolean) => {
    const g = gesture.current;
    if (!g) return;
    if (tool === 'eraser') {
      for (const o of items)
        if (
          o.canvasId === canvasId &&
          o.kind === 'stroke' &&
          strokeHit(o, g.last, end, 8 / g.zoom)
        )
          g.erased.set(o.id, o.generation);
      g.last = end;
      setCount(g.erased.size);
      return;
    }
    const geometry =
      tool === 'pen' || tool === 'highlighter'
        ? strokeGeometry(g.points, tool, pressure && tool === 'pen')
        : shapeFromDrag(tool, g.start, end, shift, alt);
    g.object = { ...g.object, ...geometry } as DrawingObject;
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (gesture.current) setDraft(gesture.current.object);
      });
    if (Date.now() - g.backupAt > 300) {
      g.backupAt = Date.now();
      onPartial(g.object);
    }
  };
  const vp = flow.getViewport(),
    bounds = draft ? drawingBounds(draft) : null;
  return (
    <div
      className={`drawing-input-layer drawing-input-layer--${tool}`}
      ref={element}
      aria-label={`${tool === 'eraser' ? '획 지우개' : '그리기'} 입력 영역`}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (
          e.button !== 0 ||
          gesture.current ||
          (e.pointerType === 'touch' && !touch)
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        const start = p(e),
          id = crypto.randomUUID(),
          now = Date.now();
        const stroke = tool === 'pen' || tool === 'highlighter';
        const object = {
          id,
          generation: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          order:
            Math.max(
              0,
              ...items
                .filter((o) => o.canvasId === canvasId)
                .map((o) => o.order),
            ) + 1,
          layer: stroke ? 'annotation' : 'background',
          style: {
            ...style,
            ...(stroke || tool === 'line' || tool === 'arrow'
              ? { fill: null }
              : {}),
          },
          kind: stroke ? 'stroke' : 'shape',
          ...(stroke
            ? strokeGeometry(
                [
                  [
                    start.x,
                    start.y,
                    pressure && e.pointerType === 'pen' ? e.pressure : 0.5,
                  ],
                ],
                tool,
                pressure && tool === 'pen',
              )
            : shapeFromDrag(
                tool === 'eraser' ? 'rectangle' : tool,
                start,
                start,
                false,
                false,
                true,
              )),
        } as DrawingObject;
        gesture.current = {
          pointerId: e.pointerId,
          start,
          screen: { x: e.clientX, y: e.clientY },
          last: start,
          points: [
            [
              start.x,
              start.y,
              pressure && e.pointerType === 'pen' ? e.pressure : 0.5,
            ],
          ],
          object,
          erased: new Map(),
          backupAt: Date.now(),
          zoom: flow.getZoom(),
          shift: e.shiftKey,
          alt: e.altKey,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        onGesture(true);
        setLimit(false);
        if (tool !== 'eraser') {
          setDraft(object);
          onPartial(object);
        } else update(start, false, false);
      }}
      onPointerMove={(e) => {
        setCursor({ x: e.clientX, y: e.clientY });
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        if (tool === 'pen' || tool === 'highlighter') {
          const native = e.nativeEvent;
          const coalesced = native.getCoalescedEvents?.() ?? [],
            events = coalesced.length ? coalesced : [native];
          for (const sample of events) {
            if (g.points.length >= MAX_DRAWING_POINTS) {
              setLimit(true);
              break;
            }
            const pt = p(sample),
              pr =
                pressure && sample.pointerType === 'pen'
                  ? Math.max(0, Math.min(1, sample.pressure))
                  : 0.5,
              last = g.points.at(-1)!;
            if (
              Math.hypot(pt.x - last[0], pt.y - last[1]) * g.zoom > 0.5 ||
              Math.abs(pr - last[2]) > 0.05
            )
              g.points.push([pt.x, pt.y, pr]);
          }
        }
        g.shift = e.shiftKey;
        g.alt = e.altKey;
        update(p(e), e.shiftKey, e.altKey);
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const end = p(e),
          click =
            Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) <= 5;
        if (tool === 'pen' || tool === 'highlighter') {
          if (g.points.length < MAX_DRAWING_POINTS)
            g.points.push([
              end.x,
              end.y,
              pressure && e.pointerType === 'pen' ? e.pressure : 0.5,
            ]);
          update(end, false, false);
        } else if (tool === 'eraser') update(end, false, false);
        else
          g.object = {
            ...g.object,
            ...shapeFromDrag(tool, g.start, end, e.shiftKey, e.altKey, click),
          } as DrawingObject;
        gesture.current = null;
        setDraft(null);
        onGesture(false);
        setCount(0);
        setLimit(false);
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (tool === 'eraser') {
          if (g.erased.size)
            onErase(
              [...g.erased].map(([id, generation]) => ({ id, generation })),
            );
        } else if (
          click ||
          g.object.kind === 'stroke' ||
          (tool === 'line' || tool === 'arrow' ? Math.max : Math.min)(
            g.object.transform.width,
            g.object.transform.height,
          ) >= 4
        ) {
          onCreate(g.object);
          onFinished();
        } else onPartial(null);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (gesture.current) cancel();
      }}
    >
      {draft && bounds && (
        <svg className="drawing-input-layer__preview">
          <g
            transform={`translate(${vp.x} ${vp.y}) scale(${vp.zoom}) translate(${draft.transform.x} ${draft.transform.y})`}
          >
            <DrawingGraphic object={draft} />
          </g>
        </svg>
      )}
      {tool === 'eraser' && cursor && (
        <span
          className="drawing-eraser-cursor"
          style={{
            left:
              cursor.x - (element.current?.getBoundingClientRect().left ?? 0),
            top: cursor.y - (element.current?.getBoundingClientRect().top ?? 0),
          }}
        />
      )}
      {(count > 0 || limit) && (
        <span className="drawing-input-status">
          {limit
            ? '획 길이 한도입니다. 포인터를 놓아 저장하세요.'
            : `${count}개 획 지우기`}
        </span>
      )}
    </div>
  );
}
