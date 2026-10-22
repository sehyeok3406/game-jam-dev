import { useEffect } from 'react';
import { AI_FILE_LOCK_MESSAGE, isAiFileLocked } from '../../ai-file-lock.ts';
import { materialUsage, type AiQueueTask } from '../../ai-task-queue.ts';
import { NEW_FILE_GAP } from '../../canvas-placement.ts';
import { canvasId } from '../../canvas-sheets.ts';
import type { DocumentStatuses } from '../../document-statuses.ts';
import { drawingBounds } from '../../drawing-geometry.ts';
import type { DrawingCommand, DrawingObject } from '../../drawing-types.ts';
import type { GameUiCanvasNode } from '../../features/game-ui/GameUiNode';
import type { KanbanDocument } from '../../features/kanban/KanbanBoardContent';
import type { KanbanCanvasNode } from '../../features/kanban/KanbanCanvasNode';
import type {
  KanbanCanvasPreferences,
  KanbanLayouts,
} from '../../features/kanban/preferences.ts';
import type { KanbanView } from '../../features/kanban/view.ts';
import {
  statusPropertyApplied,
  type FilePropertyViews,
} from '../../file-properties.ts';
import { gameUiHeight } from '../../game-ui-types.ts';
import { multiplayerRepairRequest } from '../../multiplayer/repair-request.ts';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  CollaborationState,
  HistoryEntry,
  PreviewResult,
  PreviewWindowState,
  WorkspaceState,
} from '../../shared.ts';
import type { SectionCanvasNode } from './SectionCard';
import type { UiDebugSelection } from '../debug/uiDebugRegistry.ts';
import type { DocumentCanvasNode } from '../documents/DocumentCard';
import type { DrawingCanvasNode } from '../drawing/DrawingNode';
import { DraftFlusherRegistry } from '../editor/draft-flushers.ts';
import type { PreviewCanvasNode } from '../preview/PreviewCard';
import { requireDesktopApi } from '../runtime/desktop-api.ts';
import type { CanvasTool } from '../workspace/workspace-types.ts';
import {
  previewNodeId,
  sectionNodeId,
  type CanvasNode,
} from '../workspace/workspace-types.ts';

