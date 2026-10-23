import { GamejamMaterialSelection } from '../GamejamMaterialSelection';
import { EraserPreviewContext } from '../drawing/eraserPreview';
import { CanvasResizeProvider } from './CanvasItemResizer';
import {
  Background,
  ReactFlow,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { snapPosition } from '../../canvas-ux.ts';
import { createTextObject } from '../../text-document';
import type {
  DrawingCommand,
  DrawingObject,
  DrawingStyle,
  DrawingTool,
} from '../../drawing-types.ts';
import { GameUiInspectorProvider } from '../../features/game-ui/GameUiInspectorPanel';
import { noteDragBounds } from '../../note-placement.ts';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  CollaborationState,
  WorkspaceState,
} from '../../shared.ts';
import { CanvasMiniMap } from '../CanvasMiniMap';
import type { UiDebugSelection } from '../debug/uiDebugRegistry.ts';
import { DocumentLinksProvider } from '../DocumentLinksContext';
import { DrawingInputLayer } from '../drawing/DrawingInputLayer';
import type { CanvasTool } from '../workspace/workspace-types.ts';
import {
  sameIds,
  sectionNodeId,
  type CanvasNode,
  type ContextMenuState,
  type DocumentContextMenuState,
  type PreviewContextMenuState,
  type SectionContextMenuState,
  type Theme,
} from '../workspace/workspace-types.ts';
interface Props {
  materialItems: import('../CanvasOverlays').CanvasItem[];
  compactChrome: boolean;
  dockPanel: import('../CanvasChrome').CanvasPanelId | null;
  eraserMode: import('../../drawing-types').EraserMode;
  eraserPreview: import('../drawing/eraserPreview').EraserPreview;
  eraserSize: number;
  finishMaterialSelection: (apply: boolean) => void;
  gameUiPanelHost: HTMLDivElement | null;
  materialFocus: string | null;
  materialMarquee: import('react').RefObject<Set<string> | null>;
  materialPath: (
    node: import('../workspace/workspace-types').CanvasNode,
  ) => string | undefined;
  materialPicker: string[] | null;
  minimapVisible: boolean;
  setDockPanel: import('react').Dispatch<
    import('react').SetStateAction<
      import('../CanvasChrome').CanvasPanelId | null
    >
  >;
  setEraserPreview: import('react').Dispatch<
    import('react').SetStateAction<
      import('../drawing/eraserPreview').EraserPreview
    >
  >;
  setGameUiPanelActive: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  setMaterialFocus: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setMaterialPicker: import('react').Dispatch<
    import('react').SetStateAction<string[] | null>
  >;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  toggleMaterial: (path: string) => void;
  uiHidden: boolean;
  acknowledgeNewFile: (id: string) => void;
  acknowledgeNewFiles: (ids: readonly string[]) => void;
  tool: CanvasTool;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  workspace: WorkspaceState;
  locked: boolean;
  creatingNote: import('react').RefObject<boolean>;
  noteGesture: import('react').RefObject<{
    pointerId: number;
    sheet: string;
    root: string;
    start: { x: number; y: number };
    flowStart: { x: number; y: number };
  } | null>;
  activeCanvasRef: import('react').RefObject<string>;
  setNoteDraft: import('react').Dispatch<
    import('react').SetStateAction<{
      start: { x: number; y: number };
      end: { x: number; y: number };
    } | null>
  >;
  selectionBeforeClick: import('react').RefObject<Set<string>>;
  nodes: CanvasNode[];
  selectionPointer: import('react').RefObject<{
    pane: HTMLElement;
    pointerId: number;
  } | null>;
  cancelNoteDrawing: () => void;
  addIdeaAt: (
    x: number,
    y: number,
    bounds?: import('../../note-placement').NoteBounds,
  ) => Promise<void>;
  setTool: import('react').Dispatch<import('react').SetStateAction<CanvasTool>>;
  sections: CanvasSection[];
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
  setOverlapMenu: import('react').Dispatch<
    import('react').SetStateAction<{
      x: number;
      y: number;
      ids: string[];
    } | null>
  >;
  openCanvasMenu: (clientX: number, clientY: number) => void;
  openSelectionContextMenu?: (
    clientX: number,
    clientY: number,
    node: CanvasNode,
  ) => boolean;
  personalScope: string;
  activeCanvas: string;
  inspectorId: string | null;
  pluginPanelOpen: boolean;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setPluginPanelOpen: (value: import('react').SetStateAction<boolean>) => void;
  allLinkDocuments: CanvasDocument[];
  canvasSheets: CanvasSheets;
  dispatchDocumentLink: (href: string) => void;
  preferences: import('../runtime/preferences').PreferenceStore;
  firstCanvasView: import('react').RefObject<string | null>;
  setViewZoom: import('react').Dispatch<import('react').SetStateAction<number>>;
  onNodesChange: import('@xyflow/react').OnNodesChange<CanvasNode>;
  setNodes: import('react').Dispatch<
    import('react').SetStateAction<CanvasNode[]>
  >;
  openKanbanControls: () => void;
  snapLatest: import('react').RefObject<{
    id: string;
    x: number;
    y: number;
  } | null>;
  setGuides: import('react').Dispatch<
    import('react').SetStateAction<{ x?: number; y?: number }>
  >;
  snapEnabled: boolean;
  persistDraggedNodes: (
    primary: CanvasNode,
    dragged: CanvasNode[],
  ) => Promise<void>;
  persistResizedNodes: (nodes: CanvasNode[]) => Promise<void>;
  showError: (error: unknown) => void;
  setSelectedIds: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  setSelectedSectionIds: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  preview: UiDebugSelection | undefined;
  storeViewport: (id: string) => void;
  noteDraft: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null;
  drawingGesture: boolean;
  theme: Theme;
  minimapPreferences: import('../minimap-preferences').MiniMapPreferences;
  updateMiniMapPreferences: (
    value: import('../minimap-preferences').MiniMapPreferences,
  ) => void;
  drawingTool: DrawingTool;
  drawingStyle: DrawingStyle;
  collaboration: CollaborationState;
  drawing: {
    items: import('../../drawing-types').DrawingItem[];
    submit: (
      command: Omit<DrawingCommand, 'canvasId' | 'scope'> & {
        canvasId?: string;
      },
    ) => Promise<void>;
    flush: () => Promise<void>;
    reload: () => Promise<void>;
    partial: (object: DrawingObject | null) => void;
    error: string;
    recovery: DrawingCommand[] | null;
    recover: () => Promise<void>;
    discardRecovery: () => Promise<void>;
    retry: () => void;
    hold: () => Promise<void>;
    saving: boolean;
  };
  drawingPressure: boolean;
  drawingTouch: boolean;
  drawingContinuous: boolean;
  createdDrawingSelection: import('react').RefObject<string | null>;
  submitDrawing: (command: Omit<DrawingCommand, 'canvasId' | 'scope'>) => void;
  setDrawingGesture: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  guides: { x?: number; y?: number };
  nodeTypes: NodeTypes;
}
export function WorkspaceCanvas({
  materialItems,
  compactChrome,
  dockPanel,
  eraserMode,
  eraserPreview,
  eraserSize,
  finishMaterialSelection,
  gameUiPanelHost,
  materialFocus,
  materialMarquee,
  materialPath,
  materialPicker,
  minimapVisible,
  setDockPanel,
  setEraserPreview,
  setGameUiPanelActive,
  setMaterialFocus,
  setMaterialPicker,
  setNotice,
  toggleMaterial,
  uiHidden,
  acknowledgeNewFile,
  acknowledgeNewFiles,
  tool,
  flowRef,
  workspace,
  locked,
  creatingNote,
  noteGesture,
  activeCanvasRef,
  setNoteDraft,
  selectionBeforeClick,
  nodes,
  selectionPointer,
  cancelNoteDrawing,
  addIdeaAt,
  setTool,
  sections,
  setContextMenu,
  setDocumentContextMenu,
  setSectionContextMenu,
  setPreviewContextMenu,
  setOverlapMenu,
  openCanvasMenu,
  openSelectionContextMenu,
  personalScope,
  activeCanvas,
  inspectorId,
  setInspectorId,
  setPluginPanelOpen,
  allLinkDocuments,
  canvasSheets,
  dispatchDocumentLink,
  preferences,
  firstCanvasView,
  setViewZoom,
  onNodesChange,
  setNodes,
  openKanbanControls,
  snapLatest,
  setGuides,
  snapEnabled,
  persistDraggedNodes,
  persistResizedNodes,
  showError,
  setSelectedIds,
  setSelectedSectionIds,
  preview,
  storeViewport,
  noteDraft,
  drawingGesture,
  theme,
  minimapPreferences,
  updateMiniMapPreferences,
  drawingTool,
  drawingStyle,
  collaboration,
  drawing,
  drawingPressure,
  drawingTouch,
  drawingContinuous,
  createdDrawingSelection,
  submitDrawing,
  setDrawingGesture,
  guides,
  nodeTypes,
}: Props) {
  return (
    <>
      <div
        className="canvas-shell"
        tabIndex={-1}
        onClickCapture={(event) => {
          const id = (event.target as Element)
            .closest('.react-flow__node')
            ?.getAttribute('data-id');
          if (id) acknowledgeNewFile(id);
        }}
        onPointerDownCapture={(event) => {
          if (
            (event.target as Element).closest(
              'button, input, select, textarea, a, .nodrag, [contenteditable="true"]',
            )
          )
            return;
          if (
            tool === 'note' &&
            event.button === 0 &&
            (event.target as Element).closest('.react-flow__pane') &&
            flowRef.current &&
            workspace.root &&
            !locked &&
            !creatingNote.current
          ) {
            event.preventDefault();
            event.stopPropagation();
            const start = { x: event.clientX, y: event.clientY };
            noteGesture.current = {
              pointerId: event.pointerId,
              start,
              flowStart: flowRef.current.screenToFlowPosition(start),
              sheet: activeCanvasRef.current,
              root: workspace.root,
            };
            setNoteDraft({ start, end: start });
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
          selectionBeforeClick.current = new Set(
            nodes.filter((node) => node.selected).map((node) => node.id),
          );
          const target = event.target as HTMLElement;
          const pane = target.closest<HTMLElement>('.react-flow__pane');
          selectionPointer.current =
            pane && event.button === 0 && (target === pane || event.shiftKey)
              ? { pane, pointerId: event.pointerId }
              : null;
        }}
        onPointerMoveCapture={(event) => {
          const gesture = noteGesture.current;
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          setNoteDraft({
            start: gesture.start,
            end: { x: event.clientX, y: event.clientY },
          });
        }}
        onPointerUpCapture={(event) => {
          selectionPointer.current = null;
          const gesture = noteGesture.current;
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          cancelNoteDrawing();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          if (
            locked ||
            gesture.root !== workspace.root ||
            gesture.sheet !== activeCanvasRef.current
          )
            return;
          const end = { x: event.clientX, y: event.clientY };
          const flowEnd = flowRef.current?.screenToFlowPosition(end);
          const dragged =
            Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) > 5;
          if (dragged && flowEnd) {
            const bounds = noteDragBounds(gesture.flowStart, flowEnd);
            void addIdeaAt(bounds.x, bounds.y, bounds);
          } else void addIdeaAt(gesture.flowStart.x, gesture.flowStart.y);
          setTool('select');
        }}
        onPointerCancel={() => {
          selectionPointer.current = null;
          cancelNoteDrawing();
        }}
        onLostPointerCapture={cancelNoteDrawing}
        onContextMenuCapture={(event) => {
          if (materialPicker !== null) {
            event.preventDefault();
            return;
          }
          if (!event.altKey || tool !== 'select') return;
          const point = flowRef.current?.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          if (!point) return;
          const ids = [...nodes]
            .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
            .filter((n) => {
              const parent = sections.find(
                  (s) => n.parentId === sectionNodeId(s.id),
                ),
                x = n.position.x + (parent?.x ?? 0),
                y = n.position.y + (parent?.y ?? 0);
              return (
                point.x >= x &&
                point.x <=
                  x + (n.measured?.width ?? Number(n.style?.width ?? 0)) &&
                point.y >= y &&
                point.y <=
                  y + (n.measured?.height ?? Number(n.style?.height ?? 0))
              );
            })
            .map((n) => n.id);
          if (!ids.length) return;
          event.preventDefault();
          event.stopPropagation();
          setContextMenu(null);
          setDocumentContextMenu(null);
          setSectionContextMenu(null);
          setPreviewContextMenu(null);
          setOverlapMenu({
            x: Math.min(event.clientX, window.innerWidth - 270),
            y: Math.min(event.clientY, window.innerHeight - 320),
            ids,
          });
        }}
        onContextMenu={(event) => {
          if ((event.target as Element).closest('.react-flow__node')) return;
          event.preventDefault();
          openCanvasMenu(event.clientX, event.clientY);
        }}
      >
        <GameUiInspectorProvider
          key={personalScope + ':' + activeCanvas}
          scope={personalScope}
          embedded
          externalHost={gameUiPanelHost}
          onActiveChange={setGameUiPanelActive}
          suspended={
            !!inspectorId || (dockPanel !== null && dockPanel !== 'properties')
          }
          onOpen={() => {
            setDockPanel('properties');
            setInspectorId(null);
            setPluginPanelOpen(false);
          }}
        >
          <DocumentLinksProvider
            documents={allLinkDocuments}
            canvases={canvasSheets.canvases}
            open={dispatchDocumentLink}
          >
            <EraserPreviewContext.Provider
              value={
                preview?.id === 'drawing-eraser' && preview.state === 'pending'
                  ? new Map(
                      drawing.items.map((o) => [
                        o.id,
                        { generation: o.generation },
                      ]),
                    )
                  : eraserPreview
              }
            >
              <CanvasResizeProvider
                save={persistResizedNodes}
                scope={`${workspace.saveScope ?? workspace.root}:${activeCanvas}`}
              >
                <ReactFlow<CanvasNode>
                  key={activeCanvas}
                  nodes={
                    materialPicker === null
                      ? nodes
                      : nodes.map((node) => ({
                          ...node,
                          selected:
                            !!materialPath(node) &&
                            materialPicker.includes(materialPath(node)!),
                          selectable:
                            !!materialPath(node) && node.selectable !== false,
                          draggable: false,
                          className:
                            (node.className ?? '') +
                            (node.id === materialFocus
                              ? ' material-focus'
                              : ''),
                        }))
                  }
                  edges={[]}
                  nodeTypes={nodeTypes}
                  onInit={(instance) => {
                    flowRef.current = instance;
                    try {
                      const saved = JSON.parse(
                        preferences.getItem(
                          'game-canvas-sheet-view:' +
                            workspace.root +
                            ':' +
                            activeCanvas,
                        ) ?? 'null',
                      );
                      if (
                        saved &&
                        ['x', 'y', 'zoom'].every(
                          (key) =>
                            typeof saved[key] === 'number' &&
                            Number.isFinite(saved[key]),
                        ) &&
                        saved.zoom >= 0.1 &&
                        saved.zoom <= 2
                      ) {
                        firstCanvasView.current = null;
                        void instance.setViewport(saved);
                        setViewZoom(saved.zoom);
                        return;
                      }
                    } catch {
                      /* Invalid preferences use the default viewport. */
                    }
                    firstCanvasView.current = activeCanvas;
                    void instance.setViewport({ x: 0, y: 0, zoom: 1 });
                    setViewZoom(1);
                    if (nodes.length) {
                      firstCanvasView.current = null;
                      requestAnimationFrame(() => {
                        void instance.fitView({
                          padding: 0.16,
                          maxZoom: 1,
                          duration: 0,
                        });
                      });
                    }
                  }}
                  onNodesChange={(changes) => {
                    if (materialPicker === null) {
                      onNodesChange(changes);
                      return;
                    }
                    onNodesChange(
                      changes.filter((change) => change.type === 'dimensions'),
                    );
                    if (!materialMarquee.current) return;
                    const keep = materialMarquee.current;
                    setMaterialPicker((current) => {
                      if (current === null) return current;
                      const next = new Set(current);
                      for (const change of changes) {
                        if (change.type !== 'select') continue;
                        const node = nodes.find(
                          (node) => node.id === change.id,
                        );
                        const path = node && materialPath(node);
                        if (!path) continue;
                        if (change.selected) next.add(path);
                        else if (!keep.has(path)) next.delete(path);
                      }
                      const result = [...next];
                      return sameIds(current, result) ? current : result;
                    });
                  }}
                  onSelectionStart={() => {
                    if (materialPicker !== null)
                      materialMarquee.current = new Set(materialPicker);
                  }}
                  onSelectionEnd={() => {
                    materialMarquee.current = null;
                  }}
                  onNodeClick={(event, node) => {
                    if (materialPicker !== null) {
                      const path = materialPath(node);
                      if (path) {
                        toggleMaterial(path);
                        setMaterialFocus(node.id);
                      }
                      return;
                    }
                    acknowledgeNewFile(node.id);
                    if (inspectorId && !event.shiftKey) setInspectorId(node.id);
                    setDocumentContextMenu(null);
                    setSectionContextMenu(null);
                    setPreviewContextMenu(null);
                    if (event.shiftKey || event.ctrlKey || event.metaKey) {
                      const ids = new Set(selectionBeforeClick.current);
                      if (ids.has(node.id)) ids.delete(node.id);
                      else ids.add(node.id);
                      setNodes((current) =>
                        current.map((item) => ({
                          ...item,
                          selected: ids.has(item.id),
                        })),
                      );
                    }
                  }}
                  onNodeContextMenu={(event, node) => {
                    if (
                      (event.target as Element).closest(
                        'input,textarea,[contenteditable="true"],iframe',
                      )
                    )
                      return;
                    event.preventDefault();
                    if (materialPicker !== null) return;
                    event.stopPropagation();
                    if (
                      openSelectionContextMenu?.(
                        event.clientX,
                        event.clientY,
                        node,
                      )
                    )
                      return;
                    setContextMenu(null);
                    setPreviewContextMenu(null);
                    if (node.data.kind === 'kanban') {
                      openKanbanControls();
                      return;
                    }
                    if (node.data.kind === 'document') {
                      setSectionContextMenu(null);
                      setDocumentContextMenu({
                        screenX: Math.min(
                          event.clientX,
                          window.innerWidth - 282,
                        ),
                        screenY: Math.min(
                          event.clientY,
                          window.innerHeight - 190,
                        ),
                        document: node.data.document,
                      });
                    } else if (node.data.kind === 'section') {
                      setDocumentContextMenu(null);
                      setSectionContextMenu({
                        screenX: Math.min(
                          event.clientX,
                          window.innerWidth - 282,
                        ),
                        screenY: Math.min(
                          event.clientY,
                          window.innerHeight - 230,
                        ),
                        section: node.data.section,
                      });
                    } else if (node.data.kind === 'preview') {
                      setDocumentContextMenu(null);
                      setSectionContextMenu(null);
                      setPreviewContextMenu({
                        screenX: Math.min(
                          event.clientX,
                          window.innerWidth - 282,
                        ),
                        screenY: Math.min(
                          event.clientY,
                          window.innerHeight - 160,
                        ),
                        preview: node.data.preview,
                      });
                    }
                  }}
                  onNodeDragStart={() => {
                    snapLatest.current = null;
                    setGuides({});
                  }}
                  onNodeDrag={(_event, node, dragged) => {
                    if (
                      !snapEnabled ||
                      _event.altKey ||
                      dragged.length > 1 ||
                      node.data.kind === 'preview' ||
                      locked
                    ) {
                      snapLatest.current = null;
                      setGuides({});
                      return;
                    }
                    const parent = sections.find(
                      (section) => node.parentId === sectionNodeId(section.id),
                    );
                    const x = node.position.x + (parent?.x ?? 0),
                      y = node.position.y + (parent?.y ?? 0),
                      width =
                        node.measured?.width ??
                        Number(node.style?.width ?? 300),
                      height =
                        node.measured?.height ??
                        Number(node.style?.height ?? 300);
                    const excluded =
                      node.data.kind === 'section'
                        ? new Set(
                            node.data.section.members.map(
                              (member) => member.id,
                            ),
                          )
                        : new Set<string>();
                    const others = nodes
                      .filter(
                        (other) =>
                          other.id !== node.id &&
                          other.id !== node.parentId &&
                          !other.selected &&
                          !excluded.has(other.id),
                      )
                      .map((other) => {
                        const p = sections.find(
                          (section) =>
                            other.parentId === sectionNodeId(section.id),
                        );
                        return {
                          x: other.position.x + (p?.x ?? 0),
                          y: other.position.y + (p?.y ?? 0),
                          width:
                            other.measured?.width ??
                            Number(other.style?.width ?? 300),
                          height:
                            other.measured?.height ??
                            Number(other.style?.height ?? 300),
                        };
                      });
                    const snapped = snapPosition(
                      { x, y, width, height },
                      others,
                      6 / (flowRef.current?.getZoom() ?? 1),
                    );
                    const snappedPosition = {
                      x: snapped.x - (parent?.x ?? 0),
                      y: snapped.y - (parent?.y ?? 0),
                    };
                    snapLatest.current = { id: node.id, ...snappedPosition };
                    setNodes((current) =>
                      current.map((item) =>
                        item.id === node.id
                          ? {
                              ...item,
                              position: snappedPosition,
                            }
                          : item,
                      ),
                    );
                    setGuides({ x: snapped.xGuide, y: snapped.yGuide });
                  }}
                  onNodeDragStop={(_event, node, dragged) => {
                    const snap = snapLatest.current;
                    const target =
                      snap?.id === node.id
                        ? { ...node, position: { x: snap.x, y: snap.y } }
                        : node;
                    const moved = dragged.map((item) =>
                      item.id === target.id ? target : item,
                    );
                    setGuides({});
                    snapLatest.current = null;
                    void persistDraggedNodes(target, moved).catch(showError);
                  }}
                  onSelectionChange={({ nodes: selected }) => {
                    acknowledgeNewFiles(selected.map((node) => node.id));
                    if (materialPicker !== null) return;
                    const nextIds = selected.flatMap((node) =>
                      node.data.kind === 'document'
                        ? [node.data.document.id]
                        : [],
                    );
                    const nextSectionIds = selected.flatMap((node) =>
                      node.data.kind === 'section'
                        ? [node.data.section.id]
                        : [],
                    );
                    setSelectedIds((currentIds) =>
                      sameIds(currentIds, nextIds) ? currentIds : nextIds,
                    );
                    setSelectedSectionIds((currentIds) =>
                      sameIds(currentIds, nextSectionIds)
                        ? currentIds
                        : nextSectionIds,
                    );
                  }}
                  onPaneClick={(event) => {
                    setContextMenu(null);
                    setDocumentContextMenu(null);
                    setSectionContextMenu(null);
                    setPreviewContextMenu(null);
                    if (
                      tool === 'text' &&
                      workspace.root &&
                      !locked &&
                      flowRef.current &&
                      (!collaboration.active ||
                        collaboration.drawingTextVersion === 1)
                    ) {
                      const position = flowRef.current.screenToFlowPosition({
                        x: event.clientX,
                        y: event.clientY,
                      });
                      const object = createTextObject(position.x, position.y);
                      object.geometry.color =
                        theme === 'dark' ? '#e2e8f0' : '#1e293b';
                      object.order = Math.min(
                        1e9,
                        Math.max(
                          0,
                          ...drawing.items
                            .filter((o) => o.canvasId === activeCanvas)
                            .map((o) => o.order),
                        ) + 1,
                      );
                      createdDrawingSelection.current = object.id;
                      submitDrawing({ action: 'create', objects: [object] });
                      setTool('select');
                    }
                  }}
                  onPaneContextMenu={(event) => {
                    event.preventDefault();
                    if (materialPicker !== null) return;
                    openCanvasMenu(event.clientX, event.clientY);
                  }}
                  onMoveStart={() => {
                    if (preview) return;
                    setContextMenu(null);
                    setDocumentContextMenu(null);
                    setSectionContextMenu(null);
                    setPreviewContextMenu(null);
                  }}
                  onMove={(_event, viewport) => {
                    if (activeCanvasRef.current === activeCanvas)
                      setViewZoom(viewport.zoom);
                  }}
                  onMoveEnd={() => {
                    if (activeCanvasRef.current === activeCanvas)
                      storeViewport(activeCanvas);
                  }}
                  selectionOnDrag={tool === 'select'}
                  panOnDrag={tool === 'hand' ? [0, 1, 2] : [1, 2]}
                  nodesDraggable={materialPicker === null && tool === 'select'}
                  elementsSelectable={tool === 'select'}
                  multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
                  disableKeyboardA11y={materialPicker !== null}
                  fitView={false}
                  zoomOnScroll={!noteDraft && !drawingGesture}
                  zoomOnPinch={!noteDraft && !drawingGesture}
                  zoomOnDoubleClick={
                    tool !== 'note' &&
                    tool !== 'drawing' &&
                    tool !== 'text' &&
                    !drawingGesture
                  }
                  minZoom={0.15}
                  maxZoom={2}
                  elevateNodesOnSelect={false}
                  deleteKeyCode={null}
                >
                  <Background
                    color={theme === 'dark' ? '#373b44' : '#c9cdd3'}
                    gap={24}
                    size={1}
                  />

                  {minimapVisible && !compactChrome && !uiHidden && (
                    <CanvasMiniMap
                      theme={theme}
                      preferences={minimapPreferences}
                      change={updateMiniMapPreferences}
                      previewOpen={preview?.id === 'minimap-settings'}
                    />
                  )}
                  <DrawingInputLayer
                    eraserMode={eraserMode}
                    eraserSize={eraserSize}
                    onErasePreview={setEraserPreview}
                    onErasePartial={(erasures) =>
                      submitDrawing({ action: 'erase', erasures })
                    }
                    onError={setNotice}
                    tool={drawingTool}
                    style={drawingStyle}
                    enabled={
                      tool === 'drawing' &&
                      !locked &&
                      (!collaboration.active ||
                        collaboration.drawingsVersion === 1)
                    }
                    scope={workspace.saveScope ?? ''}
                    canvasId={activeCanvas}
                    items={drawing.items}
                    pressure={drawingPressure}
                    touch={drawingTouch}
                    onCreate={(o) => {
                      if (o.kind === 'shape' && !drawingContinuous)
                        createdDrawingSelection.current = o.id;
                      submitDrawing({ action: 'create', objects: [o] });
                    }}
                    onErase={(targets) =>
                      submitDrawing({ action: 'delete', targets })
                    }
                    onPartial={drawing.partial}
                    onGesture={setDrawingGesture}
                    onFinished={() => {
                      if (
                        drawingTool !== 'pen' &&
                        drawingTool !== 'highlighter' &&
                        !drawingContinuous
                      )
                        setTool('select');
                    }}
                  />
                  {materialPicker !== null && (
                    <GamejamMaterialSelection
                      items={materialItems.filter(
                        (item) =>
                          item.kind !== 'task' &&
                          item.canvasId === activeCanvas,
                      )}
                      paths={materialPicker}
                      focused={materialFocus}
                      focus={setMaterialFocus}
                      toggle={toggleMaterial}
                      finish={() => finishMaterialSelection(true)}
                      cancel={() => finishMaterialSelection(false)}
                    />
                  )}
                </ReactFlow>
              </CanvasResizeProvider>
            </EraserPreviewContext.Provider>
          </DocumentLinksProvider>
        </GameUiInspectorProvider>
        {noteDraft && (
          <div
            className="note-drawing-preview"
            aria-label="새 메모 생성 영역"
            style={{
              left: Math.min(noteDraft.start.x, noteDraft.end.x),
              top: Math.min(noteDraft.start.y, noteDraft.end.y),
              width: Math.abs(noteDraft.end.x - noteDraft.start.x),
              height: Math.abs(noteDraft.end.y - noteDraft.start.y),
            }}
          />
        )}
      </div>
      {guides.x !== undefined && (
        <div
          className="snap-guide snap-guide--x"
          style={{
            left: flowRef.current?.flowToScreenPosition({ x: guides.x, y: 0 })
              .x,
          }}
        />
      )}
      {guides.y !== undefined && (
        <div
          className="snap-guide snap-guide--y"
          style={{
            top: flowRef.current?.flowToScreenPosition({ x: 0, y: guides.y }).y,
          }}
        />
      )}
    </>
  );
}
