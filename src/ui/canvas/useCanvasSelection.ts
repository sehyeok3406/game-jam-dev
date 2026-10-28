import { useState, useRef, useCallback } from 'react';
import { useNodesState, useStoreApi, type Node } from '@xyflow/react';

/** Selection snapshots and pointer cancellation belong to this mounted canvas. */
export function useCanvasSelection<N extends Node>() {
  const flowStore = useStoreApi<N>();
  const [nodes, setNodes, onNodesChange] = useNodesState<N>([]);
  // Coordinate changes must not invalidate selection-derived panel content.
  const selectionContentRef = useRef<Pick<N, 'id' | 'data'>[]>([]);
  const selected = nodes.filter((node) => node.selected);
  const previous = selectionContentRef.current;
  if (
    selected.length !== previous.length ||
    selected.some(
      (node, i) => node.id !== previous[i].id || node.data !== previous[i].data,
    )
  )
    selectionContentRef.current = selected.map(({ id, data }) => ({
      id,
      data,
    }));
  const selectionContent = selectionContentRef.current;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const selectionBeforeClick = useRef(new Set<string>());
  const selectionPointer = useRef<{
    pane: HTMLElement;
    pointerId: number;
  } | null>(null);
  const cancelSelectionDrag = useCallback(() => {
    if (!flowStore.getState().userSelectionRect) return;
    const pointer = selectionPointer.current;
    // Changing tools alone leaves React Flow's selection rectangle and auto-pan
    // alive. Cancel the pointer before disabling its selection event handlers.
    if (pointer) {
      pointer.pane.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          pointerId: pointer.pointerId,
        }),
      );
      if (pointer.pane.hasPointerCapture(pointer.pointerId))
        pointer.pane.releasePointerCapture(pointer.pointerId);
    }
    flowStore.setState({
      userSelectionRect: null,
      userSelectionActive: false,
      nodesSelectionActive: selectionBeforeClick.current.size > 0,
    });
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: selectionBeforeClick.current.has(node.id),
      })),
    );
    selectionPointer.current = null;
  }, [flowStore, setNodes]);

  return {
    nodes,
    selectionContent,
    setNodes,
    onNodesChange,
    selectedIds,
    setSelectedIds,
    selectedSectionIds,
    setSelectedSectionIds,
    selectionBeforeClick,
    selectionPointer,
    cancelSelectionDrag,
  };
}
