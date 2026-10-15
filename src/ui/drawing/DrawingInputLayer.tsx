import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  drawingBounds,
  shapeFromDrag,
  strokeGeometry,
  strokeHit,
  eraseRegion,
  withErasure,
  type Point,
} from '../../drawing-geometry';
import { MAX_DRAWING_POINTS } from '../../drawing-model';
import type {
  DrawingItem,
  DrawingObject,
  DrawingStyle,
  DrawingTool,
  EraserMode,
  DrawingErasure,
} from '../../drawing-types';
import { DrawingGraphic } from './DrawingNode';
import type { EraserPreview } from './eraserPreview';
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
  eraserMode,
  eraserSize,
  onErasePreview,
  onErasePartial,
  onError,
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
  eraserMode: EraserMode;
  eraserSize: number;
  onErasePreview: (preview: EraserPreview) => void;
  onErasePartial: (erasures: DrawingErasure[]) => void;
  onError: (message: string) => void;
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
    partial: Map<string, DrawingErasure>;
    samples: number;
    eraseId: string;
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
    onErasePreview(new Map());
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    onGesture(false);
    if (active) onPartial(null);
  };
  useEffect(() => {
    cancel();
  }, [enabled, tool, scope, canvasId, eraserMode, eraserSize]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      onErasePreview(new Map());
    },
    [onErasePreview],
  );
  useEffect(() => {
    const g = gesture.current;
    if (!g) {
      onErasePreview(new Map());
      return;
    }
    for (const e of g.partial.values()) {
      const current = items.find(
        (o) => o.id === e.id && o.generation === e.generation,
      );
      if (
        !current ||
        JSON.stringify(current.transform) !==
          JSON.stringify(e.expectedTransform) ||
        current.style.strokeWidth !== e.expectedStrokeWidth ||
        JSON.stringify(
          current.kind === 'stroke'
            ? { ...current.geometry, erasures: undefined }
            : null,
        ) !== JSON.stringify({ ...e.expectedGeometry, erasures: undefined })
      ) {
        cancel();
        onError('획이 변경되어 지우기를 취소했습니다. 다시 시도해주세요.');
        return;
      }
    }
    for (const [id, generation] of g.erased)
      if (!items.some((o) => o.id === id && o.generation === generation))
        g.erased.delete(id);
    setCount(g.erased.size);
    const preview: EraserPreview = new Map();
    for (const o of items)
      if (g.erased.get(o.id) === o.generation)
        preview.set(o.id, {
          generation: o.generation,
          object:
            o.kind === 'stroke' && g.partial.has(o.id)
              ? withErasure(o, g.partial.get(o.id)!.region)
              : undefined,
        });
    onErasePreview(preview);
  }, [items]);
  useEffect(() => {
    window.addEventListener('blur', cancel);
    window.addEventListener('canvas-clipboard-paste', cancel);
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
      window.removeEventListener('canvas-clipboard-paste', cancel);
      window.removeEventListener('keydown', esc, true);
    };
  });
  if (!enabled) return null;
  const p = (e: { clientX: number; clientY: number }) =>
    flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const update = (end: Point, shift: boolean, alt: boolean) => {
    const g = gesture.current;
    if (!g) return;
    if (tool === 'eraser') {
      if (g.samples >= 2000) {
        setLimit(true);
        return;
      }
      g.samples++;
      try {
        let changed = false;
        for (const o of items)
          if (
            o.canvasId === canvasId &&
            o.kind === 'stroke' &&
            (!g.erased.has(o.id) ||
              (eraserMode === 'partial' &&
                g.erased.get(o.id) === o.generation)) &&
            strokeHit(
              o,
              g.last,
              end,
              (eraserMode === 'partial' ? eraserSize / 2 : 8) / g.zoom,
            )
          ) {
            if (!g.erased.has(o.id)) changed = true;
            g.erased.set(o.id, o.generation);
            if (eraserMode === 'partial') {
              const previous = g.partial.get(o.id);
              const region = eraseRegion(
                o,
                g.last,
                end,
                eraserSize / (2 * g.zoom),
                g.eraseId,
                previous?.region,
              );
              g.partial.set(o.id, {
                id: o.id,
                generation: o.generation,
                expectedTransform: previous?.expectedTransform ?? o.transform,
                expectedGeometry: previous?.expectedGeometry ?? o.geometry,
                expectedStrokeWidth:
                  previous?.expectedStrokeWidth ?? o.style.strokeWidth,
                region,
              });
              changed = true;
            }
          }
        g.last = end;
        setCount(g.erased.size);
        if (changed && frame.current === null)
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (gesture.current !== g) return;
            const preview: EraserPreview = new Map();
            for (const o of items)
              if (g.erased.get(o.id) === o.generation)
                preview.set(o.id, {
                  generation: o.generation,
                  object:
                    o.kind === 'stroke' && g.partial.has(o.id)
                      ? withErasure(o, g.partial.get(o.id)!.region)
                      : undefined,
                });
            onErasePreview(preview);
          });
      } catch (error) {
        cancel();
        onError(
          `지우기 미리보기 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
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
      tabIndex={-1}
      aria-label={`${tool === 'eraser' ? (eraserMode === 'partial' ? '부분 지우개' : '획 지우개') : '그리기'} 입력 영역`}
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
        e.currentTarget.focus({ preventScroll: true });
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
          partial: new Map(),
          samples: 0,
          eraseId: crypto.randomUUID(),
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
        if (tool === 'eraser') {
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
          for (const sample of events.length ? events : [e.nativeEvent])
            update(p(sample), false, false);
          return;
        }
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
        if (!gesture.current) return;
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
          if (eraserMode === 'partial' && g.partial.size)
            onErasePartial([...g.partial.values()]);
          else if (g.erased.size)
            onErase(
              [...g.erased].map(([id, generation]) => ({ id, generation })),
            );
          else onErasePreview(new Map());
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
            width: eraserMode === 'partial' ? eraserSize : 16,
            height: eraserMode === 'partial' ? eraserSize : 16,
            left:
              cursor.x - (element.current?.getBoundingClientRect().left ?? 0),
            top: cursor.y - (element.current?.getBoundingClientRect().top ?? 0),
          }}
        />
      )}
      {(count > 0 || limit) && (
        <span className="drawing-input-status">
          {limit
            ? '입력 한도입니다. 포인터를 놓아 저장하거나 Esc로 취소하세요.'
            : eraserMode === 'stroke'
              ? `${count}개 획 삭제 예정 · 놓으면 삭제 · Esc 취소`
              : `${count}개 획 부분 지우기 · 놓으면 적용 · Esc 취소`}
        </span>
      )}
    </div>
  );
}
