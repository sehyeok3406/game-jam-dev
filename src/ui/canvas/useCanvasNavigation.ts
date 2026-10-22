import type { ReactFlowInstance } from '@xyflow/react';
import type { DrawingObject } from '../../drawing-types.ts';
import type {
  CanvasSheetCommand,
  CanvasSheets,
  WorkspaceState,
} from '../../shared.ts';
import type { SelectionScope } from './selection-actions.ts';
import { useViewLifetime } from '../workspace/useViewLifetime.ts';
import type {
  CanvasNode,
  ContextMenuState,
  DocumentContextMenuState,
  PreviewContextMenuState,
  SectionContextMenuState,
} from '../workspace/workspace-types.ts';
interface Ports {
  workspace: WorkspaceState;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  preferences: import('../runtime/preferences.ts').PreferenceStore;
  activeCanvasRef: import('react').RefObject<string>;
  switchingCanvasRef: import('react').RefObject<boolean>;
  flushEditors: (finish?: boolean) => Promise<void>;
  api: import('../../contracts/app-api.ts').AppApi;
  setActiveCanvas: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  setSelectedIds: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  setSelectedSectionIds: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  setNodes: import('react').Dispatch<
    import('react').SetStateAction<CanvasNode[]>
  >;
  setContextMenu: import('react').Dispatch<
    import('react').SetStateAction<ContextMenuState | null>
  >;
  setDocumentContextMenu: import('react').Dispatch<
    import('react').SetStateAction<DocumentContextMenuState | null>
  >;
  setSectionContextMenu: import('react').Dispatch<
    import('react').SetStateAction<SectionContextMenuState | null>
  >;
  setPreviewContextMenu: import('react').Dispatch<
    import('react').SetStateAction<PreviewContextMenuState | null>
  >;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setGuides: import('react').Dispatch<
    import('react').SetStateAction<{ x?: number; y?: number }>
  >;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  setMovingCanvasItems: import('react').Dispatch<
    import('react').SetStateAction<{
      paths: string[];
      source: string;
      drawings?: DrawingObject[];
    } | null>
  >;
  setMoveCanvasTarget: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  canvasSheets: CanvasSheets;
}
export function useCanvasNavigation(scope: SelectionScope, ports: () => Ports) {
  const isCurrent = useViewLifetime(scope);
  const storeViewport = (id: string) => {
    const { workspace, flowRef, preferences } = ports();

    if (!workspace.root || !flowRef.current) return;
    try {
      preferences.setItem(
        'game-canvas-sheet-view:' + workspace.root + ':' + id,
        JSON.stringify(flowRef.current.getViewport()),
      );
    } catch {
      /* Optional preference. */
    }
  };
  const switchCanvasTo = async (id: string) => {
    const {
      workspace,
      preferences,
      activeCanvasRef,
      switchingCanvasRef,
      flushEditors,
      api,
      setActiveCanvas,
      setSelectedIds,
      setSelectedSectionIds,
      setNodes,
      setContextMenu,
      setDocumentContextMenu,
      setSectionContextMenu,
      setPreviewContextMenu,
      setInspectorId,
      setGuides,
    } = ports();

    if (id === activeCanvasRef.current) return;
    if (switchingCanvasRef.current)
      throw new Error('캔버스를 전환하고 있습니다. 잠시 후 다시 시도해주세요.');
    switchingCanvasRef.current = true;
    try {
      await flushEditors();
      if (!isCurrent()) return;
      if (
        !(await api.editor.getCanvasSheets()).canvases.some(
          (sheet) => sheet.id === id,
        )
      )
        throw new Error('캔버스가 삭제되었습니다. 다른 탭을 선택해주세요.');
      if (!isCurrent()) return;
      if (document.fullscreenElement) await document.exitFullscreen();
      if (!isCurrent()) return;
      document.exitPointerLock?.();
      storeViewport(activeCanvasRef.current);
      activeCanvasRef.current = id;
      setActiveCanvas(id);
      setSelectedIds([]);
      setSelectedSectionIds([]);
      setNodes([]);
      setContextMenu(null);
      setDocumentContextMenu(null);
      setSectionContextMenu(null);
      setPreviewContextMenu(null);
      setInspectorId(null);
      setGuides({});
      try {
        preferences.setItem('game-canvas-active-sheet:' + workspace.root, id);
      } catch {
        /* Optional preference. */
      }
    } finally {
      switchingCanvasRef.current = false;
    }
  };
  const changeSheets = async (command: CanvasSheetCommand) => {
    const { flushEditors, api, loadProject } = ports();

    await flushEditors();
    if (!isCurrent()) return;
    await api.editor.changeCanvasSheets(command);
    if (isCurrent()) await loadProject(false);
  };
  const beginCanvasMove = (paths: string[], drawings: DrawingObject[] = []) => {
    const {
      activeCanvasRef,
      setDocumentContextMenu,
      setSectionContextMenu,
      setPreviewContextMenu,
      setMovingCanvasItems,
      setMoveCanvasTarget,
      canvasSheets,
    } = ports();

    setMovingCanvasItems({
      paths: paths.filter(Boolean),
      drawings,
      source: activeCanvasRef.current,
    });
    setMoveCanvasTarget(
      canvasSheets.canvases.find(
        (sheet) => sheet.id !== activeCanvasRef.current,
      )?.id ?? '',
    );
    setDocumentContextMenu(null);
    setSectionContextMenu(null);
    setPreviewContextMenu(null);
  };

  return { switchCanvasTo, storeViewport, beginCanvasMove, changeSheets };
}
