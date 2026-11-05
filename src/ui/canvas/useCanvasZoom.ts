import { useCallback } from 'react';
import { useStore, type ReactFlowState } from '@xyflow/react';

/** Subscribe only where screen-sized controls need the live camera scale. */
export function useCanvasZoom(active = true) {
  return useStore(
    useCallback(
      (state: ReactFlowState) => (active ? state.transform[2] : 1),
      [active],
    ),
  );
}
