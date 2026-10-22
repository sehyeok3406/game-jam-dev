import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
  type Dispatch,
} from 'react';
import {
  CanvasSelectionActions,
  selectionScopeKey,
  type SelectionScope,
  type SelectionActionPorts,
} from './selection-actions.ts';
import type { CanvasSection } from '../../contracts/canvas';
import type { DrawingObject } from '../../contracts/drawing-types';
import type { DeletionItem } from './selection-plan';

export function useSelectionScope(scope: SelectionScope): SelectionScope {
  const key = selectionScopeKey(scope);
  const current = useRef({ key, version: 0 });
  if (current.current.key !== key)
    current.current = { key, version: current.current.version + 1 };
  return { ...scope, viewEpoch: current.current.version };
}

export function useSelectionActions(
  scope: SelectionScope,
  ports: () => Omit<SelectionActionPorts, 'scope'>,
) {
  const current = useRef({ scope, ports });
  const mounted = useRef(true);
  current.current = { scope, ports };
  const [state, setState] = useState({ key: '', busy: false });
  const actions = useMemo(
    () =>
      new CanvasSelectionActions(
        () => ({ ...current.current.ports(), scope: current.current.scope }),
        (origin, busy) => {
          const key = selectionScopeKey(origin);
          if (
            mounted.current &&
            selectionScopeKey(current.current.scope) === key
          )
            setState({ key, busy });
        },
      ),
    [],
  );
  useEffect(() => {
    mounted.current = true;
    actions.activate();
    return () => {
      mounted.current = false;
      actions.dispose();
    };
  }, [actions]);
  return {
    actions,
    busy: state.key === selectionScopeKey(scope) && state.busy,
  };
}

/** Reload can finish before React Flow creates its nodes. Select once those IDs exist. */
export function useCreatedSelection<
  N extends { id: string; selected?: boolean },
>(scope: SelectionScope, nodes: N[], setNodes: Dispatch<SetStateAction<N[]>>) {
  const key = selectionScopeKey(scope);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [pending, setPending] = useState<{
    key: string;
    ids: string[];
    ready?: () => void;
  } | null>(null);
  useLayoutEffect(() => {
    if (!pending) return;
    if (pending.key !== key) {
      setPending(null);
      return;
    }
    if (!pending.ids.every((id) => nodes.some((node) => node.id === id)))
      return;
    const selected = new Set(pending.ids);
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: selected.has(node.id) })),
    );
    setPending(null);
    pending.ready?.();
  }, [key, pending, nodes, setNodes]);
  return useMemo(
    () => (ids: string[], ready?: () => void) => {
      if (currentKey.current === key) setPending({ key, ids: [...ids], ready });
    },
    [key],
  );
}

export function useScopedPrompt<T>(key: string, initial: T) {
  const fallback = useRef(initial).current;
  const currentKey = useRef(key);
  currentKey.current = key;
  const [stored, setStored] = useState({ key, value: initial });
  const set = useMemo(
    () => (value: SetStateAction<T>) => {
      if (currentKey.current !== key) return;
      setStored((current) => ({
        key,
        value:
          typeof value === 'function'
            ? (value as (previous: T) => T)(
                current.key === key ? current.value : fallback,
              )
            : value,
      }));
    },
    [key, fallback],
  );
  return [stored.key === key ? stored.value : fallback, set] as const;
}

/** A confirmation from another activation/canvas cannot authorize the current one. */
export function useSelectionDeletePrompts(scope: SelectionScope) {
  const key = selectionScopeKey(scope);
  const [deletePrompt, setDeletePrompt] = useScopedPrompt<DeletionItem | null>(
    key,
    null,
  );
  const [deleteManyPrompt, setDeleteManyPrompt] = useScopedPrompt<
    DeletionItem[] | null
  >(key, null);
  const [deleteDrawingTargets, setDeleteDrawingTargets] = useScopedPrompt<
    DrawingObject[]
  >(key, []);
  const [deleteSectionTargets, setDeleteSectionTargets] = useScopedPrompt<
    CanvasSection[]
  >(key, []);
  return {
    deletePrompt,
    setDeletePrompt,
    deleteManyPrompt,
    setDeleteManyPrompt,
    deleteDrawingTargets,
    setDeleteDrawingTargets,
    deleteSectionTargets,
    setDeleteSectionTargets,
  };
}
