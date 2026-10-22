import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasCollapseActions,
  type CollapsePorts,
} from './collapse-actions.ts';
import { selectionScopeKey, type SelectionScope } from './selection-actions.ts';

export function useCollapseActions(
  scope: SelectionScope,
  ports: () => Omit<CollapsePorts, 'scope'>,
) {
  const current = useRef({ scope, ports });
  current.current = { scope, ports };
  const mounted = useRef(true);
  const [state, setState] = useState({ key: '', busy: false });
  const actions = useMemo(
    () =>
      new CanvasCollapseActions(
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