interface Ports {
  preview: UiDebugSelection | undefined;
  sections: CanvasSection[];
  activeCanvas: string;
  sectionCollapsed: (section: CanvasSection) => boolean;
  sectionLocked: (section: CanvasSection) => boolean;
  toggleSection: (section: CanvasSection) => Promise<void>;
  resizeSection: (
    section: CanvasSection,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<void>;
  revealSection: (section: CanvasSection) => Promise<void>;
  documents: CanvasDocument[];
  collaboration: CollaborationState;
  pathLocked: (path: string) => boolean;
  newFileNodes: Set<string>;
  findOpen: boolean;
  temporaryDocuments: string[];
  projectAiQueue: AiQueueTask[];
  propertyVisibilityFor: (
    id: string,
    previousIds?: string[],
  ) => Partial<
    Record<
      'status' | 'createdBy' | 'createdAt' | 'lastEditedBy' | 'lastEditedAt',
      boolean
    >
  >;
  personalScope: string;
  statusSettings: { value: DocumentStatuses; raw: string | null };
  workflowBusy: boolean;
  workflowEditable: boolean;
  workflowReason: string;
  setWorkflow: (doc: CanvasDocument, id: string) => void;
  setStatusManagerOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  aiFileLock: import('../../shared').AiFileLock;
  setBlockedMessage: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  locked: boolean;
  onBlocked: () => void;
  workspace: WorkspaceState;
  saveDocument: (
    document: CanvasDocument,
    title: string,
    body: string,
  ) => Promise<void>;
  resizeDocument: (
    document: CanvasDocument,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<void>;
  focusSource: (id: string) => void;
  copyTask: (document: CanvasDocument) => Promise<void>;
  revealDocument: (document: CanvasDocument) => Promise<void>;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  collapseActions: import('./collapse-actions').CanvasCollapseActions;
  previews: PreviewResult[];
  previewWindows: Record<string, PreviewWindowState>;
  workflowChange: (
    input: import('../../file-properties').StatusPropertyInput,
  ) => Promise<void>;
  showError: (error: unknown) => void;
  aiBusy: boolean;
  updatePreviewWindow: (
    relative: string,
    state: PreviewWindowState,
  ) => Promise<void>;
  openHistory: (
    relative?: string | null,
    aiOnly?: boolean,
    entry?: HistoryEntry,
  ) => void;
  setCompareFirst: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  canWriteAiRequest: boolean;
  initializeAiRequest: (
    request: import('../../gamejam-request').GamejamRequest,
    saved?: import('../../gamejam-history').GamejamSavedRequest,
    draft?: import('../../gamejam-history').GamejamDraft,
    approval?: { id: string; revision: number },
  ) => void;
  activeCanvasRef: import('react').RefObject<string>;
  setNodes: import('react').Dispatch<
    import('react').SetStateAction<CanvasNode[]>
  >;
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
  viewZoom: number;
  setDrawingGesture: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  submitDrawing: (command: Omit<DrawingCommand, 'canvasId' | 'scope'>) => void;
  setTool: import('react').Dispatch<import('react').SetStateAction<CanvasTool>>;
  kanbanPreferences: {
    enabled: boolean;
    minimized: boolean;
    scope: 'canvas' | 'project';
    x: number;
    y: number;
    width: number;
    height: number;
    placed: boolean;
  };
  kanbanDocuments: KanbanDocument[];
  kanbanView: { value: KanbanView; raw: string | null };
  kanbanViewError: string;
  openKanbanControls: () => void;
  updateKanbanPreferences: (
    value: KanbanCanvasPreferences,
    canvas?: string,
  ) => void;
  moveKanbanCard: (
    item: KanbanDocument,
    statusId: string,
    beforeId?: string,
    afterId?: string,
  ) => Promise<void>;
  navigateCanvasItem: import('react').RefObject<((id: string) => void) | null>;
  gameUi: {
    frames: import('../../game-ui-types').GameUiFrame[];
    submit: (c: import('../../game-ui-types').GameUiCommand) => Promise<void>;
    error: string;
    retry: () => void;
    flush: () => Promise<void>;
    saving: boolean;
  };
  gameUiSettings: { enabled: boolean };
  flushEditors: (finish?: boolean) => Promise<void>;
  loadProject: (fit?: boolean, throwOnError?: boolean) => Promise<void>;
  api: import('../../contracts/app-api').AppApi;
  pendingGeometry: import('react').RefObject<
    Map<
      string,
      {
        sequence: number;
        position: { x: number; y: number };
        style: CanvasNode['style'];
      }
    >
  >;
  createdDrawingSelection: import('react').RefObject<string | null>;
  filePropertyViews: FilePropertyViews;
  sectionViews: Record<string, boolean>;
  temporarySections: string[];
  kanbanLayouts: KanbanLayouts;
  pluginPanelOpen: boolean;
  canvasSheets: CanvasSheets;
  geometryEpoch: number;
  sourceTitles: any;
  beginEdit: (document: CanvasDocument) => Promise<void>;
  endEdit: (document: CanvasDocument) => Promise<void>;
  registerEditor: (
    id: string,
    flush: ((finish?: boolean) => Promise<void>) | null,
  ) => void;
  draftRegistry: DraftFlusherRegistry;
  reportEdit: (
    id: string,
    state: { dirty: boolean; saving: boolean; failed: boolean },
  ) => void;
}
export function useCanvasNodes(
  ports: () => Ports,
  dependencies: React.DependencyList,
) {
  useEffect(() => {
    const {
      sections,
      activeCanvas,
      sectionCollapsed,
      sectionLocked,
      toggleSection,
      resizeSection,
      revealSection,
      documents,
      collaboration,
      pathLocked,
      newFileNodes,
      findOpen,
      temporaryDocuments,
      projectAiQueue,
      propertyVisibilityFor,
      personalScope,
      statusSettings,
      workflowBusy,
      workflowEditable,
      workflowReason,
      setWorkflow,
      setStatusManagerOpen,
      aiFileLock,
      setBlockedMessage,
      locked,
      onBlocked,
      workspace,
      saveDocument,
      resizeDocument,
      focusSource,
      copyTask,
      revealDocument,
      setInspectorId,
      collapseActions,
      previews,
      previewWindows,
      workflowChange,
      showError,
      aiBusy,
      updatePreviewWindow,
      openHistory,
      setCompareFirst,
      canWriteAiRequest,
      initializeAiRequest,
      activeCanvasRef,
      setNodes,
      drawing,
      viewZoom,
      setDrawingGesture,
      submitDrawing,
      setTool,
      kanbanPreferences,
      kanbanDocuments,
      kanbanView,
      kanbanViewError,
      openKanbanControls,
      updateKanbanPreferences,
      moveKanbanCard,
      navigateCanvasItem,
      gameUi,
      gameUiSettings,
      flushEditors,
      loadProject,
      api,
      pendingGeometry,
      createdDrawingSelection,
      sourceTitles,
      beginEdit,
      endEdit,
      registerEditor,
      draftRegistry,
      reportEdit,
      preview,
    } = ports();
    const sectionByMember = new Map<string, CanvasSection>();
    sections.forEach((section) => {
      section.members.forEach((member) => {
        sectionByMember.set(member.id, section);
        sectionByMember.set(member.path, section);
      });
    });
    const sectionNodes: SectionCanvasNode[] = sections
      .filter((section) => canvasId(section.canvasId) === activeCanvas)
      .map((section) => ({
        id: sectionNodeId(section.id),
        type: 'section',
        position: { x: section.x, y: section.y },
        style: {
          width: section.width,
          height: sectionCollapsed(section) ? 44 : section.height,
        },
        zIndex: 0,
        draggable: !sectionLocked(section),
        data: {
          kind: 'section',
          collapsed: sectionCollapsed(section),
          onCollapse: () => void toggleSection(section),
          locked: sectionLocked(section),
          section,
          onResize: resizeSection,
          onReveal: revealSection,
        },
      }));
    const documentNodes: DocumentCanvasNode[] = documents
      .filter((document) => canvasId(document.canvasId) === activeCanvas)
      .map((document) => {
        const foreignLock = collaboration.locks.find(
          (lock) =>
            lock.relativePath === document.relativePath &&
            lock.memberId !== collaboration.memberId,
        );
        const layoutLocked =
          pathLocked(document.relativePath) ||
          (collaboration.active &&
            collaboration.role !== 'admin' &&
            document.type === 'ai-task');
        const nodeLocked =
          layoutLocked ||
          (!!foreignLock &&
            collaboration.connected &&
            !collaboration.pendingChanges);
        const parent =
          sectionByMember.get(document.id) ??
          sectionByMember.get(document.relativePath);
        return {
          id: document.id,
          type: 'document',
          className: `${newFileNodes.has(document.id) ? 'new-file-node' : ''}${parent && sectionCollapsed(parent) ? ' section-member-hidden' : ''}`,
          selectable: !(parent && sectionCollapsed(parent)),
          position: parent
            ? { x: document.x - parent.x, y: document.y - parent.y }
            : { x: document.x, y: document.y },
          style: {
            width: document.width,
            height:
              document.collapsed &&
              !findOpen &&
              !temporaryDocuments.includes(document.id)
                ? 38
                : document.height,
          },
          parentId: parent ? sectionNodeId(parent.id) : undefined,
          zIndex: 2,
          dragHandle: '.document-card__header',
          draggable: !layoutLocked,
          data: {
            kind: 'document',
            aiUsage: materialUsage(projectAiQueue, document.relativePath),
            propertyVisibility: propertyVisibilityFor(document.id),
            authorshipKey: `${personalScope}:${document.id}:${document.modifiedAt}`,
            sectionHidden: !!(parent && sectionCollapsed(parent)),
            statuses: statusSettings.value,
            workflowDisabled:
              workflowBusy ||
              !workflowEditable ||
              pathLocked(document.relativePath),
            workflowReason:
              workflowReason ||
              (pathLocked(document.relativePath)
                ? 'AI 작업이 이 문서를 보호하고 있습니다.'
                : undefined),
            onWorkflow: (id) => setWorkflow(document, id),
            onManageWorkflow: () => setStatusManagerOpen(true),
            layoutLocked,
            locked: nodeLocked,
            onBlocked: isAiFileLocked(aiFileLock, document.relativePath)
              ? () => setBlockedMessage(AI_FILE_LOCK_MESSAGE)
              : foreignLock
                ? () =>
                    setBlockedMessage(
                      `${foreignLock.nickname}님이 이 문서를 편집 중입니다. 편집을 마칠 때까지 기다려주세요.`,
                    )
                : nodeLocked && !locked
                  ? () =>
                      setBlockedMessage(
                        'AI 작업 문서는 관리자만 수정할 수 있습니다.',
                      )
                  : onBlocked,
            collaborative: collaboration.active,
            draftKey: `game-canvas-draft:${collaboration.projectId ?? workspace.root}:${document.id}`,
            saveScope: workspace.saveScope ?? `local:${workspace.root}`,
            sessionId: workspace.session?.sessionId,
            draftRegistry,
            editingBy:
              collaboration.connected && !collaboration.pendingChanges
                ? collaboration.locks.find(
                    (lock) => lock.relativePath === document.relativePath,
                  )?.nickname
                : undefined,
            beginEdit,
            endEdit,
            registerEditor,
            document:
              findOpen || temporaryDocuments.includes(document.id)
                ? { ...document, collapsed: false }
                : document,
            onSave: saveDocument,
            onResize: resizeDocument,
            onSource: focusSource,
            onCopyTask: copyTask,
            onReveal: revealDocument,
            onDetails: () => setInspectorId(document.id),
            onCollapse: () => {
              void collapseActions.document(document, {
                temporary: temporaryDocuments.includes(document.id),
              });
            },
            sourceTitles,
            reportEdit,
          },
        };
      });
    const previewX =
      documents.length > 0
        ? Math.max(
            ...documents.map((document) => document.x + document.width),
          ) + 120
        : 1100;
    const previewY =
      documents.length > 0
        ? Math.min(...documents.map((document) => document.y))
        : 120;
    const previewNodes: PreviewCanvasNode[] = previews
      .filter((preview) => canvasId(preview.canvasId) === activeCanvas)
      .map((preview, index) => {
        const parentSection = sections.find((s) =>
          s.members.some(
            (m) => m.id === preview.sourceId || m.path === preview.sourcePath,
          ),
        );
        const sectionHidden = !!(
          parentSection && sectionCollapsed(parentSection)
        );
        const previewWindow = previewWindows[preview.relativePath] ?? {
          x: previewX,
          y: previewY + index * (520 + NEW_FILE_GAP),
          width: 720,
          height: 520,
          collapsed: false,
        };
        return {
          id: previewNodeId(preview.relativePath),
          type: 'preview',
          selectable: !sectionHidden,
          className: sectionHidden
            ? 'section-member-hidden'
            : newFileNodes.has(previewNodeId(preview.relativePath))
              ? 'new-file-node'
              : undefined,
          position: {
            x: previewWindow.x,
            y: previewWindow.y,
          },
          style: {
            width: previewWindow.width,
            height: previewWindow.collapsed ? 38 : previewWindow.height,
          },
          dragHandle: '.preview-drag-handle',
          draggable: !pathLocked(preview.relativePath),
          zIndex: 3,
          data: {
            kind: 'preview',
            propertyVisibility: propertyVisibilityFor(
              preview.sourceId!,
              preview.propertyPreviousIds ?? [],
            ),
            authorshipKey: `${personalScope}:${preview.sourceId}:${preview.revision ?? preview.content}`,
            onDetails: () =>
              setInspectorId(previewNodeId(preview.relativePath)),
            sectionHidden,
            statuses: statusSettings.value,
            workflowDisabled:
              workflowBusy ||
              !workflowEditable ||
              pathLocked(preview.relativePath) ||
              pathLocked(preview.sourcePath ?? ''),
            workflowReason:
              workflowReason ||
              (pathLocked(preview.relativePath) ||
              pathLocked(preview.sourcePath ?? '')
                ? 'AI 작업이 이 HTML을 보호하고 있습니다.'
                : undefined),
            onWorkflow: (id) =>
              void workflowChange({
                relativePath: preview.relativePath,
                objectId: preview.sourceId!,
                expectedEnabled: statusPropertyApplied(preview),
                expectedStatus: preview.workflowStatusId,
                expectedOrder: preview.workflowOrder,
                statusId: id,
              }).catch(showError),
            onManageWorkflow: () => setStatusManagerOpen(true),
            locked: pathLocked(preview.relativePath),
            preview,
            windowState: previewWindow,
            busy: aiBusy && isAiFileLocked(aiFileLock, preview.relativePath),
            aiUsage: materialUsage(projectAiQueue, preview.relativePath),
            onWindowChange: (state) =>
              updatePreviewWindow(preview.relativePath, state),
            onHistory: () => openHistory(preview.relativePath),
            onCompare: () => setCompareFirst(preview.relativePath),
            multiplayerRepairDisabled:
              !canWriteAiRequest || aiBusy || pathLocked(preview.relativePath),
            onMultiplayerRepair: () =>
              initializeAiRequest(
                multiplayerRepairRequest(
                  preview.relativePath,
                  preview.title ?? '함께 플레이',
                  activeCanvasRef.current,
                  previewWindow.x,
                  previewWindow.y,
                ),
              ),
          },
        };
      });
    setNodes((currentNodes) => {
      const existing = new Map(currentNodes.map((node) => [node.id, node]));
      const currentDrawings = drawing.items
        .filter((o) => o.canvasId === activeCanvas)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const drawingNodes: DrawingCanvasNode[] = currentDrawings.map((o) => {
        const bounds = drawingBounds(o);
        const { canvasId: _canvasId, ...object } = o;
        return {
          id: `drawing:${o.id}`,
          type: 'drawing',
          className: 'canvas-drawing-node',
          position: { x: bounds.x, y: bounds.y },
          style: { width: bounds.width, height: bounds.height },
          zIndex: o.layer === 'annotation' ? 4 : 1,
          draggable: !locked,
          data: {
            kind: 'drawing',
            object,
            locked,
            zoom: viewZoom,
            onGesture: setDrawingGesture,
            onPatch: (patch) =>
              submitDrawing({ action: 'patch', patches: [patch] }),
            onContext: () => {
              setTool('select');
              setNodes((current) =>
                current.map((n) => ({
                  ...n,
                  selected: n.id === `drawing:${o.id}`,
                })),
              );
            },
          },
        };
      });
      const board: KanbanCanvasNode[] =
        kanbanPreferences.enabled && kanbanPreferences.placed
          ? [
              {
                id: `builtin.kanban:${activeCanvas}`,
                type: 'kanban',
                position: { x: kanbanPreferences.x, y: kanbanPreferences.y },
                style: {
                  width: kanbanPreferences.width,
                  height: kanbanPreferences.minimized
                    ? 44
                    : kanbanPreferences.height,
                },
                zIndex: 2,
                dragHandle: '.kanban-drag-handle',
                draggable: true,
                data: {
                  kind: 'kanban',
                  locked: false,
                  canvasId: activeCanvas,
                  activeCanvas,
                  scope: kanbanPreferences.scope,
                  preferences: kanbanPreferences,
                  documents: kanbanDocuments,
                  statuses: statusSettings.value,
                  view: kanbanView.value,
                  editable: workflowEditable && !kanbanViewError,
                  busy: workflowBusy,
                  reason: kanbanViewError || workflowReason,
                  controls: openKanbanControls,
                  update: (value) =>
                    updateKanbanPreferences(value, activeCanvas),
                  move: moveKanbanCard,
                  open: (id) => navigateCanvasItem.current?.(id),
                  manage: () => setStatusManagerOpen(true),
                },
              },
            ]
          : [];
      const gameUiNodes: GameUiCanvasNode[] = gameUi.frames
        .filter((f) => f.canvasId === activeCanvas)
        .map((frame) => ({
          id: `game-ui:${frame.id}`,
          type: 'game-ui',
          position: { x: frame.x, y: frame.y },
          style: { width: frame.width, height: gameUiHeight(frame) },
          zIndex: 5,
          dragHandle: '.game-ui-drag-handle',
          draggable:
            !locked &&
            (!collaboration.active || collaboration.gameUiVersion === 2),
          data: {
            kind: 'game-ui',
            saving: gameUi.saving,
            saveError: gameUi.error,
            retry: gameUi.retry,
            frame,
            scope: workspace.saveScope ?? '',
            zoom: viewZoom,
            libraryEnabled: gameUiSettings.enabled,
            locked:
              locked ||
              (collaboration.active && collaboration.gameUiVersion !== 2),
            inspectorMode:
              preview?.id === 'game-ui-inspector'
                ? preview.state === 'multiple'
                  ? 'multiple'
                  : 'single'
                : undefined,
            submit: async (command) => {
              await flushEditors(false);
              await gameUi.submit(command);
            },
            openDescription: async () => {
              await loadProject(false);
              setTimeout(
                () => navigateCanvasItem.current?.(frame.id + '-description'),
                220,
              );
            },
            exportPng: (data, name) =>
              requireDesktopApi(api).exportGameUiPng({
                scope: workspace.saveScope ?? '',
                name,
                data,
              }),
          },
        }));
      const next = [
        ...gameUiNodes,
        ...board,
        ...sectionNodes,
        ...drawingNodes,
        ...documentNodes,
        ...previewNodes,
      ].map((node) => {
        const old = existing.get(node.id),
          pending = pendingGeometry.current.get(node.id);
        const geometryLocked =
          node.data.kind === 'document'
            ? node.data.layoutLocked
            : node.data.locked;
        const result = {
          ...node,
          // React Flow temporarily hides nodes without measured dimensions.
          // Dropping this on a save/heartbeat blurs the still-mounted editor.
          measured: old?.measured,
          selected: node.className?.includes('section-member-hidden')
            ? false
            : createdDrawingSelection.current
              ? node.id === `drawing:${createdDrawingSelection.current}`
              : node.data.kind === 'drawing' &&
                  ['drawing-object', 'drawing-inspector'].includes(
                    preview?.id ?? '',
                  )
                ? true
                : (old?.selected ?? false),
          ...(old?.dragging && !geometryLocked
            ? { position: old.position, dragging: true }
            : pending
              ? { position: pending.position, style: pending.style }
              : {}),
        } as CanvasNode;
        if (
          old &&
          JSON.stringify(old, (_key, value) =>
            typeof value === 'function' ? undefined : value,
          ) ===
            JSON.stringify(result, (_key, value) =>
              typeof value === 'function' ? undefined : value,
            )
        )
          return old;
        return result;
      });
      if (
        createdDrawingSelection.current &&
        next.some((n) => n.id === `drawing:${createdDrawingSelection.current}`)
      )
        createdDrawingSelection.current = null;
      return next.length === currentNodes.length &&
        next.every((node, index) => node === currentNodes[index])
        ? currentNodes
        : next;
    });
  }, dependencies);
  return {};
}
