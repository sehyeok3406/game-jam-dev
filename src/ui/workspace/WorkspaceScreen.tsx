import { WorkspaceDock } from '../shell/WorkspaceDock';
import { WorkspaceChrome } from '../shell/WorkspaceChrome';
import { useCanvasRegions } from '../CanvasChrome';
import type { EraserMode } from '../../drawing-types';
import type { EraserPreview } from '../drawing/eraserPreview';
import { isPreviewPath } from '../../preview-output';
import type { NodeTypes, ReactFlowInstance } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  AI_FILE_LOCK_MESSAGE,
  isAiFileLocked,
  mergeAiFileLocks,
} from '../../ai-file-lock';
import { queueFileLock } from '../../ai-task-queue';
import { entryTaskRecord, historyTaskPath } from '../../ai-task-records';
import { canvasId, readCanvasSheets } from '../../canvas-sheets';
import type { DocumentOutputTemplate } from '../../document-format';
import { linkStatusText, resolveDocumentLink } from '../../document-links';
import { documentSets } from '../../document-output';
import type { DocumentSaveState } from '../../document-save-queue';
import {
  defaultStatuses,
  type DocumentStatuses,
} from '../../document-statuses';
import {
  DEFAULT_HIGHLIGHT_STYLE,
  DEFAULT_PEN_STYLE,
  DEFAULT_SHAPE_STYLE,
} from '../../drawing-geometry';
import type {
  DrawingCommand,
  DrawingObject,
  DrawingStyle,
  DrawingTool,
} from '../../drawing-types';
import '../../features/game-ui/game-ui.css';
import { GameUiControls } from '../../features/game-ui/GameUiControls';
import { GameUiNode } from '../../features/game-ui/GameUiNode';
import { useGameUi } from '../../features/game-ui/useGameUi';
import { CanvasVisibilityPicker } from '../../features/kanban/CanvasVisibilityPicker';
import '../../features/kanban/kanban.css';
import { KanbanNode } from '../../features/kanban/KanbanCanvasNode';
import { KanbanControls } from '../../features/kanban/KanbanControls';
import {
  kanbanVisibility,
  usePersonalValue,
} from '../../features/kanban/preferences';
import { defaultKanbanView, type KanbanView } from '../../features/kanban/view';
import type { PluginPanelPage } from '../../features/plugins/builtin-features';
import { defaultPluginPanelGeometry } from '../../features/plugins/PluginControlPanel';
import { SELF_HOST_ENABLED } from '../../features/self-host/enabled';
import {
  emptyFilePropertyViews,
  readFilePropertyViews,
  type FilePropertyViews,
} from '../../file-properties';
import { gameUiHeight } from '../../game-ui-types';
import { resolveGamejamRequest } from '../../gamejam-request';
import { textMaterialItems } from '../../canvas-text-materials';
import { gamejamIssues } from '../../gamejam-validation';
import { gamejamFieldPage } from '../../gamejam-wizard';
import { readMultiplayerManifest } from '../../multiplayer/contract';
import type { NewFileIndicators } from '../../new-file-indicators';
import { previewLabel } from '../../preview-output';
import { normalizePreviewWindow } from '../../preview-window';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  CollaborationState,
  PreviewResult,
  PreviewWindowState,
  WorkspaceState,
} from '../../shared';
import { useAiRequestCommands } from '../ai/useAiRequestCommands';
import { useAiRun } from '../ai/useAiRun';
import { useGamejamRequest } from '../ai/useGamejamRequest';
import { WorkspaceAiDialogs } from '../ai/WorkspaceAiDialogs';
import {
  sectionViewCollapsed,
  type CollapseTarget,
} from '../canvas/collapse-actions';
import { SectionCard } from '../canvas/SectionCard';
import { SectionDialogs } from '../canvas/SectionDialogs';
import { SectionRenameDialog } from '../canvas/SectionRenameDialog';
import {
  copyDrawingObjects,
  selectionArrangementItems,
  type ArrangementAction,
} from '../canvas/selection-plan';
import { SelectionDeleteDialogs } from '../canvas/SelectionDeleteDialogs';
import { useCanvasClipboard } from '../canvas/useCanvasClipboard';
import { useCanvasCommands } from '../canvas/useCanvasCommands';
import { useCanvasGeometry } from '../canvas/useCanvasGeometry';
import { useCanvasNavigation } from '../canvas/useCanvasNavigation';
import { useCanvasNodes } from '../canvas/useCanvasNodes';
import { useCanvasSelection } from '../canvas/useCanvasSelection';
import { useCollapseActions } from '../canvas/useCollapseActions';
import { useNoteCreation } from '../canvas/useNoteCreation';
import {
  useSectionActions,
  useSectionPrompts,
} from '../canvas/useSectionActions';
import {
  useCreatedSelection,
  useSelectionActions,
  useSelectionDeletePrompts,
  useSelectionScope,
  useScopedPrompt,
} from '../canvas/useSelectionActions';
import { WorkspaceCanvas } from '../canvas/WorkspaceCanvas';
import { WorkspaceContextMenus } from '../canvas/WorkspaceContextMenus';
import { SelectionContextMenu } from '../canvas/SelectionContextMenu';
import { ProjectCopyDialog } from '../ProjectCopyDialog';
import {
  contextSelection,
  selectionMenuTargets,
  selectionMenuPaths,
  projectCopySelection,
  type SelectionMenuTargets,
} from '../canvas/selection-menu-plan';
import { selectionScopeKey } from '../canvas/selection-actions';
import type { ProjectCopyRequest } from '../../contracts/project-copy';
import type { CanvasCommand } from '../CanvasOverlays';
import { CanvasTabs } from '../CanvasTabs';
import { UiDebugConsole } from '../debug/UiDebugConsole';
import type { UiDebugSelection } from '../debug/uiDebugRegistry';
import { useWorkspacePreview } from '../debug/useWorkspacePreview';
import { DocumentCard } from '../documents/DocumentCard';
import { pendingDocument } from '../documents/presentation';
import { useFileWorkflow } from '../documents/useFileWorkflow';
import '../drawing/drawing.css';
import { DrawingNode, type DrawingCanvasNode } from '../drawing/DrawingNode';
import { useDrawing } from '../drawing/useDrawing';
import { DraftFlusherRegistry } from '../editor/draft-flushers';
import { useWorkspaceHistory } from '../history/useWorkspaceHistory';
import { WorkspaceHistoryPanels } from '../history/WorkspaceHistoryPanels';
import {
  defaultMiniMapPreferences,
  readMiniMapPreferences,
} from '../minimap-preferences';
import { PreviewCard, type PreviewNodeData } from '../preview/PreviewCard';
import { usePreviewWindows } from '../preview/usePreviewWindows';
import { ProjectHome } from '../ProjectHome';
import { requireDesktopApi } from '../runtime/desktop-api';
import { useRuntime } from '../runtime/RuntimeProvider';
import { usePanelState } from '../shell/usePanelState';
import {
  WorkspacePanels,
  type WorkspacePanelsProps,
} from '../shell/WorkspacePanels';
import { useCanvasKanban } from '../../features/kanban/useCanvasKanban';
import { useProjectLoading } from './useProjectLoading';
import { useWorkspaceData } from './useWorkspaceData';
import { useWorkspaceImport } from './useWorkspaceImport';
import { useWorkspaceIndex } from './useWorkspaceIndex';
import { useWorkspaceTransfers } from './useWorkspaceTransfers';
import type { CanvasTool } from './workspace-types';
import {
  EMPTY_AI_QUEUE,
  previewDeletionItem,
  previewNodeId,
  sectionNodeId,
  type CanvasNode,
  type ContextMenuState,
  type DocumentContextMenuState,
  type PreviewContextMenuState,
  type SectionContextMenuState,
  type Theme,
} from './workspace-types';
import { WorkspaceTransferDialogs } from './WorkspaceTransferDialogs';

const nodeTypes: NodeTypes = {
  kanban: KanbanNode,
  'game-ui': GameUiNode,
  drawing: DrawingNode,
  document: DocumentCard,
  preview: PreviewCard,
  section: SectionCard,
};

