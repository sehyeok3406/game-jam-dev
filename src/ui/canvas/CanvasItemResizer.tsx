import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { NodeResizer, useNodeId, useReactFlow } from '@xyflow/react';
import { PREVIEW_PRESETS } from '../../preview-window';
import type { CanvasNode } from '../workspace/workspace-types';
import { resizeGroup, type ResizeBox } from './group-resize';

const ResizeContext = createContext<null | {
  save: (nodes: CanvasNode[]) => Promise<void>;
  scope: string;
}>(null);

export function CanvasResizeProvider({
  save,
  scope,
  children,
}: {
  save: (nodes: CanvasNode[]) => Promise<void>;
  scope: string;
  children: ReactNode;
}) {
  return (
    <ResizeContext.Provider value={{ save, scope }}>
      {children}
    </ResizeContext.Provider>
  );
}

function boxFor(node: CanvasNode): ResizeBox | null {
  if (node.hidden || node.className?.includes('section-member-hidden'))
    return null;
  const data = node.data;
  if (data.kind === 'document') {
    if (data.layoutLocked || data.document.collapsed) return null;
    return {
      id: node.id,
      ...node.position,
      width: node.measured?.width ?? data.document.width,
      height: node.measured?.height ?? data.document.height,
      minWidth: 260,
      minHeight: 180,
    };
  }
  if (data.kind === 'preview') {
    if (
      data.locked ||
      data.windowState.collapsed ||
      PREVIEW_PRESETS.some((preset) => preset.id === data.windowState.presetId)
    )
      return null;
    return {
      id: node.id,
      ...node.position,
      width: node.measured?.width ?? data.windowState.width,
      height: node.measured?.height ?? data.windowState.height,
      minWidth: 420,
      minHeight: 300,
    };
  }
  return null;
}

/** File and HTML cards share a gesture; other node types keep their own resizers. */
export function CanvasItemResizer(props: ComponentProps<typeof NodeResizer>) {
  const id = useNodeId();
  const flow = useReactFlow<CanvasNode>();
  const context = useContext(ResizeContext);
  const live = useRef({ flow, context, props });
  live.current = { flow, context, props };
  const gestureRoot = useRef<HTMLElement | null>(null);
  const releasePointerShield = useCallback(() => {
    if (gestureRoot.current) delete gestureRoot.current.dataset.canvasResizing;
    gestureRoot.current = null;
  }, []);
  const mounted = useRef(true);
  const session = useRef<null | {
    scope: string;
    primary: ResizeBox;
    nodes: CanvasNode[];
    boxes: ResizeBox[];
    latest: ResizeBox[];
  }>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current = null;
      releasePointerShield();
    };
  }, [context?.scope, releasePointerShield]);
  const valid = useCallback(() => {
    const current = session.current;
    if (!current || current.scope !== live.current.context?.scope) return false;
    return current.nodes.every((node) => {
      const now = live.current.flow.getNode(node.id);
      return now && boxFor(now) !== null;
    });
  }, []);
  const apply = useCallback((boxes: ResizeBox[], resizing: boolean) => {
    if (!mounted.current) return;
    const changed = new Map(boxes.map((box) => [box.id, box]));
    live.current.flow.setNodes((nodes) =>
      nodes.map((node) => {
        const box = changed.get(node.id);
        return box
          ? {
              ...node,
              position: { x: box.x, y: box.y },
              style: { ...node.style, width: box.width, height: box.height },
              width: box.width,
              height: box.height,
              measured: { width: box.width, height: box.height },
              resizing,
            }
          : node;
      }),
    );
  }, []);
  const start: NonNullable<
    ComponentProps<typeof NodeResizer>['onResizeStart']
  > = useCallback(
    (event, params) => {
      releasePointerShield();
      const target = event.sourceEvent.target;
      if (target instanceof Element) {
        gestureRoot.current = target.closest<HTMLElement>('.react-flow');
        if (gestureRoot.current)
          gestureRoot.current.dataset.canvasResizing = 'true';
      }
      session.current = null;
      const { flow, context } = live.current;
      const primaryNode = id ? flow.getNode(id) : undefined;
      if (!context || !primaryNode?.selected) return;
      const nodes = flow
        .getNodes()
        .filter((node) => node.selected && boxFor(node));
      if (nodes.length < 2) return;
      const boxes = nodes.map((node) => boxFor(node)!);
      const primary = boxes.find((box) => box.id === id)!;
      // The resizer's start snapshot is authoritative for the dragged card.
      Object.assign(primary, params);
      session.current = {
        scope: context.scope,
        primary,
        nodes,
        boxes,
        latest: boxes,
      };
    },
    [id, releasePointerShield],
  );
  const shouldResize: NonNullable<
    ComponentProps<typeof NodeResizer>['shouldResize']
  > = useCallback(
    (_event, params) => {
      const current = session.current;
      if (!current) return true;
      if (!valid()) return false;
      // We control the primary card too so a large pointer jump still stops every
      // card exactly at the shared minimum rather than accepting a partial delta.
      current.latest = resizeGroup(current.boxes, current.primary, params);
      apply(current.latest, true);
      return false;
    },
    [apply, valid],
  );
  const end: NonNullable<ComponentProps<typeof NodeResizer>['onResizeEnd']> =
    useCallback(
      (event, params) => {
        releasePointerShield();
        if (!mounted.current) return;
        const current = session.current;
        if (!current) {
          live.current.props.onResizeEnd?.(event, params);
          return;
        }
        const allowed = valid();
        session.current = null;
        if (current.scope !== live.current.context?.scope) return;
        apply(allowed ? current.latest : current.boxes, false);
        // XYFlow emits its own final measurement after this callback, using the
        // unchanged native size because shouldResize handled the group itself.
        requestAnimationFrame(() => {
          if (current.scope === live.current.context?.scope)
            apply(allowed ? current.latest : current.boxes, false);
        });
        if (!allowed) return;
        const changed = new Map(current.latest.map((box) => [box.id, box]));
        const nodes = current.nodes.map((node) => {
          const box = changed.get(node.id)!;
          return {
            ...node,
            position: { x: box.x, y: box.y },
            measured: { width: box.width, height: box.height },
            style: { ...node.style, width: box.width, height: box.height },
          };
        });
        if (
          current.latest.some((box, index) =>
            ['x', 'y', 'width', 'height'].some(
              (key) => box[key as 'x'] !== current.boxes[index][key as 'x'],
            ),
          )
        )
          void live.current.context?.save(nodes);
      },
      [apply, valid, releasePointerShield],
    );
  return (
    <NodeResizer
      {...props}
      onResizeStart={start}
      shouldResize={shouldResize}
      onResizeEnd={end}
    />
  );
}
