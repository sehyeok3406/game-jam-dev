import { useEffect, useMemo, useRef } from 'react';
import {
  selectionScopeKey,
  type SelectionScope,
} from '../canvas/selection-actions.ts';
import { useSelectionScope } from '../canvas/useSelectionActions.ts';

/** An acknowledgement belongs to one visit, including A → B → A transitions. */
export function useViewLifetime(scope: SelectionScope) {
  const key = selectionScopeKey(scope);
  const active = useRef(key);
  const mounted = useRef(true);
  active.current = key;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useMemo(() => () => mounted.current && active.current === key, [key]);
}

/** AI work belongs to the project session and keeps its captured destination canvas. */
export function useProjectLifetime(scope: SelectionScope) {
  const project = useSelectionScope({
    ...scope,
    canvasId: '__project__',
    viewEpoch: undefined,
  });
  return useViewLifetime(project);
}