export function WorkspaceScreen({ preview }: { preview?: UiDebugSelection }) {
  const { api, preferences, capabilities } = useRuntime();
  const panelState = usePanelState();
  const { dockPanel, setDockPanel, restorePanelScope } = panelState;
  const [minimapVisible, setMinimapVisible] = useState(() => {
    try {
      return preferences.getItem('gamejam:minimap-visible') === 'true';
    } catch {
      return false;
    }
  });
  const [compactChrome, setCompactChrome] = useState(
    () => window.innerWidth <= 1200,
  );
  useEffect(() => {
    const media = matchMedia('(max-width: 1200px)');
    const update = () => setCompactChrome(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [gameUiPanelHost, setGameUiPanelHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [gameUiPanelActive, setGameUiPanelActive] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);

  const {
    setSelfHostOpen,
    findOpen,
    setFindOpen,
    collaborationOpen,
    setCollaborationOpen,
    navigatorOpen,
    setNavigatorOpen,
    commandOpen,
    setCommandOpen,
    shortcutsOpen,
    setShortcutsOpen,
    settingsOpen,
    setSettingsOpen,
    updateOpen,
    setUpdateOpen,
    approvalInboxOpen,
    setApprovalInboxOpen,
    setStatusManagerOpen,
    setKanbanAppearanceOpen,
    pluginPanelOpen,
    setPluginPanelOpen,
    historyOpen,
    setHistoryOpen,
    codexStatusOpen,
    setCodexStatusOpen,
  } = panelState;

  const [materialPicker, setMaterialPicker] = useState<string[] | null>(null);
  const [materialFocus, setMaterialFocus] = useState<string | null>(null);
  const materialMarquee = useRef<Set<string> | null>(null);
  const [approvalInboxFocusId, setApprovalInboxFocusId] = useState<string>();
  const [discordApprovalOpen, setDiscordApprovalOpen] = useState(false);
  const [home, setHome] = useState(preview ? preview.scope === 'home' : true);
  useEffect(
    () =>
      SELF_HOST_ENABLED && capabilities.selfHostManagement
        ? api.desktop?.selfHost?.onSelfHostOpen(() => setSelfHostOpen(true))
        : undefined,
    [],
  );
  useEffect(() => {
    if (!SELF_HOST_ENABLED || !capabilities.selfHostManagement) return;
    void api.desktop?.selfHost
      ?.startSelfHostOnLaunch()
      .then((open) => {
        if (open) setSelfHostOpen(true);
      })
      .catch(console.error);
  }, []);
  const [collaborationTab, setCollaborationTab] = useState<
    'create' | 'join' | 'recover'
  >('create');
  const connectionRef = useRef<{ id?: string; connected: boolean } | null>(
    null,
  );
  useEffect(() => {
    if (!api.desktop) return;
    void requireDesktopApi(api)
      .getTestUsers()
      .then((state) => {
        if (state.isTestUser) setHome(false);
      });
  }, []);
  const [collaboration, setCollaboration] = useState<CollaborationState>({
    active: false,
    connected: false,
    members: [],
    locks: [],
  });
  const updatePrompted = useRef(false);
  useEffect(() => {
    if (preview || !capabilities.appUpdates || !api.desktop) return;
    let mounted = true,
      eventReceived = false;
    const prompt = (state: import('../../contracts/desktop').UpdateState) => {
      if (
        !mounted ||
        updatePrompted.current ||
        !state.available ||
        !['downloading', 'ready'].includes(state.status)
      )
        return;
      updatePrompted.current = true;
      setUpdateOpen(true);
    };
    const unsubscribe = requireDesktopApi(api).onUpdateChanged((state) => {
      eventReceived = true;
      prompt(state);
    });
    void requireDesktopApi(api)
      .getUpdateState()
      .then((state) => {
        if (!eventReceived) prompt(state);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  const [updateRestarting, setUpdateRestarting] = useState(false);
  const restartGuard = useRef<() => string[]>(() => [
    '앱을 불러오고 있습니다.',
  ]);
  useEffect(() => {
    if (!capabilities.appUpdates || !api.desktop) return;
    const requested = requireDesktopApi(api).onUpdateRestartRequested(
      async () => {
        const blockers = restartGuard.current();
        if (!blockers.length) flushSync(() => setUpdateRestarting(true));
        return blockers;
      },
    );
    const released = requireDesktopApi(api).onUpdateRestartReleased(() =>
      setUpdateRestarting(false),
    );
    return () => {
      requested();
      released();
    };
  }, []);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [compareFirst, setCompareFirst] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<{
    undo: string | null;
    redo: string | null;
  }>({ undo: null, redo: null });
  const [legacyEditBusy, setEditBusy] = useState(false);
  const [editStates, setEditStates] = useState<
    Record<string, { dirty: boolean; saving: boolean; failed: boolean }>
  >({});
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [viewZoom, setViewZoom] = useState(1);
  const panPrevious = useRef<CanvasTool | null>(null);
  const snapLatest = useRef<{ id: string; x: number; y: number } | null>(null);
  const [aiResultPaths, setAiResultPaths] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    root: null,
    name: null,
  });
  const draftRegistry = useMemo(
    () => new DraftFlusherRegistry(),
    [workspace.saveScope, workspace.session?.sessionId],
  );
  const clipboardWorkspaceRef = useRef(workspace);
  clipboardWorkspaceRef.current = workspace;
  const [canvasSheets, setCanvasSheets] = useState<CanvasSheets>(() =>
    readCanvasSheets(),
  );
  const [activeCanvas, setActiveCanvas] = useState('default');
  const activeCanvasRef = useRef('default');
  const selectionScope = useSelectionScope({
    root: workspace.root,
    saveScope: workspace.saveScope,
    sessionId: workspace.session?.sessionId,
    epoch: workspace.session?.epoch,
    canvasId: activeCanvas,
    home,
  });

  const canvasProjectRef = useRef<string | null>(null);
  const switchingCanvasRef = useRef(false);
  const pendingCanvasJump = useRef<string | null>(null);
  const firstCanvasView = useRef<string | null>(null);
  const navigateCanvasItem = useRef<((id: string) => void) | null>(null);
  const [documents, setDocuments] = useState<CanvasDocument[]>([]);
  const linkDocumentsRef = useRef(documents);
  const linkScopeRef = useRef(workspace.root);
  linkScopeRef.current = workspace.root;
  const openingLink = useRef(false);
  const openLinkRef = useRef<(href: string) => Promise<void>>(async () => {});
  const dispatchDocumentLink = useCallback((href: string) => {
    void openLinkRef
      .current(href)
      .catch((error) =>
        setNotice(error instanceof Error ? error.message : String(error)),
      );
  }, []);
  linkDocumentsRef.current = documents;
  const [temporaryDocuments, setTemporaryDocuments] = useState<string[]>([]);
  const linkComposing = useRef(false);
  useEffect(() => {
    const start = () => {
      linkComposing.current = true;
    };
    const end = () => {
      linkComposing.current = false;
    };
    window.addEventListener('compositionstart', start);
    window.addEventListener('compositionend', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('compositionstart', start);
      window.removeEventListener('compositionend', end);
      window.removeEventListener('blur', end);
    };
  }, []);
  useEffect(() => {
    setTemporaryDocuments([]);
  }, [workspace.root]);
  const [statusSettings, setStatusSettings] = useState<{
    value: DocumentStatuses;
    raw: string | null;
  }>({ value: defaultStatuses(), raw: null });
  const [loadedProjectRoot, setLoadedProjectRoot] = useState<string | null>(
    null,
  );
  const [statusError, setStatusError] = useState('');
  const [kanbanView, setKanbanView] = useState<{
    value: KanbanView;
    raw: string | null;
  }>({ value: defaultKanbanView(), raw: null });
  const [kanbanViewError, setKanbanViewError] = useState('');
  const { workflowBusy, setWorkflow, workflowChange, moveKanbanCard } =
    useFileWorkflow(selectionScope, () => ({
      workflowEditable,
      api,
      loadProject,
      showError,
      documents,
      previews,
      kanbanView,
    }));
  const personalScope = collaboration.projectId
    ? `${collaboration.projectId}:${collaboration.memberId}`
    : (workspace.root ?? 'none');
  const [storedFilePropertyViews, updateFilePropertyViews] =
    usePersonalValue<FilePropertyViews>(
      `file-property-views:${personalScope}`,
      emptyFilePropertyViews,
    );
  const filePropertyViews = useMemo(
    () => readFilePropertyViews(storedFilePropertyViews),
    [storedFilePropertyViews],
  );
  const propertyVisibilityFor = (id: string, previousIds: string[] = []) =>
    [id, ...previousIds]
      .filter((key) => Object.hasOwn(filePropertyViews.files, key))
      .map((key) => filePropertyViews.files[key])[0] ?? {};
  const [minimapStored, updateMiniMapPreferences] = usePersonalValue(
    `minimap-view:${personalScope}`,
    defaultMiniMapPreferences,
  );
  const minimapPreferences = readMiniMapPreferences(minimapStored);
  const [pluginPanelPage, setPluginPanelPage] =
    useState<PluginPanelPage>('plugins');
  const [pluginPanelGeometry, updatePluginPanelGeometry] = usePersonalValue(
    `plugin-controls:${personalScope}`,
    defaultPluginPanelGeometry,
  );
  useEffect(() => {
    setPluginPanelOpen(false);
    setPluginPanelPage('plugins');
  }, [personalScope]);
  const [sectionViews, updateSectionViews] = usePersonalValue<
    Record<string, boolean>
  >(`section-view:${personalScope}`, {});
  const [temporarySections, setTemporarySections] = useState<string[]>([]);
  const [newFileNodes, setNewFileNodes] = useState<Set<string>>(new Set());
  const newFileIndicatorsRef = useRef<{
    root: string | null;
    value?: NewFileIndicators;
  }>({ root: null });
  const saveNewFileIndicators = (root: string, value: NewFileIndicators) => {
    try {
      preferences.setItem(
        `game-canvas-new-files:${root}`,
        JSON.stringify(value),
      );
    } catch {
      /* Personal UI state is best effort. */
    }
  };
  const acknowledgeNewFiles = useCallback((ids: readonly string[]) => {
    const current = newFileIndicatorsRef.current;
    if (!current.root || !current.value?.unread.length || !ids.length) return;
    const selected = new Set(ids);
    const unread = current.value.unread.filter((id) => !selected.has(id));
    if (unread.length === current.value.unread.length) return;
    current.value = {
      ...current.value,
      unread,
    };
    saveNewFileIndicators(current.root, current.value);
    setNewFileNodes(new Set(current.value.unread));
  }, []);
  const acknowledgeNewFile = useCallback(
    (id: string) => acknowledgeNewFiles([id]),
    [acknowledgeNewFiles],
  );
  const [taskDocuments, setTaskDocuments] = useState<CanvasDocument[]>([]);
  const [htmlLinkDocuments, setHtmlLinkDocuments] = useState<CanvasDocument[]>(
    [],
  );
  const allLinkDocuments = useMemo(
    () => [...documents, ...htmlLinkDocuments],
    [documents, htmlLinkDocuments],
  );
  linkDocumentsRef.current = allLinkDocuments;
  const [sections, setSections] = useState<CanvasSection[]>([]);
  const [previews, setPreviews] = useState<PreviewResult[]>([]);
  const [previewWindows, setPreviewWindows] = useState<
    Record<string, PreviewWindowState>
  >({});
  const [creatingTask, setCreatingTask] = useScopedPrompt(
    JSON.stringify([
      workspace.root,
      workspace.saveScope,
      workspace.session?.sessionId,
      workspace.session?.epoch,
      home,
    ]),
    false,
  );
  const creatingTaskRef = useRef(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const {
    setHistoryEntries,
    setHistorySelection,
    setAiHistorySelection,
    openHistory,
    historyConfirm,
    restoring,
    historyEntries,
    historyAiOnly,
    historyFilter,
    setHistoryConfirm,
    setRestoring,
    aiHistorySelection,
    historySelection,
    historyRequest,
    setHistoryAiOnly,
    inspectHistory,
    restoreSelectedHistory,
  } = useWorkspaceHistory(selectionScope, () => ({
    setHistoryOpen,
    setNavigatorOpen,
    setInspectorId,
    setSettingsOpen,
    setCodexRunCollapsed,
    api,
    showError,
    locked,
    onBlocked,
    blockAiFiles,
    editorsRef,
    loadProject,
    setNotice,
  }));
  const knownPreviewsRef = useRef<{ root: string | null; paths: Set<string> }>({
    root: null,
    paths: new Set(),
  });
  const editorsRef = useRef(
    new Map<string, (finish?: boolean) => Promise<void>>(),
  );
  const {
    nodes,
    setNodes,
    onNodesChange,
    selectedIds,
    setSelectedIds,
    selectedSectionIds,
    setSelectedSectionIds,
    selectionBeforeClick,
    selectionPointer,
    cancelSelectionDrag,
  } = useCanvasSelection<CanvasNode>();
  useEffect(() => {
    setTemporarySections((current) => {
      const next = current.filter((id) =>
        sections
          .find((s) => s.id === id)
          ?.members.some((m) => selectedIds.includes(m.id)),
      );
      return next.length === current.length ? current : next;
    });
  }, [selectedIds, sections]);
  const [notice, setNotice] = useState('프로젝트 폴더를 열어 시작하세요.');
  const {
    openImport,
    importTarget,
    importingFiles,
    setImportTarget,
    setImportingFiles,
    setImportError,
    imagePurpose,
    setImagePurpose,
    importError,
    importFiles,
    dropFiles,
  } = useWorkspaceImport(selectionScope, () => ({
    capabilities,
    setNotice,
    locked,
    onBlocked,
    workspace,
    openWorkspace,
    flowRef,
    api,
    activeCanvasRef,
    loadProject,
    showError,
    selectCreated,
  }));
  const [loading, setLoading] = useState(true);
  const [tool, setTool] = useState<CanvasTool>('select');
  const drawing = useDrawing(workspace.saveScope, activeCanvas);
  const gameUi = useGameUi(workspace.saveScope);
  const [gameUiSettings, setGameUiSettings] = usePersonalValue(
    `builtin.game-ui:${personalScope}`,
    { enabled: true },
  );

  const [eraserSettings, setEraserSettings] = usePersonalValue<{
    mode: EraserMode;
    size: number;
  }>(`drawing.eraser:${personalScope}`, { mode: 'stroke', size: 24 });
  const partialEraseSupported =
    !collaboration.active || collaboration.drawingEraseVersion === 1;
  const eraserMode: EraserMode =
    partialEraseSupported && eraserSettings.mode === 'partial'
      ? 'partial'
      : 'stroke';
  const eraserSize = Number.isFinite(eraserSettings.size)
    ? Math.max(4, Math.min(80, Math.round(eraserSettings.size)))
    : 24;
  const [eraserPreview, setEraserPreview] = useState<EraserPreview>(new Map());
  const [drawingTool, setDrawingTool] = useState<DrawingTool>('rectangle');
  const [drawingStyle, setDrawingStyle] = useState<DrawingStyle>({
    ...DEFAULT_SHAPE_STYLE,
  });
  const [drawingPressure, setDrawingPressure] = useState(true),
    [drawingTouch, setDrawingTouch] = useState(false),
    [drawingContinuous, setDrawingContinuous] = useState(false),
    [drawingGesture, setDrawingGesture] = useState(false);
  const { copyCanvasSelection, pasteCanvasSelection } = useCanvasClipboard(
    selectionScope,
    workspace.clipboardContextId,
    () => ({
      capabilities,
      setNotice,
      documents,
      selectedIds,
      nodes,
      clipboardWorkspaceRef,
      api,
      showError,
      locked,
      onBlocked,
      activeCanvasRef,
      flowRef,
      cancelNoteDrawing,
      cancelSelectionDrag,
      drawingGesture,
      drawingCopies,
      drawing,
      loadProject,
      setSelectedIds,
      setSelectedSectionIds,
      imagePurpose,
      textSupported:
        !collaboration.active || collaboration.drawingTextVersion === 1,
      selectCreated,
    }),
  );
  const createdDrawingSelection = useRef<string | null>(null);
  const submitDrawing = useCallback(
    (command: Omit<DrawingCommand, 'canvasId' | 'scope'>) => {
      void drawing.submit(command).catch((e) => {
        createdDrawingSelection.current = null;
        setEraserPreview(new Map());
        setNotice(e instanceof Error ? e.message : String(e));
      });
    },
    [drawing.submit],
  );
  const chooseDrawingTool = (next: DrawingTool) => {
    if (!dockPanel || dockPanel === 'properties') setDockPanel('properties');
    if (collaboration.active && collaboration.drawingsVersion !== 1) {
      setNotice('도형 · 그림 편집을 사용하려면 협업 서버를 업데이트해주세요.');
      return;
    }
    firstCanvasView.current = null;
    setSelectedIds([]);
    setSelectedSectionIds([]);
    setNodes((current) => current.map((n) => ({ ...n, selected: false })));
    setInspectorId(null);
    setDrawingTool(next);
    setDrawingStyle({
      ...(next === 'pen'
        ? {
            ...DEFAULT_PEN_STYLE,
            stroke: theme === 'dark' ? '#e2e8f0' : DEFAULT_PEN_STYLE.stroke,
          }
        : next === 'highlighter'
          ? DEFAULT_HIGHLIGHT_STYLE
          : DEFAULT_SHAPE_STYLE),
    });
    setTool('drawing');
  };
  const [noteDraft, setNoteDraft] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  const noteGesture = useRef<{
    pointerId: number;
    sheet: string;
    root: string;
    start: { x: number; y: number };
    flowStart: { x: number; y: number };
  } | null>(null);
  const creatingNote = useRef(false);
  const cancelNoteDrawing = () => {
    noteGesture.current = null;
    setNoteDraft(null);
  };
  useEffect(() => {
    if (tool !== 'note' || home) cancelNoteDrawing();
  }, [tool, home]);
  useEffect(() => {
    cancelNoteDrawing();
  }, [activeCanvas, workspace.root]);
  const [uiHidden, setUiHidden] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useScopedPrompt<{
    x: number;
    y: number;
    targets: SelectionMenuTargets;
  } | null>(selectionScopeKey(selectionScope), null);
  const [projectCopyPrompt, setProjectCopyPrompt] = useScopedPrompt<Omit<
    ProjectCopyRequest,
    'targetId' | 'canvasId' | 'requestId'
  > | null>(selectionScopeKey(selectionScope), null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !(event.target as Element).closest('.canvas-context-menu')
      )
        setSelectionContextMenu(null);
    };
    if (selectionContextMenu) {
      window.addEventListener('pointerdown', close);
      window.addEventListener('keydown', close);
    }
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [selectionContextMenu, setSelectionContextMenu]);
  const [overlapMenu, setOverlapMenu] = useState<{
    x: number;
    y: number;
    ids: string[];
  } | null>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.drawing-overlap-menu'))
        setOverlapMenu(null);
    };
    if (overlapMenu) window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [overlapMenu]);
  useEffect(() => setOverlapMenu(null), [activeCanvas, workspace.saveScope]);
  const [documentContextMenu, setDocumentContextMenu] =
    useState<DocumentContextMenuState | null>(null);
  const [sectionContextMenu, setSectionContextMenu] =
    useState<SectionContextMenuState | null>(null);
  const [previewContextMenu, setPreviewContextMenu] =
    useState<PreviewContextMenuState | null>(null);
  const {
    movingCanvasItems,
    setMovingCanvasItems,
    moveCanvasTarget,
    setMoveCanvasTarget,
    canvasOperationBusy,
    setCanvasOperationBusy,
    resultFolderPrompt,
    setResultFolderPrompt,
    movingResults,
    setMovingResults,
    moveCanvasItems,
    saveResultFolder,
  } = useWorkspaceTransfers(selectionScope, () => ({
    api,
    canvasSheets,
    flushEditors,
    loadProject,
    changeSheets,
    canvasBatch,
    setSelectedIds,
    setSelectedSectionIds,
    setNotice,
    showError,
  }));
  const noticeProject = collaboration.projectId ?? workspace.root;
  useEffect(() => {
    restorePanelScope(home ? null : noticeProject);
  }, [home, noticeProject, restorePanelScope]);
  useEffect(() => {
    setApprovalInboxFocusId(undefined);
    setDiscordApprovalOpen(false);
    setMaterialPicker(null);
    setMaterialFocus(null);
    setEraserPreview(new Map());
  }, [noticeProject]);
  useEffect(() => {
    if (collaboration.active && collaboration.role !== 'admin')
      setDiscordApprovalOpen(false);
  }, [collaboration.active, collaboration.role]);
  useEffect(() => {
    try {
      preferences.setItem('gamejam:minimap-visible', String(minimapVisible));
    } catch {
      /* Layout storage is optional. */
    }
  }, [minimapVisible]);
  useEffect(() => {
    setNoticeVisible(true);
    const timer = window.setTimeout(() => setNoticeVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (inspectorId) setDockPanel('properties');
  }, [inspectorId, setDockPanel]);
  const {
    aiRequest,
    setAiRequest,
    editingApproval,
    setEditingApproval,
    approvalCopyFrom,
    setApprovalCopyFrom,
    aiRequestPage,
    setAiRequestPage,
    aiRequestVisited,
    setAiRequestVisited,
    aiInstructionPage,
    setAiInstructionPage,
    aiRequestSubmitError,
    setAiRequestSubmitError,
    savedAiDraft,
    setSavedAiDraft,
    aiDraftStatus,
    setAiDraftStatus,
    aiRequestRetryOf,
    loadingAiRequest,
    aiRequestDialogRef,
    selectedAiProvider,
    setSelectedAiProvider,
    selectedAiModel,
    setSelectedAiModel,
    selectedAiReasoning,
    setSelectedAiReasoning,
    changeAiModel,
    activeAiInstruction,
    navigateAiPage,
    focusAiIssue,
    advanceAiPage,
    previousAiPage,
    aiDraftScope,
    initializeAiRequest,
    closeAiRequest,
    reuseAiEntry,
    loadRecentAiRequest,
  } = useGamejamRequest({
    project: noticeProject,
    memberId: collaboration.active ? collaboration.memberId : undefined,
    sessionId: workspace.session?.sessionId,
    home,
    canvases: canvasSheets.canvases,
    activeCanvas: activeCanvasRef.current,
    onProviderChanged: () => setCodexStatus(null),
    onOpen: () => setHistoryOpen(false),
  });
  useEffect(() => {
    setMaterialPicker(null);
    setMaterialFocus(null);
  }, [aiRequest === null, editingApproval?.id]);
  const runScopeRef = useRef({
    project: noticeProject,
    home,
    sessionId: workspace.session?.sessionId,
  });
  runScopeRef.current = {
    project: noticeProject,
    home,
    sessionId: workspace.session?.sessionId,
  };
  const {
    preparingTask,
    setCodexStatus,
    setCodexRunCollapsed,
    codexRun,
    aiQueue,
    setAiQueue,
    codexStatus,
    checkingCodex,
    setCheckingCodex,
    setCodexRun,
    setCompletion,
    runPanelVisible,
    completionVisible,
    completion,
    closeCompletion,
    closeRunPanel,
    runFailure,
    runOutputPaths,
    codexRunCollapsed,
    cancellingCodexRun,
    refreshCodexStatus,
    runTaskWithCodex,
    cancelCodexRun,
    codexLogsRef,
  } = useAiRun(
    {
      noticeProject,
      preferences,
      setApprovalInboxOpen,
      taskDocuments,
      aiResultPaths,
      home,
      collaboration,
      workspace,
      capabilities,
      selectedAiProvider,
      api,
      runScopeRef,
      selectedAiModel,
      selectedAiReasoning,
      setInspectorId,
      setHistoryOpen,
      setSettingsOpen,
    },
    () => ({
      queueSupported,
      showError,
      setNotice,
      loadProject,
      canRunAi,
      aiBusy,
      locked,
      onBlocked,
      editorsRef,
    }),
  );
  const {
    resizeDocument,
    resizeSection,
    persistDraggedNodes,
    persistResizedNodes,
    pendingGeometry,
    geometryEpoch,
  } = useCanvasGeometry(selectionScope, () => ({
    sections,
    api,
    loadProject,
    showError,
    gameUi,
    blockAiFiles,
    updatePreviewWindow,
    updatePreviewWindows,
    locked,
    sectionCollapsed,
    canvasBatch,
    activeCanvasRef,
    drawing,
    setNotice,
    setMembershipPrompt,
  }));
  const sectionPrompts = useSectionPrompts(selectionScope);
  const {
    createPrompt,
    setCreatePrompt,
    sectionActionPrompt,
    setSectionActionPrompt,
    membershipPrompt,
    setMembershipPrompt,
    sectionRename,
    setSectionRename,
  } = sectionPrompts;
  const sectionPromptsRef = useRef(sectionPrompts);
  sectionPromptsRef.current = sectionPrompts;
  const sectionDialogOpen = !!createPrompt;
  const sectionTitle = createPrompt?.title ?? '새 섹션';
  const setSectionTitle = (title: string) =>
    setCreatePrompt((current) => (current ? { ...current, title } : current));
  const setSectionDialogOpen = (open: boolean) =>
    setCreatePrompt(
      open
        ? {
            title: '새 섹션',
            documents: structuredClone(
              documents.filter((doc) => selectedIds.includes(doc.id)),
            ),
          }
        : null,
    );
  const { actions: sectionActions, busy: sectionBusy } = useSectionActions(
    selectionScope,
    () => ({
      editor: api.editor,
      busy: legacyEditBusy || selectionBusy || collapseBusy,
      canEdit: (paths) => {
        if (blockAiFiles(paths)) return false;
        if (locked) {
          onBlocked();
          return false;
        }
        return true;
      },
      reload: () => loadProject(false),
      notice: setNotice,
      error: showError,
    }),
  );
  const openSectionDialog = (open: boolean) => {
    if (!editBusy) setSectionDialogOpen(open);
  };
  const selectionPrompts = useSelectionDeletePrompts(selectionScope);
  const selectCreated = useCreatedSelection(selectionScope, nodes, setNodes);
  const {
    deletePrompt,
    setDeletePrompt,
    deleteManyPrompt,
    setDeleteManyPrompt,
    deleteDrawingTargets,
    setDeleteDrawingTargets,
    deleteSectionTargets,
    setDeleteSectionTargets,
  } = selectionPrompts;
  const selectionPromptsRef = useRef(selectionPrompts);
  selectionPromptsRef.current = selectionPrompts;
  const { actions: selectionActions, busy: selectionBusy } =
    useSelectionActions(selectionScope, () => ({
      editor: api.editor,
      preview: api.preview,
      environment: { now: Date.now, id: () => crypto.randomUUID() },
      busy: legacyEditBusy || sectionBusy || collapseBusy,
      canEdit: (paths) => {
        if (blockAiFiles(paths)) return false;
        if (locked) {
          onBlocked();
          return false;
        }
        return true;
      },
      flush: async (guard) => {
        const gameFlush = gameUi.flush,
          drawingFlush = drawing.flush,
          editors = [...editorsRef.current.values()];
        guard();
        await gameFlush();
        guard();
        await drawingFlush();
        guard();
        await Promise.all(
          editors.map((flush) => {
            guard();
            return flush();
          }),
        );
        guard();
      },
      flushDrawings: drawing.flush,
      reloadDrawings: drawing.reload,
      submitDrawing,
      reload: () => loadProject(false),
      notice: setNotice,
      error: showError,
    }));
  const sectionViewsRef = useRef(sectionViews);
  sectionViewsRef.current = sectionViews;
  const { actions: collapseActions, busy: collapseBusy } = useCollapseActions(
    selectionScope,
    () => ({
      busy: legacyEditBusy || selectionBusy || sectionBusy,
      editor: api.editor,
      canCollapse: (paths) => !blockAiFiles(paths),
      flush: async (guard, mode) => {
        const gameFlush = gameUi.flush,
          drawingFlush = drawing.flush,
          editors = [...editorsRef.current.values()];
        guard();
        if (mode === 'all') {
          await gameFlush();
          guard();
          await drawingFlush();
          guard();
        }
        await Promise.all(
          editors.map((flush) => {
            guard();
            return flush();
          }),
        );
        guard();
      },
      sectionViews: (ids, collapsed) => {
        const next = {
          ...sectionViewsRef.current,
          ...Object.fromEntries(ids.map((id) => [id, collapsed])),
        };
        sectionViewsRef.current = next;
        updateSectionViews(next);
      },
      clearTemporarySections: (ids) =>
        setTemporarySections((current) =>
          ids ? current.filter((id) => !ids.includes(id)) : [],
        ),
      clearTemporaryDocument: (id) =>
        setTemporaryDocuments((current) =>
          current.filter((item) => item !== id),
        ),
      selectCollapsedSection: (section) => {
        const members = new Set(section.members.map((member) => member.id));
        setSelectedIds((current) => current.filter((id) => !members.has(id)));
        setSelectedSectionIds([section.id]);
        (document.activeElement as HTMLElement | null)?.blur();
      },
      savePreview: async (relative, state, guard) => {
        const normalized = normalizePreviewWindow(state);
        guard();
        setPreviewWindows((current) => ({
          ...current,
          [relative]: normalized,
        }));
        try {
          await api.preview.savePreviewWindow(normalized, relative);
        } catch (error) {
          guard();
          showError(error);
        }
        guard();
      },
      reload: () => loadProject(false),
      notice: setNotice,
      error: showError,
    }),
  );
  const editBusy =
    legacyEditBusy || selectionBusy || sectionBusy || collapseBusy;

  const organizedSets = documentSets(documents.map((doc) => doc.relativePath));
  const documentChoiceForUpdate = (baseDir: string) => {
    const group = organizedSets.find((set) => set.baseDir === baseDir);
    return {
      mode: 'update' as const,
      baseDir,
      ...(group?.structure === 'custom'
        ? {
            structure: 'custom' as const,
            documents: group.paths.map((path) => {
              const doc = documents.find((item) => item.relativePath === path)!;
              return {
                key:
                  doc.outputKey ??
                  path.match(/document-(d\d+)\.md$/)?.[1] ??
                  'd1',
                title: doc.title,
                type: (['overview', 'system', 'question'].includes(doc.type)
                  ? doc.type
                  : 'system') as DocumentOutputTemplate['type'],
                instructions: doc.outputInstructions ?? '',
              };
            }),
          }
        : {}),
    };
  };
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = preferences.getItem('game-canvas-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  });
  const flowRef = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  useCanvasRegions(home, flowRef);
  const documentSaveStates = useRef(new Map<string, DocumentSaveState>());
  const reportEdit = useCallback(
    (id: string, state: { dirty: boolean; saving: boolean; failed: boolean }) =>
      setEditStates((current) =>
        JSON.stringify(current[id]) === JSON.stringify(state)
          ? current
          : { ...current, [id]: state },
      ),
    [],
  );
  useEffect(() => {
    if (inspectorId) {
      setHistoryOpen(false);
      setSettingsOpen(false);
      setCodexRunCollapsed(true);
    }
  }, [inspectorId]);
  useEffect(() => {
    if (settingsOpen) {
      setInspectorId(null);
      setHistoryOpen(false);
      setCodexRunCollapsed(true);
    }
  }, [settingsOpen]);
  useEffect(() => {
    if (navigatorOpen) setHistoryOpen(false);
  }, [navigatorOpen]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    preferences.setItem('game-canvas-theme', theme);
  }, [theme]);

  const showError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setNotice(message.replace(/^Error invoking remote method '[^']+': /, ''));
    if (message.includes('잠시 사용할 수 없습니다'))
      setBlockedMessage(
        message.replace(/^Error invoking remote method '[^']+': /, ''),
      );
  };

  const aiBusy =
    preparingTask ||
    (!!codexRun &&
      (!collaboration.active || collaboration.connected) &&
      ['starting', 'running', 'validating'].includes(codexRun.status)) ||
    (collaboration.connected &&
      !!collaboration.aiRun &&
      ['starting', 'running', 'validating'].includes(
        collaboration.aiRun.status,
      ));
  const queueSupported =
    !collaboration.active || collaboration.aiQueueVersion === 1;
  const projectAiQueue = collaboration.active
    ? (collaboration.aiQueue ?? EMPTY_AI_QUEUE)
    : aiQueue;
  useEffect(() => {
    let active = true;
    let version = 0;
    setAiQueue([]);
    if (!noticeProject || home || collaboration.active || !api.ai.listAiQueue)
      return;
    const refresh = () => {
      const request = ++version;
      void api.ai
        .listAiQueue()
        .then((tasks) => {
          if (active && request === version) setAiQueue(tasks);
        })
        .catch(showError);
    };
    refresh();
    const stop = api.projects.onWorkspaceChanged(refresh);
    const stopRuns = api.ai.onCodexRunEvent(refresh);
    return () => {
      active = false;
      stop();
      stopRuns();
    };
  }, [noticeProject, home, collaboration.active]);
  const canRunAi =
    capabilities.localAiExecution &&
    (!collaboration.active ||
      (collaboration.connected &&
        !collaboration.pendingChanges &&
        collaboration.role === 'admin'));
  const submittingApproval =
    collaboration.active &&
    (collaboration.role === 'editor' ||
      !!editingApproval ||
      !!approvalCopyFrom);
  const canWriteAiRequest =
    (capabilities.localAiExecution && !collaboration.active) ||
    (collaboration.active &&
      !collaboration.accessDenied &&
      (collaboration.role === 'editor' ||
        (collaboration.role === 'admin' && capabilities.localAiExecution)));
  const canRestoreHistory =
    !collaboration.active ||
    (collaboration.connected &&
      !collaboration.pendingChanges &&
      collaboration.role === 'admin');
  const canStopAi =
    !collaboration.active ||
    (collaboration.connected &&
      (collaboration.role === 'admin' ||
        (collaboration.role === 'editor' &&
          collaboration.aiRun?.actorId === collaboration.memberId)));
  const locked =
    updateRestarting ||
    (aiBusy &&
      !(collaboration.active
        ? collaboration.aiRun?.fileLock
        : codexRun?.fileLock)) ||
    (collaboration.active &&
      ((!collaboration.connected && !collaboration.offlineSync) ||
        collaboration.accessDenied ||
        collaboration.role === 'viewer'));
  const aiFileLock = useMemo(
    () =>
      mergeAiFileLocks([
        queueFileLock(projectAiQueue),
        aiBusy
          ? collaboration.active
            ? collaboration.aiRun?.fileLock
            : codexRun?.fileLock
          : undefined,
      ]),
    [
      projectAiQueue,
      aiBusy,
      collaboration.active,
      collaboration.aiRun?.fileLock,
      codexRun?.fileLock,
    ],
  );
  const multiplayerChoiceRequired =
    !!aiRequest?.implement &&
    aiRequest.sourceMode === 'html-compose' &&
    !aiRequest.htmlResult?.basePath &&
    aiRequest.inputPaths.filter((path) => path.endsWith('.html')).length > 1 &&
    previews.some((preview) => {
      if (!aiRequest.inputPaths.includes(preview.relativePath)) return false;
      try {
        return !!readMultiplayerManifest(preview.content);
      } catch {
        return false;
      }
    });
  const textMaterials = useMemo(
    () => textMaterialItems(drawing.items),
    [drawing.items],
  );
  let effectiveAiRequest = aiRequest;
  let multiplayerIntentError = '';
  if (aiRequest) {
    try {
      effectiveAiRequest = resolveGamejamRequest(
        aiRequest,
        documents,
        previews,
        drawing.items,
      );
    } catch (error) {
      multiplayerIntentError = (error as Error).message;
    }
  }
  const aiRequestIssues = effectiveAiRequest
    ? gamejamIssues(effectiveAiRequest, {
        intent: submittingApproval ? 'request' : 'run',
        collaboration,
        multiplayerChoiceRequired,
        provider: selectedAiProvider,
        model: selectedAiModel,
        reasoningEffort: selectedAiReasoning,
        connection: codexStatus,
        checkingConnection: checkingCodex,
        aiBusy,
        queueSupported,
        locked,
        updateRestarting,
        availableInputs: [
          ...documents.map((doc) => doc.relativePath),
          ...sections.map((section) => section.relativePath),
          ...previews.map((preview) => preview.relativePath),
          ...textMaterials.map((item) => item.path),
        ],
      })
    : [];
  if (multiplayerIntentError)
    aiRequestIssues.push({
      field: 'multiplayer',
      message: multiplayerIntentError,
    });
  const aiPageIssues = aiRequestIssues.filter(
    (issue) =>
      gamejamFieldPage(issue.field) === aiRequestPage &&
      (aiRequestPage !== 3 || issue.field === activeAiInstruction),
  );
  const nextAiPage = () => advanceAiPage(aiPageIssues);
  const pathLocked = useCallback(
    (path: string) => locked || isAiFileLocked(aiFileLock, path),
    [locked, aiFileLock],
  );
  const sectionLocked = useCallback(
    (section: CanvasSection) =>
      pathLocked(section.relativePath) ||
      section.members.some((member) => pathLocked(member.path)),
    [pathLocked],
  );
  const blockAiFiles = (paths: string[]) => {
    if (!paths.some((path) => isAiFileLocked(aiFileLock, path))) return false;
    setBlockedMessage(AI_FILE_LOCK_MESSAGE);
    return true;
  };
  const onBlocked = useCallback(() => {
    setBlockedMessage(
      collaboration.active && !collaboration.connected
        ? '협업 서버 연결이 끊겼습니다. 문서 편집을 잠시 중지하고 저장되지 않은 초안은 보관합니다. 재연결 후 최신 내용을 확인해주세요.'
        : collaboration.role === 'viewer'
          ? '현재 뷰어 권한입니다. 관리자에게 편집자 권한을 요청해주세요.'
          : AI_FILE_LOCK_MESSAGE,
    );
  }, [
    codexRun?.taskPath,
    collaboration.active,
    collaboration.connected,
    collaboration.role,
  ]);
  useEffect(() => {
    void api.collaboration
      .getCollaboration()
      .then(setCollaboration)
      .catch(showError);
    return api.collaboration.onCollaborationChanged(setCollaboration);
  }, []);
  useEffect(() => {
    const scope = workspace.saveScope;
    if (!scope) return;
    let active = true;
    const apply = (state: DocumentSaveState) => {
      if (!active || state.scope !== scope) return;
      if (
        state.projectSession &&
        state.projectSession.sessionId !== workspace.session?.sessionId
      )
        return;
      const key = `${scope}:${state.documentId}`,
        previous = documentSaveStates.current.get(key);
      if (
        previous &&
        (previous.sequence > state.sequence ||
          (previous.sequence === state.sequence &&
            previous.savedSequence > state.savedSequence))
      )
        return;
      if (state.phase === 'discarded') {
        documentSaveStates.current.delete(key);
        return;
      }
      documentSaveStates.current.set(key, state);
      if (!state.document) {
        if (['queued', 'saving', 'offline'].includes(state.phase)) {
          const overlay = (items: CanvasDocument[]) =>
            items.map((item) =>
              item.id === state.documentId
                ? pendingDocument(item, state)
                : item,
            );
          setDocuments(overlay);
          setTaskDocuments(overlay);
        }
        return;
      }
      const confirmed = state.document;
      const replace = (items: CanvasDocument[]) =>
        items.map((item) => {
          if (
            item.id !== state.documentId ||
            item.relativePath !== state.relativePath ||
            (item.revision !== undefined &&
              confirmed.revision !== undefined &&
              item.revision > confirmed.revision) ||
            (item.revision === undefined &&
              item.modifiedAt > confirmed.modifiedAt)
          )
            return item;
          return JSON.stringify(item) === JSON.stringify(confirmed)
            ? item
            : confirmed;
        });
      setDocuments(replace);
      setTaskDocuments(replace);
    };
    const stop = api.saves.onDocumentSaveChanged(apply);
    void api.saves
      .getDocumentSaveStates()
      .then((states) => {
        if (active) states.forEach(apply);
      })
      .catch(showError);
    return () => {
      active = false;
      stop();
    };
  }, [workspace.saveScope, workspace.session?.sessionId]);
  const beginEdit = useCallback(async (document: CanvasDocument) => {
    try {
      await api.collaboration.acquireDocumentLock(document.relativePath);
    } catch (error) {
      showError(error);
      throw error;
    }
  }, []);
  const endEdit = useCallback(async (document: CanvasDocument) => {
    await api.collaboration.releaseDocumentLock(document.relativePath);
  }, []);
  const registerEditor = useCallback(
    (id: string, flush: ((finish?: boolean) => Promise<void>) | null) => {
      if (flush) editorsRef.current.set(id, flush);
      else editorsRef.current.delete(id);
    },
    [],
  );
  const { updatePreviewWindow, updatePreviewWindows, compareWindows } =
    usePreviewWindows(selectionScope, () => ({
      setPreviewWindows,
      api,
      showError,
      previewWindows,
      flowRef,
      setNotice,
    }));
  const previewWindowCache = useRef<{
    root: string | null;
    windows: Record<string, PreviewWindowState>;
  }>({ root: null, windows: {} });
  previewWindowCache.current = {
    root: workspace.root,
    windows: previewWindows,
  };
  const reconcile = <T extends { relativePath: string }>(
    current: T[],
    next: T[],
  ) => {
    const existing = new Map(current.map((item) => [item.relativePath, item]));
    const result = next.map((item) => {
      const old = existing.get(item.relativePath);
      return old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
    });
    return result.length === current.length &&
      result.every((item, index) => item === current[index])
      ? current
      : result;
  };
  useEffect(
    () =>
      api.saves.onDraftFlushRequested?.(async () => {
        await draftRegistry.flush();
      }),
    [draftRegistry],
  );
  useEffect(() => {
    const key = `drawing:${workspace.saveScope}`;
    return draftRegistry.register(key, drawing.flush);
  }, [draftRegistry, workspace.saveScope, drawing.flush]);
  useEffect(() => {
    const key = `game-ui:${workspace.saveScope}`;
    return draftRegistry.register(key, gameUi.flush);
  }, [draftRegistry, workspace.saveScope, gameUi.flush]);
  const reloadWorkspaceRef = useRef<() => void>(() => {});
  const workspaceData = useWorkspaceData(() => reloadWorkspaceRef.current());
  const { loadProject } = useProjectLoading(() => ({
    workspaceData,
    setWorkspace,
    setDocuments,
    setTaskDocuments,
    setHtmlLinkDocuments,
    setSections,
    setPreviews,
    setPreviewWindows,
    newFileIndicatorsRef,
    setNewFileNodes,
    setLoading,
    canvasProjectRef,
    activeCanvasRef,
    preferences,
    setActiveCanvas,
    setSelectedIds,
    setSelectedSectionIds,
    setNodes,
    setCanvasSheets,
    previewWindowCache,
    api,
    documentSaveStates,
    saveNewFileIndicators,
    setStatusError,
    setKanbanViewError,
    setKanbanView,
    setStatusSettings,
    setLoadedProjectRoot,
    reconcile,
    setUndoState,
    knownPreviewsRef,
    setInspectorId,
    setHistoryOpen,
    setHistoryEntries,
    setHistorySelection,
    setAiHistorySelection,
    setEditStates,
    setAiRequest,
    setAiResultPaths,
    setNotice,
    flowRef,
    showError,
  }));
  reloadWorkspaceRef.current = () => void loadProject(false);
  useEffect(() => {
    void loadProject(true);
  }, [loadProject]);

  useEffect(() => {
    const onFrameFocus = () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active?.tagName === 'IFRAME') {
          const id = active
            .closest('.react-flow__node')
            ?.getAttribute('data-id');
          if (id) acknowledgeNewFile(id);
        }
      });
    };
    window.addEventListener('blur', onFrameFocus);
    return () => window.removeEventListener('blur', onFrameFocus);
  }, [acknowledgeNewFile]);

  useEffect(() => {
    if (!historyOpen) return;
    return api.projects.onWorkspaceChanged(() => {
      void api.history.listHistory().then(setHistoryEntries).catch(showError);
    });
  }, [historyOpen]);

  const saveDocument = useCallback(
    async (document: CanvasDocument, title: string, body: string) => {
      try {
        const confirmed = await api.editor.saveDocument({
          relativePath: document.relativePath,
          revision: document.revision,
          objectId: document.id,
          structureRevision: document.structureRevision,
          contentRevision: document.contentRevision,
          expectedTitle: document.title,
          expectedBody: document.body,
          title,
          body,
        });
        if (confirmed) {
          setDocuments((current) =>
            current.map((item) =>
              item.relativePath === confirmed.relativePath ? confirmed : item,
            ),
          );
          setTaskDocuments((current) =>
            current.map((item) =>
              item.relativePath === confirmed.relativePath ? confirmed : item,
            ),
          );
        }
      } catch (error) {
        showError(error);
        throw error;
      }
    },
    [loadProject],
  );

  const focusSource = useCallback(
    (id: string) => {
      const target = documents.find((document) => document.id === id);
      if (!target) {
        const preview = previews.find((item) => item.sourceId === id);
        if (preview) {
          if (canvasId(preview.canvasId) !== activeCanvasRef.current) {
            navigateCanvasItem.current?.(previewNodeId(preview.relativePath));
            return;
          }
          const layout = previewWindows[preview.relativePath];
          if (layout)
            void flowRef.current?.setCenter(
              layout.x + layout.width / 2,
              layout.y + layout.height / 2,
              { zoom: 1, duration: 500 },
            );
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              selected: node.id === previewNodeId(preview.relativePath),
            })),
          );
          return;
        }
        setNotice(`출처 '${id}' 문서를 찾지 못했습니다.`);
        return;
      }
      if (canvasId(target.canvasId) !== activeCanvasRef.current) {
        navigateCanvasItem.current?.(target.id);
        return;
      }
      void flowRef.current?.setCenter(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { zoom: 1, duration: 500 },
      );
      setSelectedIds([target.id]);
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: node.id === target.id })),
      );
    },
    [documents, previews, previewWindows, setNodes],
  );

  const copyTask = useCallback(async (document: CanvasDocument) => {
    await requireDesktopApi(api).copyText(
      `# ${document.title}\n\n${document.body}`,
    );
    setNotice('AI 작업 요청을 클립보드에 복사했습니다.');
  }, []);

  const revealDocument = useCallback(async (document: CanvasDocument) => {
    await requireDesktopApi(api).revealPath(document.relativePath);
  }, []);

  const revealSection = useCallback(async (section: CanvasSection) => {
    await requireDesktopApi(api).revealPath(section.relativePath);
  }, []);

  const toggleDocumentCollapsed = (document: CanvasDocument) => {
    const origin = documentContextMenu;
    return collapseActions.document(document, { menu: true }, () =>
      setDocumentContextMenu((current) =>
        current === origin ? null : current,
      ),
    );
  };

  const deleteDocument = () => {
    const target = deletePrompt;
    if (!target) return;
    return selectionActions.deleteOne(
      target,
      () => {
        setDeletePrompt((current) => (current === target ? null : current));
        setSelectedIds((current) => current.filter((id) => id !== target.id));
      },
      () => setDeletePrompt((current) => (current === target ? null : current)),
    );
  };
  const confirmDeleteMany = () => {
    const target = deleteManyPrompt;
    if (!target) return;
    return selectionActions.deleteMany(
      {
        documents: target,
        drawings: deleteDrawingTargets,
        sections: deleteSectionTargets,
      },
      () => {
        if (selectionPromptsRef.current.deleteManyPrompt !== target) return;
        setDeleteDrawingTargets([]);
        setDeleteSectionTargets([]);
        setDeleteManyPrompt(null);
      },
    );
  };

  const confirmSectionAction = () => {
    const prompt = sectionActionPrompt;
    if (!prompt) return;
    return sectionActions.remove(prompt, () => {
      if (sectionPromptsRef.current.sectionActionPrompt !== prompt) return;
      setSectionActionPrompt(null);
      setSectionContextMenu(null);
      setSelectedSectionIds((current) =>
        current.filter((id) => id !== prompt.section.id),
      );
      if (prompt.deleteMembers)
        setSelectedIds((current) =>
          current.filter(
            (id) => !prompt.section.members.some((member) => member.id === id),
          ),
        );
    });
  };

  const sourceTitles = useMemo(
    () =>
      Object.fromEntries([
        ...documents.map((item) => [item.id, item.title]),
        ...previews
          .filter((item) => item.sourceId)
          .map((item) => [
            item.sourceId!,
            item.title ?? previewLabel(item.relativePath),
          ]),
      ]),
    [
      documents.map((item) => `${item.id}:${item.title}`).join('|'),
      previews.map((item) => `${item.sourceId}:${item.title}`).join('|'),
    ],
  );
  const workflowEditable =
    !statusError &&
    (!collaboration.active ||
      (['admin', 'editor'].includes(collaboration.role ?? '') &&
        collaboration.documentStatusesVersion === 1 &&
        collaboration.filePropertiesVersion === 1));
  const workflowReason = workflowBusy
    ? '상태를 저장하고 있습니다. 잠시 후 다시 선택해주세요.'
    : statusError ||
      (collaboration.active &&
      !['admin', 'editor'].includes(collaboration.role ?? '')
        ? '보기 권한에서는 문서 상태를 변경할 수 없습니다.'
        : collaboration.active &&
            (collaboration.documentStatusesVersion !== 1 ||
              collaboration.filePropertiesVersion !== 1)
          ? '파일 속성을 변경하려면 협업 서버를 업데이트해주세요.'
          : '');
  const {
    kanbanPreferences,
    kanbanDocuments,
    openKanbanControls,
    updateKanbanPreferences,
    kanbanLayouts,
    kanbanLayoutsRef,
    updateKanbanVisibility,
    kanbanVisibilityValue,
    toggleKanban,
    revealKanban,
  } = useCanvasKanban({
    personalScope,
    activeCanvas,
    setPluginPanelPage,
    setPluginPanelOpen,
    home,
    loading,
    workspace,
    flowRef,
    loadedProjectRoot,
    preferences,
    setTool,
    documents,
    previews,
    previewWindows,
    nodes,
    canvasSheets,
    sections,
    kanbanView,
    pathLocked,
  });
  const sectionCollapsed = (section: CanvasSection) =>
    sectionViewCollapsed(section.id, sectionViews, findOpen, temporarySections);
  const toggleSection = (section: CanvasSection) =>
    collapseActions.section(section, sectionCollapsed(section));
  useCanvasNodes(
    () => ({
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
      filePropertyViews,
      sectionViews,
      temporarySections,
      kanbanLayouts,
      pluginPanelOpen,
      canvasSheets,
      geometryEpoch,
      sourceTitles,
      beginEdit,
      endEdit,
      registerEditor,
      draftRegistry,
      reportEdit,
      preview,
    }),
    [
      statusSettings,
      kanbanView,
      kanbanViewError,
      filePropertyViews,
      personalScope,
      workflowBusy,
      workflowEditable,
      setWorkflow,
      workflowChange,
      sectionViews,
      temporarySections,
      temporaryDocuments,
      kanbanLayouts,
      pluginPanelOpen,
      workflowReason,
      canvasSheets,
      geometryEpoch,
      drawing.items,
      gameUi.frames,
      gameUi.saving,
      gameUi.error,
      gameUiSettings.enabled,
      gameUi.submit,
      submitDrawing,
      viewZoom,
      sourceTitles,
      activeCanvas,
      findOpen,
      locked,
      aiBusy,
      projectAiQueue,
      aiFileLock,
      pathLocked,
      sectionLocked,
      newFileNodes,
      collaboration,
      workspace.root,
      beginEdit,
      endEdit,
      onBlocked,
      registerEditor,
      previewWindows,
      updatePreviewWindow,
      openHistory,
      copyTask,
      documents,
      focusSource,
      previews,
      resizeDocument,
      resizeSection,
      revealDocument,
      revealSection,
      saveDocument,
      draftRegistry,
      workspace.session?.sessionId,
      sections,
      setNodes,
      reportEdit,
      loadProject,
    ],
  );
  const openWorkspace = async () => {
    try {
      await flushEditors();
      const state = await api.projects.selectWorkspace();
      if (state.root) setHome(false);
      setWorkspace(state);
      if (state.root) await loadProject(true);
    } catch (error) {
      showError(error);
    }
  };

  const { addIdeaNearCenter, addIdeaAt } = useNoteCreation(
    selectionScope,
    () => ({
      workspace,
      openWorkspace,
      locked,
      creatingNote,
      documents,
      activeCanvas,
      sections,
      previews,
      previewWindows,
      api,
      activeCanvasRef,
      loadProject,
      setNotice,
      showError,
      flowRef,
    }),
  );
  const createSectionFromSelection = () => {
    const prompt = createPrompt;
    if (!prompt) return;
    return sectionActions.create(prompt, (section) => {
      if (sectionPromptsRef.current.createPrompt !== prompt) return;
      setCreatePrompt(null);
      setSelectedIds([]);
      setSelectedSectionIds([section.id]);
      selectCreated([sectionNodeId(section.id)]);
    });
  };

  const {
    createTask,
    editApprovalRequest,
    startApprovalRequest,
    submitAiRequest,
  } = useAiRequestCommands(selectionScope, () => ({
    canWriteAiRequest,
    setNotice,
    collaboration,
    creatingTaskRef,
    flushMaterialDrafts: () => draftRegistry.flush(),
    locked,
    onBlocked,
    documents,
    selectedIds,
    sections,
    selectedSectionIds,
    nodes,
    previewWindows,
    previews,
    activeCanvas,
    initializeAiRequest,
    activeCanvasRef,
    noticeProject,
    preferences,
    selectedAiProvider,
    selectedAiModel,
    selectedAiReasoning,
    setApprovalCopyFrom,
    setAiDraftStatus,
    setApprovalInboxOpen,
    runTaskWithCodex,
    aiRequest,
    aiRequestPage,
    aiRequestIssues,
    focusAiIssue,
    setAiRequestSubmitError,
    setCreatingTask,
    runScopeRef,
    editorsRef,
    api,
    effectiveAiRequest,
    loadProject,
    submittingApproval,
    editingApproval,
    approvalCopyFrom,
    aiDraftScope,
    aiInstructionPage,
    setSavedAiDraft,
    setAiRequest,
    setEditingApproval,
    codexStatus,
    aiRequestRetryOf,
    queueSupported,
    setAiResultPaths,
    showError,
  }));
  const changeMembership = (cancel: boolean) => {
    const prompt = membershipPrompt;
    if (!prompt) return;
    return sectionActions.membership(
      prompt,
      () => {
        if (sectionPromptsRef.current.membershipPrompt === prompt)
          setMembershipPrompt(null);
      },
      cancel,
    );
  };
  const cancelMembershipChange = () => changeMembership(true);
  const confirmMembershipChange = () => changeMembership(false);

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedIds.includes(document.id)),
    [documents, selectedIds],
  );
  const selectedDrawings = nodes
    .filter(
      (n): n is DrawingCanvasNode => !!n.selected && n.data.kind === 'drawing',
    )
    .map((n) => n.data.object);
  const drawingCopies = (objects: DrawingObject[], offset = 32) =>
    copyDrawingObjects(objects, offset, {
      now: Date.now,
      id: () => crypto.randomUUID(),
    });
  const duplicateDrawings = (objects: DrawingObject[] = selectedDrawings) => {
    if (objects.length)
      submitDrawing({ action: 'create', objects: drawingCopies(objects) });
  };
  const canvasBatch = async (
    commands: { channel: string; input: unknown }[],
  ) => {
    await drawing.flush();
    const result = await api.editor.applyCanvasCommands({
      scope: workspace.saveScope!,
      commands,
    });
    await drawing.reload();
    return result;
  };
  const deleteDrawings = () =>
    submitDrawing({
      action: 'delete',
      targets: selectedDrawings.map((o) => ({
        id: o.id,
        generation: o.generation,
      })),
    });

  const selectedSections = useMemo(
    () => sections.filter((section) => selectedSectionIds.includes(section.id)),
    [sections, selectedSectionIds],
  );
  const selectedPreviews = nodes
    .filter((node) => node.selected && node.data.kind === 'preview')
    .map((node) => previewDeletionItem((node.data as PreviewNodeData).preview));
  const closeContextMenus = () => {
    setContextMenu(null);
    setDocumentContextMenu(null);
    setSectionContextMenu(null);
    setPreviewContextMenu(null);
    setSelectionContextMenu(null);
  };
  const beginProjectCopy = (targets: SelectionMenuTargets) => {
    if (!workspace.session || !api.desktop) return;
    closeContextMenus();
    setProjectCopyPrompt({
      session: { ...workspace.session },
      selection: projectCopySelection(targets, activeCanvas),
    });
  };
  const copyToProject = (paths: string[]) =>
    beginProjectCopy(
      selectionMenuTargets(
        nodes.filter((node) =>
          node.data.kind === 'document'
            ? paths.includes(node.data.document.relativePath)
            : node.data.kind === 'section'
              ? paths.includes(node.data.section.relativePath)
              : node.data.kind === 'preview'
                ? paths.includes(node.data.preview.relativePath)
                : false,
        ),
      ),
    );
  const openSelectionContextMenu = (x: number, y: number, hit: CanvasNode) => {
    const chosen = contextSelection(nodes, hit);
    const ids = new Set(chosen.map((node) => node.id));
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: ids.has(node.id) })),
    );
    setSelectedIds(
      chosen.flatMap((node) =>
        node.data.kind === 'document' ? [node.data.document.id] : [],
      ),
    );
    setSelectedSectionIds(
      chosen.flatMap((node) =>
        node.data.kind === 'section' ? [node.data.section.id] : [],
      ),
    );
    closeContextMenus();
    if (chosen.length < 2 && hit.data.kind !== 'drawing') return false;
    setSelectionContextMenu({ x, y, targets: selectionMenuTargets(chosen) });
    return true;
  };
  const selectionLocked =
    locked ||
    selectedDocuments.some((doc) => pathLocked(doc.relativePath)) ||
    selectedSections.some(sectionLocked) ||
    selectedPreviews.some((preview) => pathLocked(preview.relativePath));

  const arrangementItems = useMemo(
    () => selectionArrangementItems(selectedDocuments, selectedSections),
    [selectedDocuments, selectedSections],
  );
  const arrangeSelection = (action: ArrangementAction) =>
    selectionActions.arrange(arrangementItems, action, [
      ...selectedDocuments.map((document) => document.relativePath),
      ...selectedSections.flatMap((section) => [
        section.relativePath,
        ...section.members.map((member) => member.path),
      ]),
    ]);

  const flushEditors = async (finish = true) => {
    await gameUi.flush();
    await drawing.flush();
    await Promise.all(
      [...editorsRef.current.values()].map((flush) => flush(finish)),
    );
  };
  useEffect(
    () =>
      api.desktop?.discordApproval?.onPrepare(async () => {
        await gameUi.flush();
        await drawing.flush();
        await Promise.all(
          [...editorsRef.current.values()].map((flush) => flush(false)),
        );
      }),
    [workspace.saveScope, gameUi.flush, drawing.flush],
  );
  const changeEdit = async (direction: 'undo' | 'redo') => {
    if (locked) {
      onBlocked();
      return;
    }
    if (editBusy) return;
    setEditBusy(true);
    try {
      await flushEditors();
      await api.history[direction]();
      await drawing.reload();
      await loadProject(false);
      setNotice(
        direction === 'undo'
          ? '내 작업을 되돌렸습니다.'
          : '내 작업을 다시 실행했습니다.',
      );
    } catch (error) {
      showError(error);
    } finally {
      setEditBusy(false);
    }
  };
  const { switchCanvasTo, storeViewport, beginCanvasMove, changeSheets } =
    useCanvasNavigation(selectionScope, () => ({
      workspace,
      flowRef,
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
      loadProject,
      setMovingCanvasItems,
      setMoveCanvasTarget,
      canvasSheets,
    }));
  const openDocumentLink = async (href: string) => {
    if (openingLink.current) return;
    if (linkComposing.current) {
      setNotice('한글 입력을 마친 뒤 링크를 열어주세요.');
      return;
    }
    openingLink.current = true;
    const scope = workspace.root;
    try {
      if (!locked && editorsRef.current.size) await flushEditors();
      if (scope !== linkScopeRef.current) return;
      const resolved = resolveDocumentLink(href, linkDocumentsRef.current);
      if (resolved.status !== 'found') {
        setNotice(linkStatusText(resolved));
        return;
      }
      const target = resolved.document;
      const id = target.htmlSource
        ? previewNodeId(target.htmlSource)
        : target.id;
      pendingCanvasJump.current = id;
      setTemporaryDocuments((current) => [...new Set([...current, target.id])]);
      navigateCanvasItem.current?.(id);
    } finally {
      openingLink.current = false;
    }
  };
  const jumpTo = (id: string) => {
    const section = sections.find((s) => s.members.some((m) => m.id === id));
    if (section && sectionViews[section.id])
      setTemporarySections((v) => [...new Set([...v, section.id])]);
    const itemCanvas =
      documents.find((item) => item.id === id)?.canvasId ??
      sections.find((item) => sectionNodeId(item.id) === id)?.canvasId ??
      previews.find((item) => previewNodeId(item.relativePath) === id)
        ?.canvasId ??
      drawing.items.find((item) => `drawing:${item.id}` === id)?.canvasId;
    if (canvasId(itemCanvas) !== activeCanvasRef.current) {
      pendingCanvasJump.current = id;
      void switchCanvasTo(canvasId(itemCanvas)).catch((error) => {
        pendingCanvasJump.current = null;
        showError(error);
      });
      return;
    }
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    setTool('select');
    setSelectedIds(
      node.data.kind === 'document' ? [node.data.document.id] : [],
    );
    setSelectedSectionIds(
      node.data.kind === 'section' ? [node.data.section.id] : [],
    );
    setNodes((current) =>
      current.map((item) => ({ ...item, selected: item.id === id })),
    );
    void flowRef.current?.fitView({
      nodes: [{ id }],
      padding: 0.6,
      maxZoom: 1,
      duration: 300,
    });
  };
  navigateCanvasItem.current = jumpTo;
  openLinkRef.current = openDocumentLink;
  useEffect(() => {
    if (firstCanvasView.current !== activeCanvas || !nodes.length) return;
    firstCanvasView.current = null;
    requestAnimationFrame(() => {
      void flowRef.current?.fitView({
        nodes: flowRef.current
          ?.getNodes()
          .filter((n) => !n.className?.includes('section-member-hidden')),
        padding: 0.16,
        maxZoom: 1,
        duration: 0,
      });
    });
  }, [activeCanvas, nodes]);
  useEffect(() => {
    const id = pendingCanvasJump.current;
    if (!id || !nodes.some((node) => node.id === id)) return;
    pendingCanvasJump.current = null;
    setSelectedIds(
      nodes.find((node) => node.id === id)?.data.kind === 'document'
        ? [id]
        : [],
    );
    setSelectedSectionIds(
      nodes.find((node) => node.id === id)?.data.kind === 'section'
        ? [id.replace(/^section:/, '')]
        : [],
    );
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: node.id === id })),
    );
    requestAnimationFrame(() => {
      void flowRef.current?.fitView({
        nodes: [{ id }],
        padding: 0.6,
        maxZoom: 1,
        duration: 0,
      });
    });
  }, [nodes, setNodes]);
  const duplicateSelection = () =>
    selectionActions.duplicate(
      selectedDocuments,
      selectedDrawings,
      ({ created, copies }) => {
        setSelectedIds(created.map((item) => item.id));
        setSelectedSectionIds([]);
        selectCreated([
          ...created.map((doc) => doc.id),
          ...copies.map((object) => `drawing:${object.id}`),
        ]);
      },
    );
  const selectionSection = () => {
    if (editBusy) return;
    if (
      blockAiFiles(selectedDocuments.map((document) => document.relativePath))
    )
      return;
    if (locked) {
      onBlocked();
      return;
    }
    if (!selectedDocuments.length) {
      setNotice('묶을 메모나 파일을 먼저 선택해주세요.');
      return;
    }
    setSectionTitle('새 섹션');
    setSectionDialogOpen(true);
  };
  const minimizeSelection = () => {
    const targets = nodes.flatMap((node): CollapseTarget[] => {
      if (!node.selected) return [];
      if (node.data.kind === 'document')
        return [{ kind: 'document', document: node.data.document }];
      if (node.data.kind === 'section')
        return [
          {
            kind: 'section',
            section: node.data.section,
            collapsed: node.data.collapsed,
          },
        ];
      if (node.data.kind === 'preview')
        return [
          {
            kind: 'preview',
            relativePath: node.data.preview.relativePath,
            windowState: node.data.windowState,
          },
        ];
      if (node.data.kind === 'kanban') {
        const { preferences, update } = node.data;
        return [
          {
            kind: 'kanban',
            collapsed: preferences.minimized,
            update: (collapsed) =>
              update({ ...preferences, minimized: collapsed }),
          },
        ];
      }
      return [];
    });
    return collapseActions.selection(targets);
  };
  const requestDelete = () => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length && selected.every((n) => n.data.kind === 'kanban')) {
      const v = kanbanVisibility(kanbanLayoutsRef.current);
      updateKanbanVisibility({
        ...v,
        mode: 'selected',
        canvasIds: (v.mode === 'all'
          ? canvasSheets.canvases.map((c) => c.id)
          : v.canvasIds
        ).filter((id) => id !== activeCanvas),
      });
      return;
    }
    if (
      blockAiFiles([
        ...selectedDocuments.map((document) => document.relativePath),
        ...selectedPreviews.map((preview) => preview.relativePath),
        ...selectedSections.flatMap((section) => [
          section.relativePath,
          ...section.members.map((member) => member.path),
        ]),
      ])
    )
      return;
    if (locked) {
      onBlocked();
      return;
    }
    if (
      selectedDrawings.length &&
      !selectedDocuments.length &&
      !selectedPreviews.length &&
      !selectedSections.length
    ) {
      deleteDrawings();
      return;
    }
    if (
      selectedDocuments.length ||
      selectedPreviews.length ||
      selectedSections.length
    ) {
      setDeleteDrawingTargets(selectedDrawings);
      setDeleteSectionTargets(selectedSections);
      setDeleteManyPrompt([...selectedDocuments, ...selectedPreviews]);
      return;
    }
    if (selectedSections.length === 1)
      setSectionActionPrompt({
        section: selectedSections[0],
        deleteMembers: true,
      });
    else setNotice('삭제할 메모·파일·HTML 결과 또는 섹션 하나를 선택해주세요.');
  };
  useCanvasCommands({
    home: home || materialPicker !== null,
    findOpen,
    find: () => {
      if (!findOpen)
        void flushEditors()
          .then(() => setFindOpen(true))
          .catch(showError);
    },
    action: (action, event) => {
      event.preventDefault();
      if (action === 'search') setCommandOpen(true);
      if (action === 'navigator') setNavigatorOpen((value) => !value);
      if (action === 'help') setShortcutsOpen(true);
      if (action === 'import') openImport();
      if (action === 'undo') void changeEdit('undo');
      if (action === 'redo') void changeEdit('redo');
      if (action === 'save')
        void flushEditors(false)
          .then(() => setNotice('편집 내용을 저장했습니다.'))
          .catch(showError);
      if (action === 'organize') void createTask();
      if (action === 'implement') void createTask('implement');
      if (action === 'section') selectionSection();
      if (
        action === 'duplicate' &&
        (selectedDocuments.length || selectedDrawings.length)
      )
        void duplicateSelection();
      if (action === 'delete') requestDelete();
      if (action === 'minimize') void minimizeSelection();
      if (action === 'fit')
        void flowRef.current?.fitView({
          nodes: flowRef.current
            ?.getNodes()
            .filter((n) => !n.className?.includes('section-member-hidden')),
          padding: 0.16,
          duration: 250,
        });
      if (action === 'selection-fit')
        void flowRef.current?.fitView({
          nodes: nodes
            .filter((node) => node.selected)
            .map((node) => ({ id: node.id })),
          padding: 0.3,
          maxZoom: 1,
          duration: 250,
        });
      if (action === 'zoom-in') void flowRef.current?.zoomIn();
      if (action === 'zoom-out') void flowRef.current?.zoomOut();
      if (action === 'history') void openHistory();
      if (action === 'ui') setUiHidden((value) => !value);
      if (action === 'select') setTool('select');
      if (action === 'hand') setTool('hand');
      if (action === 'text') {
        if (locked) onBlocked();
        else if (collaboration.active && collaboration.drawingTextVersion !== 1)
          setNotice('텍스트를 사용하려면 협업 서버를 업데이트해주세요.');
        else setTool('text');
      }
      if (action === 'note') {
        if (locked) onBlocked();
        else setTool('note');
      }
      if (
        [
          'rectangle',
          'ellipse',
          'triangle',
          'arrow',
          'line',
          'pen',
          'highlighter',
          'eraser',
          'shapes',
        ].includes(action)
      ) {
        if (locked) onBlocked();
        else
          chooseDrawingTool(
            ({ shapes: 'rectangle' } as Record<string, DrawingTool>)[action] ??
              (action as DrawingTool),
          );
      }
      if (action === 'pan') {
        if (drawingGesture) return;
        cancelSelectionDrag();
        panPrevious.current = tool;
        setTool('hand');
      }
      if (action === 'all') {
        event.preventDefault();
        const allDocumentIds = documents.map((document) => document.id);
        setSelectedIds(allDocumentIds);
        setSelectedSectionIds([]);
        setNodes((current) =>
          current.map((node) => ({
            ...node,
            selected:
              node.data.kind === 'document' || node.data.kind === 'drawing',
          })),
        );
        setNotice(`전체 파일 ${allDocumentIds.length}개를 선택했습니다.`);
      } else if (action === 'copy') {
        event.preventDefault();
        copyCanvasSelection();
      } else if (action === 'paste') {
        event.preventDefault();
        void pasteCanvasSelection();
      }
    },
    escape: () => {
      cancelNoteDrawing();
      setTool('select');
      setInspectorId(null);
      setSettingsOpen(false);
      setContextMenu(null);
      setOverlapMenu(null);
      setDocumentContextMenu(null);
      setSectionContextMenu(null);
      setPreviewContextMenu(null);
      setDeletePrompt(null);
      setSectionActionPrompt(null);
      setCodexStatusOpen(false);
      setSelectedIds([]);
      setSelectedSectionIds([]);
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: false })),
      );
    },
    releasePan: () => {
      if (panPrevious.current) {
        setTool(panPrevious.current);
        panPrevious.current = null;
      }
    },
    blur: cancelNoteDrawing,
  });

  const legacyModal = !!(
    projectCopyPrompt ||
    discordApprovalOpen ||
    approvalInboxOpen ||
    updateOpen ||
    importTarget ||
    (aiRequest && materialPicker === null) ||
    sectionRename ||
    deleteManyPrompt ||
    sectionDialogOpen ||
    deletePrompt ||
    sectionActionPrompt ||
    membershipPrompt ||
    historyConfirm ||
    blockedMessage ||
    codexStatusOpen ||
    collaborationOpen
  );

  const hasTaskSelection =
    canWriteAiRequest &&
    (selectedDocuments.length > 0 ||
      selectedSections.length > 0 ||
      nodes.some((node) => node.selected && node.data.kind === 'preview'));
  const inputSelection = [
    ...new Map(
      [
        ...selectedDocuments,
        ...selectedSections.flatMap((section) =>
          documents.filter((doc) =>
            section.members.some(
              (member) =>
                member.id === doc.id || member.path === doc.relativePath,
            ),
          ),
        ),
      ].map((doc) => [doc.id, doc]),
    ).values(),
  ];
  const relevantEdits = documents
    .map((doc) => editStates[doc.id])
    .filter(Boolean);
  restartGuard.current = () => {
    const reasons: string[] = [];
    if (
      editorsRef.current.size ||
      relevantEdits.some((edit) => edit.dirty || edit.saving || edit.failed) ||
      document.querySelector(
        '[contenteditable="true"]:focus, .react-flow__node.dragging',
      )
    )
      reasons.push('메모 편집·이동을 마치고 저장 상태를 확인해주세요.');
    if (aiBusy || creatingTask || preparingTask)
      reasons.push('AI 작업이 진행 중입니다. 완료하거나 중지해주세요.');
    if (loading || editBusy || importingFiles || restoring)
      reasons.push('파일 처리·저장·동기화가 진행 중입니다. 잠시 기다려주세요.');
    if (
      discordApprovalOpen ||
      aiRequest ||
      sectionRename ||
      importTarget ||
      historyConfirm
    )
      reasons.push(
        '열려 있는 작업·편집 대화상자를 먼저 완료하거나 취소해주세요.',
      );
    if (collaboration.active && !collaboration.connected)
      reasons.push('협업 서버에 재연결한 뒤 저장 상태를 확인해주세요.');
    if (collaboration.pendingChanges || collaboration.conflicts?.length)
      reasons.push('공동 작업의 미반영 변경·충돌을 먼저 동기화해주세요.');
    return reasons;
  };
  const saveLabel =
    collaboration.active && !collaboration.connected
      ? collaboration.offlineSync
        ? `이 PC에 저장 · 동기화 대기 ${collaboration.pendingChanges ?? 0}개`
        : '서버 연결 끊김'
      : collaboration.pendingChanges
        ? `동기화 대기 ${collaboration.pendingChanges}개`
        : relevantEdits.some((edit) => edit.failed)
          ? '저장 실패 · 다시 확인 필요'
          : relevantEdits.some((edit) => edit.saving)
            ? '저장 중…'
            : relevantEdits.some((edit) => edit.dirty)
              ? '수정 중 · Ctrl+S로 저장'
              : collaboration.active
                ? '서버 저장 완료'
                : '로컬 저장 완료';
  const aiDisabledReason =
    !capabilities.localAiExecution && collaboration.role !== 'editor'
      ? 'AI 실행은 CLI가 연결된 PC 앱에서 사용할 수 있습니다.'
      : !canWriteAiRequest
        ? collaboration.connected
          ? collaboration.role === 'editor'
            ? '서버 업데이트 필요 (v0.8.0)'
            : '뷰어는 실행 불가'
          : '서버 연결 필요'
        : aiBusy && !queueSupported && collaboration.role !== 'editor'
          ? 'AI 작업 진행 중'
          : locked
            ? '프로젝트 편집 잠김'
            : '';
  const { canvasItems, inspectorAuthorship, inspectorAiRecords } =
    useWorkspaceIndex({
      canvasSheets,
      collaboration,
      sections,
      documents,
      previews,
      previewWindows,
      inspectorId,
      api,
      workspace,
      codexRun,
    });
  const selectMaterials = () => {
    void draftRegistry
      .flush()
      .then(() => flushEditors())
      .then(() => {
        if (!aiRequest) return;
        setTool('select');
        setMaterialFocus(null);
        setMaterialPicker([...aiRequest.inputPaths]);
      })
      .catch(showError);
  };
  const materialItems = [
    ...canvasItems,
    ...textMaterials.map((item) => ({
      ...item,
      canvasName: canvasSheets.canvases.find(
        (sheet) => sheet.id === item.canvasId,
      )?.name,
    })),
  ];
  const materialName = (path: string) =>
    materialItems.find((item) => item.path === path)?.title ??
    path
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') ??
    '이름 없는 자료';
  const documentSetName = (baseDir?: string) => {
    const set = organizedSets.find((set) => set.baseDir === baseDir);
    return set ? materialName(set.paths[0]) : '문서를 선택해주세요';
  };
  const materialPath = (node: CanvasNode) =>
    node.data.kind === 'document' && node.data.document.type !== 'ai-task'
      ? node.data.document.relativePath
      : node.data.kind === 'preview'
        ? node.data.preview.relativePath
        : node.data.kind === 'section'
          ? node.data.section.relativePath
          : node.data.kind === 'drawing' && node.data.object.kind === 'text'
            ? textMaterials.find((item) => item.id === node.id)?.path
            : undefined;
  const toggleMaterial = (path: string) =>
    setMaterialPicker((current) =>
      current === null
        ? null
        : current.includes(path)
          ? current.filter((item) => item !== path)
          : [...current, path],
    );
  const finishMaterialSelection = (apply: boolean) => {
    if (apply && materialPicker !== null) {
      const paths = [
        ...new Set(
          materialPicker.flatMap((path) => [
            path,
            ...(sections
              .find((section) => section.relativePath === path)
              ?.members.map((member) => member.path) ?? []),
          ]),
        ),
      ];
      setAiRequest((current) =>
        current
          ? {
              ...current,
              inputPaths: paths,
              sourceMode: paths.some(isPreviewPath)
                ? 'html-compose'
                : undefined,
            }
          : current,
      );
    }
    materialMarquee.current = null;
    setMaterialPicker(null);
    setMaterialFocus(null);
    requestAnimationFrame(() =>
      document.getElementById('ai-select-on-canvas')?.focus(),
    );
  };
  const filteredHistoryEntries = historyEntries.filter(
    (entry) =>
      (!historyAiOnly || entry.kind === 'ai' || !!historyTaskPath(entry)) &&
      (!historyFilter ||
        historyTaskPath(entry) === historyFilter ||
        entry.files.some((file) =>
          [
            historyFilter,
            ...(previews.find(
              (preview) => preview.relativePath === historyFilter,
            )?.previousPaths ?? []),
          ].includes(file.relativePath),
        ) ||
        (entry.kind === 'ai' &&
          entryTaskRecord(entry, taskDocuments)?.outputs.some((output) =>
            [
              historyFilter,
              ...(previews.find(
                (preview) => preview.relativePath === historyFilter,
              )?.previousPaths ?? []),
            ].includes(output),
          ))),
  );

  const focusResultPath = (path: string) => {
    const doc = documents.find((item) => item.relativePath === path),
      preview = previews.find((item) => item.relativePath === path);
    if (doc || preview) {
      const targetId = doc?.id ?? previewNodeId(preview!.relativePath);
      if (
        canvasId(doc?.canvasId ?? preview?.canvasId) !== activeCanvasRef.current
      ) {
        jumpTo(targetId);
        return;
      }
    }
    const node = nodes.find((node) =>
      node.data.kind === 'document'
        ? node.data.document.relativePath === path
        : node.data.kind === 'preview' &&
          node.data.preview.relativePath === path,
    );
    if (!node) {
      setNotice(
        '이 결과 파일은 현재 캔버스에 없습니다. 파일 변경 기록에서 이전 내용을 확인해주세요.',
      );
      return;
    }
    setHistoryOpen(false);
    setInspectorId(null);
    jumpTo(node.id);
  };

  const commands: CanvasCommand[] = [
    {
      id: 'import',
      title: 'Markdown · HTML 게임 · 이미지 파일 불러오기',
      shortcut: 'Ctrl+I',
      disabled: locked,
      reason: '문서 편집 잠김',
      run: () => openImport(),
    },
    {
      id: 'note',
      title: '새 아이디어 메모 만들기',
      shortcut: 'N',
      disabled: locked,
      reason: '문서 편집 잠김',
      run: () => void addIdeaNearCenter(),
    },
    {
      id: 'gamejam',
      title: 'gamejam! · 문서 정리 / HTML 구현',
      shortcut: 'Ctrl+Enter',
      disabled:
        !canWriteAiRequest ||
        (collaboration.role !== 'editor' &&
          (locked || (aiBusy && !queueSupported))),
      reason: aiDisabledReason,
      run: () => void createTask(),
    },
    {
      id: 'section',
      title: '선택 파일로 섹션 만들기',
      shortcut: 'Ctrl+G',
      disabled: !selectedDocuments.length || selectionLocked,
      reason: '편집 가능한 문서를 선택해주세요',
      run: selectionSection,
    },
    {
      id: 'duplicate',
      title: '선택 파일 복제',
      shortcut: 'Ctrl+D',
      disabled: !selectedDocuments.length || locked,
      reason: '편집 가능한 문서를 선택해주세요',
      run: () => void duplicateSelection(),
    },
    {
      id: 'undo',
      title: '내 작업 실행 취소',
      shortcut: 'Ctrl+Z',
      disabled: !undoState.undo || locked || editBusy,
      reason: '되돌릴 작업 없음 또는 편집 잠김',
      run: () => void changeEdit('undo'),
    },
    {
      id: 'redo',
      title: '내 작업 다시 실행',
      shortcut: 'Ctrl+Shift+Z',
      disabled: !undoState.redo || locked || editBusy,
      reason: '다시 실행할 작업 없음 또는 편집 잠김',
      run: () => void changeEdit('redo'),
    },
    {
      id: 'fit',
      title: '캔버스 전체 보기',
      shortcut: 'Shift+1',
      run: () =>
        void flowRef.current?.fitView({
          nodes: flowRef.current
            ?.getNodes()
            .filter((n) => !n.className?.includes('section-member-hidden')),
          padding: 0.16,
          duration: 250,
        }),
    },
    {
      id: 'navigator',
      title: '문서 목록 열기',
      shortcut: 'L',
      run: () => setNavigatorOpen(true),
    },
    {
      id: 'history',
      title: '프로젝트 히스토리',
      shortcut: 'Ctrl+Shift+H',
      run: () => void openHistory(),
    },
    {
      id: 'compare',
      title: 'HTML 버전 비교',
      run: () => setCompareFirst(previews[0]?.relativePath ?? ''),
    },
    {
      id: 'invite',
      title: '참여자 및 초대 코드',
      run: () => setCollaborationOpen(true),
    },
    {
      id: 'ai-settings',
      title: 'AI 연결 설정',
      run: () => setCodexStatusOpen(true),
    },
    { id: 'app-update', title: '앱 업데이트', run: () => setUpdateOpen(true) },
    {
      id: 'help',
      title: '단축키 안내',
      shortcut: '?',
      run: () => setShortcutsOpen(true),
    },
  ];

  const collaborationPanel: WorkspacePanelsProps['collaboration'] = {
    state: collaboration,
    initialTab: collaborationTab,
    beforeSwitch: async () => {
      await Promise.all(
        [...editorsRef.current.values()].map((flush) => flush()),
      );
    },
    changed: async () => {
      const next = await api.collaboration.getCollaboration();
      setCollaboration(next);
      await loadProject(true);
      if (
        (home || (!collaboration.active && next.active)) &&
        (await api.projects.getWorkspace()).root
      ) {
        setHome(false);
        setCollaborationOpen(false);
      }
    },
    report: setNotice,
  };

  const toggleTheme = () =>
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  const enterProject = async () => {
    setCollaboration(await api.collaboration.getCollaboration());
    await loadProject(true);
    setHome(false);
  };
  const returnHome = async () => {
    try {
      await flushEditors();
      await api.projects.goHome();
      setCollaboration(await api.collaboration.getCollaboration());
      setHome(true);
      setFindOpen(false);
      setNavigatorOpen(false);
      setCommandOpen(false);
      setSelectedIds([]);
      setSelectedSectionIds([]);
      setNodes([]);
      setCodexRun(null);
      setCompletion(null);
      await loadProject();
    } catch (error) {
      showError(error);
    }
  };
  useEffect(() => {
    if (!collaboration.active || home) {
      connectionRef.current = null;
      return;
    }
    const previous = connectionRef.current;
    const sameProject = previous?.id === collaboration.projectId;
    if (
      (!previous || !sameProject || previous.connected) &&
      !collaboration.connected
    ) {
      setBlockedMessage(
        collaboration.accessDenied
          ? '참여 세션이 만료되었거나 권한이 회수되었습니다. 이 PC의 작업은 보관됩니다. 홈에서 관리자 복구 또는 초대 참여로 연결해주세요.'
          : collaboration.offlineSync
            ? '협업 서버에 연결할 수 없어 실시간 공유가 중단되었습니다. 계속 편집할 수 있으며 작업은 이 PC에 저장됩니다. 서버가 다시 연결되면 변경을 합치고, 겹친 내용은 직접 선택합니다.'
            : '협업 서버에 연결할 수 없습니다. 오프라인 편집에는 협업 서버 업데이트가 필요합니다. 저장된 사본과 초안을 보관합니다.',
      );
    } else if (
      sameProject &&
      previous &&
      !previous.connected &&
      collaboration.connected
    ) {
      setBlockedMessage(
        collaboration.pendingChanges
          ? '협업 서버에 다시 연결되었습니다. 이 PC의 변경을 서버 작업과 비교 중입니다. 겹친 내용이 있으면 선택한 버전을 반영합니다.'
          : '협업 서버에 다시 연결되었습니다. 작업 내용이 동기화되어 실시간 공유를 계속할 수 있습니다.',
      );
    }
    connectionRef.current = {
      id: collaboration.projectId,
      connected: collaboration.connected,
    };
  }, [
    collaboration.active,
    collaboration.connected,
    collaboration.projectId,
    home,
  ]);

  const openCanvasMenu = (clientX: number, clientY: number) => {
    const chosen = contextSelection(nodes);
    if (chosen.length) {
      closeContextMenus();
      setSelectionContextMenu({
        x: clientX,
        y: clientY,
        targets: selectionMenuTargets(chosen),
      });
      return;
    }
    const point = flowRef.current?.screenToFlowPosition({
      x: clientX,
      y: clientY,
    });
    if (!point) return;
    setDocumentContextMenu(null);
    setSectionContextMenu(null);
    setPreviewContextMenu(null);
    setContextMenu({
      screenX: Math.min(clientX, window.innerWidth - 282),
      screenY: Math.min(clientY, window.innerHeight - 340),
      flowX: point.x,
      flowY: point.y,
    });
  };

  useWorkspacePreview(
    () => ({
      setDockPanel,
      setMinimapVisible,
      setEraserSettings,
      loading,
      setTool,
      setNoteDraft,
      chooseDrawingTool,
      setGuides,
      documents,
      sections,
      previews,
      setCollaborationOpen,
      setCollaborationTab,
      setUpdateOpen,
      setUpdateRestarting,
      setNavigatorOpen,
      setFindOpen,
      setCommandOpen,
      setShortcutsOpen,
      setCompareFirst,
      setSettingsOpen,
      setUiHidden,
      setInspectorId,
      setDocuments,
      setSelectedIds,
      setSelectedSectionIds,
      setNodes,
      setNewFileNodes,
      setHistoryOpen,
      setHistoryEntries,
      setHistorySelection,
      setAiHistorySelection,
      setHistoryConfirm,
      setRestoring,
      setCodexStatusOpen,
      setCheckingCodex,
      setCodexRun,
      noticeProject,
      setCodexRunCollapsed,
      setAiRequestPage,
      setAiRequestVisited,
      setAiInstructionPage,
      setAiRequest,
      setSelectedAiModel,
      setCreatingTask,
      setContextMenu,
      setDocumentContextMenu,
      setSectionContextMenu,
      setPreviewContextMenu,
      setResultFolderPrompt,
      setMovingResults,
      setImportTarget,
      setImportingFiles,
      setImportError,
      setMovingCanvasItems,
      setMoveCanvasTarget,
      setCanvasOperationBusy,
      setStatusManagerOpen,
      setKanbanAppearanceOpen,
      setPluginPanelOpen,
      setPluginPanelPage,
      updateKanbanPreferences,
      updateSectionViews,
      setCreatePrompt,
      setSectionRename,
      setMembershipPrompt,
      setSectionActionPrompt,
      setDeletePrompt,
      setDeleteManyPrompt,
      setBlockedMessage,
      setNotice,
    }),
    preview,
    [preview, loading, documents, sections, previews, setNodes],
  );
  const uiDebug = (
    <UiDebugConsole
      scope={home || (!workspace.root && !loading) ? 'home' : 'project'}
      theme={theme}
    />
  );
  const workspacePanelProps: Omit<WorkspacePanelsProps, 'workspace'> = {
    state: panelState,
    collaboration: collaborationPanel,
    selfHost:
      SELF_HOST_ENABLED && capabilities.selfHostManagement
        ? {
            share: async (id) => {
              await flushEditors();
              await api.projects.openProject(id);
              await enterProject();
              setCollaborationTab('create');
              setCollaborationOpen(true);
            },
          }
        : undefined,
  };
  if (home || (!workspace.root && !loading)) {
    return (
      <>
        <ProjectHome
          openSelfHost={() => setSelfHostOpen(true)}
          opened={enterProject}
          join={() => {
            setCollaborationTab('join');
            setCollaborationOpen(true);
          }}
          recover={() => {
            setCollaborationTab('recover');
            setCollaborationOpen(true);
          }}
          updates={() => setUpdateOpen(true)}
          toggleTheme={toggleTheme}
          theme={theme}
        />
        <WorkspacePanels {...workspacePanelProps} />
        {uiDebug}
      </>
    );
  }

  return (
    <main
      className={`app-shell${materialPicker !== null ? ' app-shell--material-picker' : ''} canvas-workspace${nodes.some((n) => n.selected) && !uiHidden ? ' canvas-workspace--selection' : ''}${uiHidden ? ' canvas-workspace--focus' : ''}${dockPanel && !uiHidden ? ' canvas-workspace--panel' : ''}${navigatorOpen && !uiHidden ? ' canvas-workspace--navigator' : ''} app-shell--tool-${tool}${uiHidden || !workspace.root ? ' app-shell--tabs-hidden' : ''}${findOpen ? ' app-shell--has-find' : ''}${runPanelVisible ? ' app-shell--has-run' : ''}${completionVisible ? ' app-shell--has-completion' : ''}`}
    >
      <WorkspaceDock
        {...{
          activeCanvas,
          aiBusy,
          aiHistorySelection,
          api,
          canRestoreHistory,
          canRunAi,
          canStopAi,
          canWriteAiRequest,
          cancelCodexRun,
          cancellingCodexRun,
          canvasItems,
          canvasSheets,
          closeCompletion,
          closeRunPanel,
          codexLogsRef,
          codexRun,
          codexRunCollapsed,
          codexStatus,
          collaboration,
          completion,
          creatingTask,
          deleteDrawings,
          dockPanel,
          documents,
          drawing,
          drawingContinuous,
          drawingPressure,
          drawingStyle,
          drawingTool,
          drawingTouch,
          duplicateDrawings,
          editBusy,
          eraserMode,
          filePropertyViews,
          filteredHistoryEntries,
          flowRef,
          focusResultPath,
          focusSource,
          gameUi,
          gameUiPanelActive,
          gameUiSettings,
          historyAiOnly,
          historyEntries,
          historyFilter,
          historyOpen,
          historyRequest,
          historySelection,
          home,
          inspectHistory,
          inspectorAiRecords,
          inspectorAuthorship,
          inspectorId,
          jumpTo,
          kanbanPreferences,
          kanbanViewError,
          kanbanVisibilityValue,
          loadProject,
          locked,
          minimapPreferences,
          movingResults,
          nodes,
          noticeProject,
          onBlocked,
          openHistory,
          pathLocked,
          pluginPanelGeometry,
          pluginPanelOpen,
          pluginPanelPage,
          previews,
          projectAiQueue,
          propertyVisibilityFor,
          queueSupported,
          restoring,
          reuseAiEntry,
          revealKanban,
          runFailure,
          runOutputPaths,
          runPanelVisible,
          sections,
          selectedDrawings,
          setAiHistorySelection,
          setAiQueue,
          setApprovalInboxOpen,
          setCodexRunCollapsed,
          setCodexStatusOpen,
          setCollaborationOpen,
          setCollaborationTab,
          setCompareFirst,
          setDiscordApprovalOpen,
          setDockPanel,
          setDrawingContinuous,
          setDrawingPressure,
          setDrawingStyle,
          setDrawingTouch,
          setGameUiPanelHost,
          setGameUiSettings,
          setHistoryAiOnly,
          setHistoryConfirm,
          setHistoryOpen,
          setHistorySelection,
          setInspectorId,
          setKanbanAppearanceOpen,
          setNavigatorOpen,
          setNotice,
          setPluginPanelOpen,
          setPluginPanelPage,
          setResultFolderPrompt,
          setSectionRename,
          setSettingsOpen,
          setShortcutsOpen,
          setSnapEnabled,
          setStatusManagerOpen,
          setUpdateOpen,
          settingsOpen,
          showError,
          snapEnabled,
          statusError,
          statusSettings,
          submitDrawing,
          taskDocuments,
          theme,
          toggleKanban,
          tool,
          uiHidden,
          updateFilePropertyViews,
          updateKanbanPreferences,
          updateKanbanVisibility,
          updateMiniMapPreferences,
          updatePluginPanelGeometry,
          workflowBusy,
          workflowChange,
          workflowEditable,
          workflowReason,
        }}
      />
      <WorkspaceChrome
        {...{
          aiBusy,
          aiDisabledReason,
          arrangeSelection,
          arrangementItems,
          beginCanvasMove,
          canWriteAiRequest,
          canvasSheets,
          changeEdit,
          chooseDrawingTool,
          collaboration,
          compactChrome,
          completion,
          createTask,
          dockPanel,
          drawing,
          drawingTool,
          duplicateSelection,
          editBusy,
          eraserMode,
          eraserSize,
          flowRef,
          gameUi,
          hasTaskSelection,
          importingFiles,
          inputSelection,
          locked,
          minimapVisible,
          minimizeSelection,
          navigatorOpen,
          nodes,
          notice,
          noticeVisible,
          openHistory,
          openImport,
          openKanbanControls,
          partialEraseSupported,
          preview,
          projectAiQueue,
          queueSupported,
          relevantEdits,
          requestDelete,
          returnHome,
          saveLabel,
          selectedDocuments,
          selectedDrawings,
          selectedPreviews,
          selectedSections,
          selectionLocked,
          setCodexRunCollapsed,
          setCommandOpen,
          setDockPanel,
          setEraserSettings,
          setInspectorId,
          setMinimapVisible,
          setNavigatorOpen,
          setPluginPanelOpen,
          setPluginPanelPage,
          setSectionDialogOpen,
          setSectionRename,
          setSectionTitle,
          setSettingsOpen,
          setShortcutsOpen,
          setTool,
          setUiHidden,
          showError,
          theme,
          toggleTheme,
          tool,
          uiHidden,
          undoState,
          viewZoom,
          workspace,
        }}
      />
      {uiDebug}
      <WorkspacePanels
        {...workspacePanelProps}
        workspace={{
          docked: true,
          uiHidden,
          restarting: updateRestarting,
          offline: {
            state: collaboration,
            paused:
              legacyModal ||
              commandOpen ||
              shortcutsOpen ||
              compareFirst !== null,
            flush: flushEditors,
            changed: async () => {
              setCollaboration(await api.collaboration.getCollaboration());
              await loadProject();
            },
          },
          find: {
            revision: `${documents.map((doc) => `${doc.id}:${doc.modifiedAt}`).join(',')}:${sections.map((section) => `${section.id}:${section.modifiedAt}`).join(',')}`,
          },
          navigation: { items: canvasItems, activeCanvas, jump: jumpTo },
          commands,
          compare:
            compareFirst !== null
              ? {
                  previews,
                  first: compareFirst || undefined,
                  onCompare: compareWindows,
                }
              : null,
          closeCompare: () => setCompareFirst(null),
          plugins: {
            page: pluginPanelPage,
            navigate: setPluginPanelPage,
            enabled: (id) =>
              id === 'builtin.game-ui'
                ? gameUiSettings.enabled
                : kanbanVisibilityValue.enabled,
            toggle: (id, value) =>
              id === 'builtin.game-ui'
                ? setGameUiSettings({ enabled: value })
                : toggleKanban(value),
            geometry: pluginPanelGeometry,
            updateGeometry: updatePluginPanelGeometry,
            canvasName:
              canvasSheets.canvases.find((c) => c.id === activeCanvas)?.name ??
              '현재 캔버스',
            children: (
              <>
                {pluginPanelPage === 'builtin.game-ui' ? (
                  <GameUiControls
                    frames={gameUi.frames}
                    canvasId={activeCanvas}
                    occupied={[
                      ...documents.filter(
                        (d) => (d.canvasId ?? 'default') === activeCanvas,
                      ),
                      ...gameUi.frames
                        .filter((f) => f.canvasId === activeCanvas)
                        .map((f) => ({
                          x: f.x,
                          y: f.y,
                          width: f.width + 320,
                          height: gameUiHeight(f),
                        })),
                    ]}
                    disabled={
                      locked ||
                      !gameUiSettings.enabled ||
                      (collaboration.active &&
                        collaboration.gameUiVersion !== 2)
                    }
                    submit={gameUi.submit}
                    focus={(id) => {
                      setPluginPanelOpen(false);
                      setTimeout(
                        () =>
                          void flowRef.current?.fitView({
                            nodes: [{ id: `game-ui:${id}` }],
                            padding: 0.35,
                            maxZoom: 1,
                            duration: 200,
                          }),
                        100,
                      );
                    }}
                  />
                ) : (
                  <KanbanControls
                    preferences={kanbanPreferences}
                    activationEnabled={kanbanVisibilityValue.enabled}
                    visibilityPicker={
                      <CanvasVisibilityPicker
                        value={kanbanVisibilityValue}
                        canvases={canvasSheets.canvases}
                        change={updateKanbanVisibility}
                      />
                    }
                    update={updateKanbanPreferences}
                    toggle={toggleKanban}
                    focus={revealKanban}
                    manage={() => setStatusManagerOpen(true)}
                    appearance={() => setKanbanAppearanceOpen(true)}
                    manageDisabled={
                      !workflowEditable || workflowBusy || !!kanbanViewError
                    }
                    reason={workflowReason}
                  />
                )}
              </>
            ),
          },
          appearance: {
            value: kanbanView.value,
            statuses: statusSettings.value,
            save: async (value) => {
              await api.editor.saveKanbanView({
                expected: kanbanView.raw,
                value,
              });
              await loadProject(false);
            },
          },
          statuses: {
            value: statusSettings.value,
            raw: statusSettings.raw,
            documents: [...documents, ...previews],
            save: async (input) => {
              await api.editor.saveDocumentStatuses(input);
              await loadProject(false);
            },
          },
        }}
      />

      <WorkspaceCanvas
        {...{
          dropFiles,
          compactChrome,
          materialItems,
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
          pluginPanelOpen,
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
        }}
      />

      {blockedMessage && (
        <div
          data-ui-id="blocked"
          className="dialog-backdrop"
          role="presentation"
        >
          <section
            className="section-dialog floating-surface"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="locked-dialog-title"
          >
            <h2 id="locked-dialog-title">문서 편집 안내</h2>
            <p>{blockedMessage}</p>
            <div className="section-dialog__actions">
              <button
                type="button"
                className="button-primary"
                autoFocus
                onClick={() => setBlockedMessage(null)}
              >
                확인
              </button>
            </div>
          </section>
        </div>
      )}

      <WorkspaceHistoryPanels
        {...{
          historyOpen: false,
          aiHistorySelection,
          historySelection,
          historyFilter,
          historyRequest,
          setHistoryOpen,
          historyAiOnly,
          setHistoryAiOnly,
          setAiHistorySelection,
          setHistorySelection,
          filteredHistoryEntries,
          documents,
          focusSource,
          inspectHistory,
          restoring,
          canRestoreHistory,
          locked,
          onBlocked,
          setHistoryConfirm,
          taskDocuments,
          focusResultPath,
          reuseAiEntry,
          creatingTask,
          canWriteAiRequest,
          collaboration,
          aiBusy,
          queueSupported,
          historyEntries,
          setNotice,
          historyConfirm,
          restoreSelectedHistory,
        }}
      />

      <WorkspaceContextMenus
        {...{
          copyToProject,
          previewContextMenu,
          canvasSheets,
          locked,
          beginCanvasMove,
          pathLocked,
          editBusy,
          movingResults,
          setResultFolderPrompt,
          setPreviewContextMenu,
          collaboration,
          api,
          loadProject,
          showError,
          openHistory,
          setDeletePrompt,
          documentContextMenu,
          flushEditors,
          setDocumentContextMenu,
          toggleDocumentCollapsed,
          onBlocked,
          sectionContextMenu,
          toggleSection,
          setSectionContextMenu,
          sectionCollapsed,
          sectionLocked,
          setSectionActionPrompt,
          overlapMenu,
          nodes,
          setNodes,
          setOverlapMenu,
          contextMenu,
          openImport,
          setContextMenu,
          addIdeaAt,
          selectedDocuments,
          setSectionTitle,
          setSectionDialogOpen,
          hasTaskSelection,
          createTask,
          selectedSections,
          capabilities,
        }}
      />

      {selectionContextMenu && (
        <SelectionContextMenu
          x={selectionContextMenu.x}
          y={selectionContextMenu.y}
          targets={selectionContextMenu.targets}
          locked={
            locked ||
            editBusy ||
            selectionContextMenu.targets.documents.some((doc) =>
              pathLocked(doc.relativePath),
            ) ||
            selectionContextMenu.targets.previews.some((preview) =>
              pathLocked(preview.relativePath),
            ) ||
            selectionContextMenu.targets.sections.some(sectionLocked)
          }
          canMove={canvasSheets.canvases.length > 1}
          canCopy={!!api.desktop}
          onColor={(color) => {
            const targets = selectionContextMenu.targets;
            closeContextMenus();
            if (
              collaboration.active &&
              collaboration.projectCopyVersion !== 1
            ) {
              showError(
                Error(
                  '다중 배경색 변경을 사용하려면 협업 서버를 최신 버전으로 업데이트해주세요.',
                ),
              );
              return;
            }
            void selectionActions.setColors(
              [...targets.documents, ...targets.previews],
              color,
            );
          }}
          onCopy={() => beginProjectCopy(selectionContextMenu.targets)}
          onMove={() => {
            const targets = selectionContextMenu.targets;
            closeContextMenus();
            beginCanvasMove(selectionMenuPaths(targets), targets.drawings);
          }}
          onCollapse={() => {
            const targets = selectionContextMenu.targets;
            closeContextMenus();
            void collapseActions.selection(targets.collapse);
          }}
          onDelete={() => {
            const targets = selectionContextMenu.targets;
            closeContextMenus();
            const members = new Set(
              targets.sections.flatMap((section) =>
                section.members.map((member) => member.path),
              ),
            );
            setDeleteDrawingTargets(targets.drawings);
            setDeleteSectionTargets(targets.sections);
            setDeleteManyPrompt([
              ...targets.documents.filter(
                (doc) => !members.has(doc.relativePath),
              ),
              ...targets.previews.map(previewDeletionItem),
            ]);
          }}
        />
      )}
      {projectCopyPrompt && (
        <ProjectCopyDialog
          key={selectionScopeKey(selectionScope)}
          api={api}
          request={projectCopyPrompt}
          flush={() => flushEditors()}
          onClose={() => setProjectCopyPrompt(null)}
          onOpen={async (id) => {
            await flushEditors();
            await api.projects.openProject(id);
            setProjectCopyPrompt(null);
            await enterProject();
          }}
        />
      )}

      {workspace.root && (
        <CanvasTabs
          hidden={uiHidden}
          sheets={canvasSheets}
          active={activeCanvas}
          unread={
            new Set([
              ...documents
                .filter((doc) => newFileNodes.has(doc.id))
                .map((doc) => canvasId(doc.canvasId)),
              ...previews
                .filter((preview) =>
                  newFileNodes.has(previewNodeId(preview.relativePath)),
                )
                .map((preview) => canvasId(preview.canvasId)),
            ])
          }
          readOnly={
            materialPicker !== null ||
            (collaboration.active &&
              (collaboration.role === 'viewer' ||
                !collaboration.connected ||
                !collaboration.canvasSheets ||
                !!collaboration.pendingChanges))
          }
          switchTo={switchCanvasTo}
          change={changeSheets}
        />
      )}
      <WorkspaceTransferDialogs
        {...{
          moveCanvasItems,
          saveResultFolder,
          movingCanvasItems,
          moveCanvasTarget,
          setMoveCanvasTarget,
          canvasSheets,
          canvasOperationBusy,
          setMovingCanvasItems,
          setCanvasOperationBusy,
          canvasBatch,
          loadProject,
          changeSheets,
          setSelectedIds,
          setSelectedSectionIds,
          showError,
          resultFolderPrompt,
          previews,
          movingResults,
          setResultFolderPrompt,
          setMovingResults,
          flushEditors,
          api,
          setNotice,
          importTarget,
          importingFiles,
          setImportTarget,
          imagePurpose,
          setImagePurpose,
          importError,
          locked,
          importFiles,
        }}
      />

      <WorkspaceAiDialogs
        {...{
          selectMaterials,
          materialPicker,
          materialName,
          documentSetName,
          discordApprovalOpen,
          setDiscordApprovalOpen,
          approvalInboxFocusId,
          setApprovalInboxFocusId,
          setCollaborationTab,
          setCollaborationOpen,
          home,
          legacyModal,
          codexStatusOpen,
          setCodexStatusOpen,
          selectedAiProvider,
          setCodexStatus,
          setSelectedAiProvider,
          setSelectedAiModel,
          setSelectedAiReasoning,
          codexStatus,
          checkingCodex,
          refreshCodexStatus,
          approvalInboxOpen,
          aiRequest,
          collaboration,
          noticeProject,
          selectedAiModel,
          aiBusy,
          changeAiModel,
          selectedAiReasoning,
          setApprovalInboxOpen,
          editApprovalRequest,
          startApprovalRequest,
          focusResultPath,
          creatingTask,
          closeAiRequest,
          aiRequestDialogRef,
          loadingAiRequest,
          savedAiDraft,
          aiDraftStatus,
          initializeAiRequest,
          loadRecentAiRequest,
          openHistory,
          aiRequestPage,
          aiRequestVisited,
          navigateAiPage,
          aiRequestIssues,
          aiPageIssues,
          aiRequestSubmitError,
          focusAiIssue,
          editingApproval,
          setApprovalCopyFrom,
          setEditingApproval,
          setAiDraftStatus,
          activeAiInstruction,
          previousAiPage,
          nextAiPage,
          submitAiRequest,
          submittingApproval,
          queueSupported,
          projectAiQueue,
          documents,
          sections,
          previews,
          setAiRequest,
          canvasSheets,
          canvasItems: materialItems,
          jumpTo,
          organizedSets,
          documentChoiceForUpdate,
          multiplayerChoiceRequired,
          effectiveAiRequest,
        }}
      />

      <SectionRenameDialog
        prompt={sectionRename}
        busy={editBusy}
        locked={
          !!sectionRename && pathLocked(sectionRename.section.relativePath)
        }
        change={(title) =>
          setSectionRename((current) =>
            current ? { ...current, title } : current,
          )
        }
        close={() => {
          if (!editBusy) setSectionRename(null);
        }}
        confirm={() => {
          const prompt = sectionRename;
          if (prompt)
            void sectionActions.rename(prompt, () => {
              if (sectionPromptsRef.current.sectionRename === prompt)
                setSectionRename(null);
            });
        }}
      />

      <SelectionDeleteDialogs
        part="many"
        deletePrompt={deletePrompt}
        deleteManyPrompt={deleteManyPrompt}
        deleteDrawingTargets={deleteDrawingTargets}
        deleteSectionTargets={deleteSectionTargets}
        editBusy={editBusy}
        pathLocked={pathLocked}
        setDeletePrompt={setDeletePrompt}
        setDeleteManyPrompt={setDeleteManyPrompt}
        deleteDocument={deleteDocument}
        confirmDeleteMany={confirmDeleteMany}
      />

      <SectionDialogs
        sectionDialogOpen={sectionDialogOpen}
        sectionTitle={sectionTitle}
        createDocuments={createPrompt?.documents ?? []}
        setSectionDialogOpen={openSectionDialog}
        setSectionTitle={setSectionTitle}
        createSectionFromSelection={() => {
          void createSectionFromSelection();
        }}
        membershipPrompt={membershipPrompt}
        cancelMembershipChange={() => {
          void cancelMembershipChange();
        }}
        confirmMembershipChange={() => {
          void confirmMembershipChange();
        }}
        sectionActionPrompt={sectionActionPrompt}
        setSectionActionPrompt={(value) => {
          if (!editBusy) setSectionActionPrompt(value);
        }}
        confirmSectionAction={() => {
          void confirmSectionAction();
        }}
        sectionLocked={sectionLocked}
        pathLocked={pathLocked}
        busy={editBusy}
      />

      <SelectionDeleteDialogs
        part="single"
        deletePrompt={deletePrompt}
        deleteManyPrompt={deleteManyPrompt}
        deleteDrawingTargets={deleteDrawingTargets}
        deleteSectionTargets={deleteSectionTargets}
        editBusy={editBusy}
        pathLocked={pathLocked}
        setDeletePrompt={setDeletePrompt}
        setDeleteManyPrompt={setDeleteManyPrompt}
        deleteDocument={deleteDocument}
        confirmDeleteMany={confirmDeleteMany}
      />
    </main>
  );
}
