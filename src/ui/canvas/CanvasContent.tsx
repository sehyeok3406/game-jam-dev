import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useNodeId } from '@xyflow/react';
import { useOptionalCanvasViewport } from './CanvasViewport';
import { sameContentRevision } from './content-cache.ts';
import './canvas-content.css';

export function useCanvasProtection(protectedState: boolean) {
  const store = useOptionalCanvasViewport(),
    id = useNodeId();
  useLayoutEffect(
    () => (protectedState && store && id ? store.protect(id) : undefined),
    [store, id, protectedState],
  );
}

/** Selection geometry stays logical for every node. Only a sole selection
 * requests an idle editor; a live edit/draft is protected independently. */
export function useCanvasSoleSelection(selected: boolean) {
  const store = useOptionalCanvasViewport(),
    id = useNodeId();
  const subscribe = useCallback(
    (notify: () => void) =>
      store ? store.subscribePreparation(notify) : () => {},
    [store],
  );
  const read = useCallback(
    () => selected && (!store || (!!id && store.isSoleSelected(id))),
    [store, id, selected],
  );
  return useSyncExternalStore(subscribe, read, read);
}

export function useCanvasMode() {
  const store = useOptionalCanvasViewport(),
    id = useNodeId();
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!store || !id) return () => {};
      const stopRanges = store.subscribe(notify),
        stopPlan = store.subscribePreparation(notify);
      return () => {
        stopRanges();
        stopPlan();
      };
    },
    [store, id],
  );
  const read = useCallback(
    () => (store && id ? store.contentMode(id) : 2),
    [store, id],
  );
  return useSyncExternalStore(subscribe, read, read);
}

export function CanvasContentGate({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const mode = useCanvasMode();
  const [interacting, setInteracting] = useState(false);
  useCanvasProtection(interacting);
  useEffect(() => {
    if (!interacting) return;
    const finish = () => setInteracting(false);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('dragend', finish, true);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('dragend', finish, true);
      window.removeEventListener('blur', finish);
    };
  }, [interacting]);
  const detailed = useRef(false);
  const show = mode === 2 || (mode === 3 && detailed.current);
  detailed.current = show;
  return (
    <div
      className="canvas-detail-region"
      onPointerDownCapture={() => setInteracting(true)}
      onDragStartCapture={() => setInteracting(true)}
      data-canvas-detail={show ? 'detail' : mode === 0 ? 'far' : 'summary'}
    >
      {show ? children : <CanvasContentSummary label={label} />}
    </div>
  );
}

export function CanvasContentSummary({ label }: { label: string }) {
  return (
    <div className="canvas-content-summary" aria-label={label}>
      <span>{label}</span>
      <i />
      <i />
      <i />
    </div>
  );
}

export function CanvasSvgContentGate({
  children,
  label,
  width,
  height,
}: {
  children: ReactNode;
  label: string;
  width: number;
  height: number;
}) {
  const mode = useCanvasMode(),
    detailed = useRef(false);
  const show = mode === 2 || (mode === 3 && detailed.current);
  detailed.current = show;
  return (
    <g data-canvas-detail={show ? 'detail' : mode === 0 ? 'far' : 'summary'}>
      {show ? (
        children
      ) : (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill="#667085"
          fontSize={Math.max(16, width / 50)}
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** One small selector per resource; prepared trees/paths are retained by the bounded cache.
 * A currently displayed value can also live in its mounted owner until it leaves retention. */
export function useCanvasResource<T>(
  key: string,
  parts: readonly unknown[],
  prepare: (signal: AbortSignal) => T | Promise<T>,
  estimate: (value: T) => number,
  prepareSummary = false,
) {
  const store = useOptionalCanvasViewport(),
    id = useNodeId();
  const revision = useRef(parts);
  if (!sameContentRevision(revision.current, parts)) revision.current = parts;
  const input = revision.current;
  const latest = useRef({ input, prepare, estimate });
  latest.current = { input, prepare, estimate };
  const ready = useRef<{ input: readonly unknown[]; value: T } | null>(null);
  const failure = useRef<{ input: readonly unknown[]; error: string } | null>(
    null,
  );
  const owner = useRef(store);
  if (owner.current !== store) {
    ready.current = null;
    failure.current = null;
    owner.current = store;
  }
  const [attempt, retry] = useState(0);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!store || !id) return () => {};
      const stops = [
        store.subscribe(notify),
        store.subscribePreparation(notify),
        store.content.subscribe(key, notify),
      ];
      return () => stops.forEach((stop) => stop());
    },
    [store, id, key],
  );
  const read = useCallback(
    () =>
      `${store && id ? store.contentMode(id) : 2}:${store?.content.version(key) ?? 0}:${store && id && store.getSnapshot().visible.has(id) ? 1 : 0}`,
    [store, id, key],
  );
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const mode = Number(snapshot.split(':')[0]);
  const visible = snapshot.endsWith(':1');
  if (ready.current && !sameContentRevision(ready.current.input, input))
    ready.current = null;
  if (mode === 0 || (mode === 1 && !prepareSummary)) ready.current = null;
  const cached = store?.content.peek<T>(key, input);
  const value =
    mode === 2 || mode === 3 || (mode === 1 && prepareSummary)
      ? (ready.current?.value ?? cached)
      : undefined;
  if (value !== undefined && !ready.current) ready.current = { input, value };
  const hasValue = value !== undefined;
  useLayoutEffect(() => {
    if (
      !store ||
      !id ||
      (mode !== 2 && !(mode === 1 && prepareSummary)) ||
      hasValue
    )
      return;
    let active = true;
    const stop = store.preparations.register(
      id,
      input,
      {
        isCurrent: () =>
          active &&
          latest.current.input === input &&
          (store.contentMode(id) === 2 ||
            (prepareSummary && store.contentMode(id) === 1)),
        prepare: ({ signal }) => {
          const result = latest.current.prepare(signal);
          return result instanceof Promise
            ? result.then((value) => ({ done: true as const, value }))
            : { done: true, value: result };
        },
        commit: (value) => {
          ready.current = { input, value };
          failure.current = null;
          store.content.put(key, input, value, latest.current.estimate(value));
        },
        error: (error) => {
          failure.current = {
            input,
            error: error instanceof Error ? error.message : String(error),
          };
          store.content.signal(key);
        },
      },
      key,
    );
    return () => {
      active = false;
      stop();
    };
  }, [store, id, key, input, mode, hasValue, attempt, prepareSummary]);
  useLayoutEffect(() => {
    if (hasValue) store?.content.touch(key);
  }, [store, key, hasValue, input]);
  useLayoutEffect(
    () => (hasValue && visible ? store?.content.pin(key) : undefined),
    [store, key, hasValue, visible],
  );
  return {
    value,
    managed: !!store && !!id,
    error:
      failure.current && sameContentRevision(failure.current.input, input)
        ? failure.current.error
        : '',
    retry: () => retry((value) => value + 1),
  };
}
