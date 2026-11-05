import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useStoreApi } from '@xyflow/react';
import type { CanvasNode } from '../workspace/workspace-types.ts';
import { CanvasViewportStore } from './viewport-store.ts';
import { useViewLifetime } from '../workspace/useViewLifetime.ts';
import { selectionScopeKey, type SelectionScope } from './selection-actions.ts';

const ViewportContext = createContext<CanvasViewportStore | null>(null);

export function CanvasViewportProvider({
  children,
  scope,
  searching = false,
}: {
  children: ReactNode;
  scope: SelectionScope;
  searching?: boolean;
}) {
  const isCurrent = useViewLifetime(scope);
  const store = useMemo(
    () => new CanvasViewportStore(isCurrent, selectionScopeKey(scope)),
    [isCurrent],
  );
  useLayoutEffect(() => {
    store.setSearch(searching);
  }, [store, searching]);
  return (
    <ViewportContext.Provider value={store}>
      {children}
    </ViewportContext.Provider>
  );
}

export function useCanvasViewportStore() {
  const store = useContext(ViewportContext);
  if (!store) throw new Error('CanvasViewportProvider is missing');
  return store;
}

export function useOptionalCanvasViewport() {
  return useContext(ViewportContext);
}

/** Subscribe outside React state so camera input never rebuilds node data. */
export function CanvasViewportTracker() {
  const flow = useStoreApi<CanvasNode>();
  const viewport = useCanvasViewportStore();
  useLayoutEffect(() => {
    const disconnect = viewport.connect(
      () => {
        const state = flow.getState();
        const focused =
          document.activeElement?.closest<HTMLElement>('.react-flow__node');
        return {
          camera: {
            x: state.transform[0],
            y: state.transform[1],
            zoom: state.transform[2],
            width: state.width,
            height: state.height,
          },
          nodes: state.nodeLookup.values(),
          priorityIds:
            focused?.dataset.id && state.domNode?.contains(focused)
              ? [focused.dataset.id]
              : [],
        };
      },
      {
        frame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (id) => cancelAnimationFrame(id),
        delay: (callback, ms) => window.setTimeout(callback, ms),
        cancelDelay: (id) => window.clearTimeout(id),
        now: () => performance.now(),
      },
    );
    const unsubscribe = flow.subscribe((state, previous) => {
      // This controlled canvas applies measurements, drag/resize, collapse and
      // remote updates through onNodesChange/setNodes. Camera-only input does
      // not traverse nodeLookup or document contents.
      if (
        state.nodes !== previous.nodes ||
        state.nodeOrigin !== previous.nodeOrigin
      )
        viewport.geometryChanged();
      if (
        state.transform[0] !== previous.transform[0] ||
        state.transform[1] !== previous.transform[1] ||
        state.transform[2] !== previous.transform[2] ||
        state.width !== previous.width ||
        state.height !== previous.height
      )
        viewport.schedule();
    });
    const owner = flow.getState().domNode;
    owner?.addEventListener('focusin', viewport.schedule);
    owner?.addEventListener('focusout', viewport.schedule);
    return () => {
      owner?.removeEventListener('focusin', viewport.schedule);
      owner?.removeEventListener('focusout', viewport.schedule);
      unsubscribe();
      disconnect();
    };
  }, [flow, viewport]);
  return null;
}
