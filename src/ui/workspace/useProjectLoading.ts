import { readProjectPreference } from './project-preferences.ts';
import type { ReactFlowInstance } from '@xyflow/react';
import { useCallback, useRef } from 'react';
import { isAiTaskPath, isCanvasDocument } from '../../ai-task-records.ts';
import { NEW_FILE_GAP, verticalLayouts } from '../../canvas-placement.ts';
import { canvasId } from '../../canvas-sheets.ts';
import type { DocumentSaveState } from '../../document-save-queue.ts';
import type { DocumentStatuses } from '../../document-statuses.ts';
import type { KanbanView } from '../../features/kanban/view.ts';
import {
  readNewFileIndicators,
  updateNewFileIndicators,
  type NewFileIndicators,
} from '../../new-file-indicators.ts';
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  HistoryEntry,
  PreviewResult,
  PreviewWindowState,
  WorkspaceState,
} from '../../shared.ts';
import { pendingDocument } from '../documents/presentation.ts';
import { previewNodeId, type CanvasNode } from './workspace-types.ts';
import type { WorkspaceCanvasChange } from '../../contracts/project.ts';

interface Ports {
  workspace: WorkspaceState;
  documents: CanvasDocument[];
  htmlLinkDocuments: CanvasDocument[];
  workspaceData: import('./workspace-data').WorkspaceDataLoader;
  setWorkspace: import('react').Dispatch<
    import('react').SetStateAction<WorkspaceState>
  >;
  setDocuments: import('react').Dispatch<
    import('react').SetStateAction<CanvasDocument[]>
  >;
  setTaskDocuments: import('react').Dispatch<
    import('react').SetStateAction<CanvasDocument[]>
  >;
  setHtmlLinkDocuments: import('react').Dispatch<
    import('react').SetStateAction<CanvasDocument[]>
  >;
  setSections: import('react').Dispatch<
    import('react').SetStateAction<CanvasSection[]>
  >;
  setPreviews: import('react').Dispatch<
    import('react').SetStateAction<PreviewResult[]>
  >;
  setPreviewWindows: import('react').Dispatch<
    import('react').SetStateAction<Record<string, PreviewWindowState>>
  >;
  newFileIndicatorsRef: import('react').RefObject<{
    root: string | null;
    value?: NewFileIndicators;
  }>;
  setNewFileNodes: import('react').Dispatch<
    import('react').SetStateAction<Set<string>>
  >;
  setLoading: import('react').Dispatch<import('react').SetStateAction<boolean>>;
  canvasProjectRef: import('react').RefObject<string | null>;
  activeCanvasRef: import('react').RefObject<string>;
  preferences: import('../runtime/preferences').PreferenceStore;
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
  setCanvasSheets: import('react').Dispatch<
    import('react').SetStateAction<CanvasSheets>
  >;
  previewWindowCache: import('react').RefObject<{
    root: string | null;
    sessionId?: string;
    windows: Record<string, PreviewWindowState>;
  }>;
  api: import('../../contracts/app-api').AppApi;
  documentSaveStates: import('react').RefObject<Map<string, DocumentSaveState>>;
  saveNewFileIndicators: (root: string, value: NewFileIndicators) => void;
  setStatusError: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  setKanbanViewError: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  setKanbanView: import('react').Dispatch<
    import('react').SetStateAction<{ value: KanbanView; raw: string | null }>
  >;
  setStatusSettings: import('react').Dispatch<
    import('react').SetStateAction<{
      value: DocumentStatuses;
      raw: string | null;
    }>
  >;
  setLoadedProjectRoot: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  reconcile: <T extends { relativePath: string }>(
    current: T[],
    next: T[],
  ) => T[];
  setUndoState: import('react').Dispatch<
    import('react').SetStateAction<{ undo: string | null; redo: string | null }>
  >;
  knownPreviewsRef: import('react').RefObject<{
    root: string | null;
    paths: Set<string>;
  }>;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setHistoryOpen: (value: import('react').SetStateAction<boolean>) => void;
  setHistoryEntries: (
    value: import('react').SetStateAction<HistoryEntry[]>,
  ) => void;
  setHistorySelection: (
    value: import('react').SetStateAction<{
      entry: HistoryEntry;
      path: string;
      version: 'before' | 'after';
      content: string | null;
    } | null>,
  ) => void;
  setAiHistorySelection: (
    value: import('react').SetStateAction<HistoryEntry | null>,
  ) => void;
  setEditStates: import('react').Dispatch<
    import('react').SetStateAction<
      Record<string, { dirty: boolean; saving: boolean; failed: boolean }>
    >
  >;
  setAiRequest: import('react').Dispatch<
    import('react').SetStateAction<
      import('../../gamejam-request').GamejamRequest | null
    >
  >;
  setAiResultPaths: import('react').Dispatch<
    import('react').SetStateAction<string[]>
  >;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  viewportIntent?: import('react').RefObject<number>;
  showError: (error: unknown) => void;
}
export function useProjectLoading(ports: () => Ports) {
  const current = useRef(ports);
  current.current = ports;
  const readProject = useCallback(async (fit = false, throwOnError = false) => {
    const {
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
    } = current.current();

    const intent = current.current().viewportIntent?.current;
    const canFit = () => intent === current.current().viewportIntent?.current;
    const load = workspaceData.begin();
    try {
      const state = await load.workspace();
      if (!load.current()) return;
      setWorkspace(state);
      if (!state.root) {
        setDocuments([]);
        setTaskDocuments([]);
        setHtmlLinkDocuments([]);
        setSections([]);
        setPreviews([]);
        setPreviewWindows({});
        newFileIndicatorsRef.current = { root: null };
        setNewFileNodes(new Set());
        setLoading(false);
        return;
      }
      const next = await load.canvas(state);
      if (!next || !load.current()) return;
      const {
        documents: nextDocuments,
        sections: nextSections,
        previews: nextPreviews,
        sheets: nextSheets,
      } = next;
      const projectChanged = canvasProjectRef.current !== state.root;
      let selectedCanvas = activeCanvasRef.current;
      if (projectChanged) {
        try {
          selectedCanvas =
            readProjectPreference(
              preferences,
              'game-canvas-active-sheet:',
              state,
            ) ?? 'default';
        } catch {
          /* Personal preferences are optional. */
        }
      }
      if (!nextSheets.canvases.some((sheet) => sheet.id === selectedCanvas))
        selectedCanvas = nextSheets.canvases[0].id;
      if (projectChanged || selectedCanvas !== activeCanvasRef.current) {
        activeCanvasRef.current = selectedCanvas;
        setActiveCanvas(selectedCanvas);
        setSelectedIds([]);
        setSelectedSectionIds([]);
        setNodes([]);
      }
      canvasProjectRef.current = state.root;
      setCanvasSheets((current) =>
        JSON.stringify(current) === JSON.stringify(nextSheets)
          ? current
          : nextSheets,
      );
      const nextWindows: Record<string, PreviewWindowState> = {};
      const cache = previewWindowCache.current;
      const sameWindowSession =
        cache.root === state.root &&
        cache.sessionId === state.session?.sessionId;
      const savedWindows = await Promise.all(
        nextPreviews.map((result) =>
          sameWindowSession && cache.windows[result.relativePath]
            ? Promise.resolve(cache.windows[result.relativePath])
            : api.preview.getPreviewWindow(result.relativePath),
        ),
      );
      const visibleDocuments = nextDocuments.map((document) =>
        pendingDocument(
          document,
          documentSaveStates.current.get(`${state.saveScope}:${document.id}`),
        ),
      );
      const canvasDocuments = visibleDocuments.filter(isCanvasDocument);
      const right = canvasDocuments.length
        ? Math.max(
            ...canvasDocuments.map((document) => document.x + document.width),
          ) + 120
        : 1100;
      const top = canvasDocuments.length
        ? Math.min(...canvasDocuments.map((document) => document.y))
        : 120;
      if (!load.current()) return;
      const occupied = [
        ...canvasDocuments.map((doc) => ({
          ...doc,
          height: doc.collapsed ? 38 : doc.height,
        })),
        ...savedWindows
          .filter((state): state is PreviewWindowState => !!state)
          .map((state) => ({
            ...state,
            height: state.collapsed ? 38 : state.height,
          })),
      ];
      let nextPreviewY = top;
      for (const [index, result] of nextPreviews.entries()) {
        const oldWindow = savedWindows[index];
        const relocated = oldWindow?.placementId !== result.placementId;
        const saved = relocated ? null : oldWindow;
        const initial = result.initialWindow;
        const localOccupied = [
          ...canvasDocuments.filter(
            (doc) => canvasId(doc.canvasId) === canvasId(result.canvasId),
          ),
          ...nextPreviews.flatMap((preview, i) =>
            canvasId(preview.canvasId) === canvasId(result.canvasId) &&
            savedWindows[i]
              ? [savedWindows[i]!]
              : [],
          ),
          ...nextPreviews
            .filter(
              (preview) =>
                canvasId(preview.canvasId) === canvasId(result.canvasId) &&
                nextWindows[preview.relativePath] &&
                !savedWindows[nextPreviews.indexOf(preview)],
            )
            .map((preview) => nextWindows[preview.relativePath]),
        ].map((item) => ({
          ...item,
          height: item.collapsed ? 38 : item.height,
        }));
        const layout = saved ?? {
          ...(relocated && initial
            ? { ...(oldWindow ?? initial), x: initial.x, y: initial.y }
            : verticalLayouts(
                [
                  {
                    width: initial?.width ?? 720,
                    height: initial?.height ?? 520,
                  },
                ],
                localOccupied,
                initial ?? { x: right, y: nextPreviewY },
              )[0]),
          collapsed: oldWindow?.collapsed ?? false,
          ...(result.placementId
            ? { placementId: result.placementId }
            : { placementId: undefined }),
        };
        nextWindows[result.relativePath] = layout;
        if (!saved) {
          occupied.push(layout);
          nextPreviewY = layout.y + layout.height + NEW_FILE_GAP;
        }
        if (!saved)
          await api.preview.savePreviewWindow(layout, result.relativePath);
      }
      if (!load.current()) return;
      let indicatorState =
        newFileIndicatorsRef.current.root === state.root
          ? newFileIndicatorsRef.current.value
          : undefined;
      if (!indicatorState) {
        try {
          indicatorState = readNewFileIndicators(
            preferences.getItem(`game-canvas-new-files:${state.root}`),
          );
        } catch {
          /* Preferences may be unavailable. */
        }
      }
      const indicators = updateNewFileIndicators(
        indicatorState,
        [
          ...canvasDocuments.map((doc) => doc.id),
          ...nextPreviews.map((result) => previewNodeId(result)),
        ],
        Object.fromEntries(
          nextPreviews.flatMap((result) =>
            (result.previousPaths ?? []).map((old) => [
              previewNodeId(old),
              previewNodeId(result),
            ]),
          ),
        ),
      );
      newFileIndicatorsRef.current = { root: state.root, value: indicators };
      saveNewFileIndicators(state.root, indicators);
      setNewFileNodes((current) =>
        current.size === indicators.unread.length &&
        indicators.unread.every((id) => current.has(id))
          ? current
          : new Set(indicators.unread),
      );
      let boardError = '';
      const boardSettings = await api.editor
        .getKanbanView?.()
        .catch((error) => {
          boardError = error instanceof Error ? error.message : String(error);
          return null;
        });
      const workflowSettings = await api.editor
        .getDocumentStatuses?.()
        .catch((error) => {
          setStatusError(
            error instanceof Error ? error.message : String(error),
          );
          return null;
        });
      if (!load.current()) return;
      setKanbanViewError(boardError);
      if (boardSettings)
        setKanbanView((old) =>
          JSON.stringify(old) === JSON.stringify(boardSettings)
            ? old
            : boardSettings,
        );
      if (workflowSettings) {
        setStatusSettings((old) =>
          JSON.stringify(old) === JSON.stringify(workflowSettings)
            ? old
            : workflowSettings,
        );
        setStatusError('');
      }
      setLoadedProjectRoot(state.root);
      setDocuments((current) => reconcile(current, canvasDocuments));
      setHtmlLinkDocuments((current) =>
        reconcile(
          current,
          visibleDocuments.filter((doc) => !!doc.htmlSource),
        ),
      );
      setTaskDocuments((current) =>
        reconcile(
          current,
          visibleDocuments.filter(
            (doc) => doc.type === 'ai-task' || isAiTaskPath(doc.relativePath),
          ),
        ),
      );
      setSections((current) => reconcile(current, nextSections));
      setPreviews((current) => reconcile(current, nextPreviews));
      setPreviewWindows((current) => {
        const merged = { ...nextWindows };
        if (sameWindowSession) {
          for (const [path, window] of Object.entries(nextWindows)) {
            const latest = current[path];
            if (
              latest &&
              latest !== cache.windows[path] &&
              latest.placementId === window.placementId
            )
              merged[path] = latest;
          }
        }
        return JSON.stringify(current) === JSON.stringify(merged)
          ? current
          : merged;
      });
      setUndoState(await api.history.getUndoState());
      if (knownPreviewsRef.current.root !== state.root) {
        setInspectorId(null);
        setHistoryOpen(false);
        setHistoryEntries([]);
        setHistorySelection(null);
        setAiHistorySelection(null);
        setEditStates({});
        setAiRequest(null);
        setAiResultPaths([]);
      }
      const previous = knownPreviewsRef.current;
      const addedResult = nextPreviews.some(
        (result) => !previous.paths.has(result.relativePath),
      );
      knownPreviewsRef.current = {
        root: state.root,
        paths: new Set(nextPreviews.map((result) => result.relativePath)),
      };
      setNotice(
        `${canvasDocuments.length}개 Markdown 문서 · HTML ${nextPreviews.length}개를 불러왔습니다.`,
      );
      setLoading(false);
      let hasSavedViewport = false;
      try {
        hasSavedViewport = !!readProjectPreference(
          preferences,
          'game-canvas-sheet-view:',
          state,
          ':' + selectedCanvas,
        );
      } catch {
        /* Optional preference. */
      }
      if (fit && !hasSavedViewport)
        setTimeout(
          () =>
            canFit() &&
            void flowRef.current?.fitView({
              nodes: flowRef.current
                ?.getNodes()
                .filter((n) => !n.className?.includes('section-member-hidden')),
              padding: 0.16,
            }),
          60,
        );
      else if (
        addedResult &&
        previous.root === state.root &&
        nextPreviews.some(
          (result) =>
            canvasId(result.canvasId) === activeCanvasRef.current &&
            !previous.paths.has(result.relativePath),
        )
      )
        setTimeout(
          () =>
            canFit() &&
            void flowRef.current?.fitView({
              nodes: nextPreviews
                .filter(
                  (result) =>
                    canvasId(result.canvasId) === activeCanvasRef.current,
                )
                .map((result) => ({
                  id: previewNodeId(result),
                })),
              padding: 0.2,
              duration: 350,
            }),
          120,
        );
    } catch (error) {
      if (!load.current()) return;
      setLoading(false);
      if (throwOnError) throw error;
      showError(error);
    }
  }, []);

  const fullLoad = useRef({
    version: 0,
    pending: null as Promise<void> | null,
  });
  const layoutLoads = useRef(Promise.resolve());
  const loadProject = useCallback(
    (fit = false, throwOnError = false) => {
      const pending = readProject(fit, throwOnError);
      const load = { version: fullLoad.current.version + 1, pending };
      fullLoad.current = load;
      const clear = () => {
        if (fullLoad.current === load) fullLoad.current.pending = null;
      };
      void pending.then(clear, clear);
      return pending;
    },
    [readProject],
  );
  const loadCanvasChange = useCallback(
    ({ sessionId, paths, sections, kanban }: WorkspaceCanvasChange) => {
      const load = layoutLoads.current.then(async () => {
        const {
          api,
          workspace,
          documentSaveStates,
          reconcile,
          setDocuments,
          setSections,
          setHtmlLinkDocuments,
          setPreviews,
          setKanbanView,
          setKanbanViewError,
          setUndoState,
        } = current.current();
        const isCurrent = () =>
          current.current().workspace.session?.sessionId === sessionId;
        while (isCurrent()) {
          const { pending, version } = fullLoad.current;
          if (pending) {
            await pending.catch(() => undefined);
            continue;
          }
          const [saved, nextSections, board, undo] = await Promise.all([
            sections
              ? api.editor.listDocuments()
              : Promise.all(
                  paths.map((path) =>
                    api.editor.getDocument(path).catch(() => null),
                  ),
                ),
            sections ? api.editor.listSections() : undefined,
            kanban ? api.editor.getKanbanView() : undefined,
            api.history.getUndoState(),
          ]);
          if (!isCurrent()) return;
          if (version !== fullLoad.current.version) continue;
          const documents = saved.filter((document) => document !== null);
          if (documents.length !== saved.length) return loadProject(false);
          if (!sections && documents.length) {
            const view = current.current();
            const known = new Map(
              [...view.documents, ...view.htmlLinkDocuments].map((doc) => [
                doc.relativePath,
                doc,
              ]),
            );
            if (
              documents.some((doc) => {
                const previous = known.get(doc.relativePath);
                return (
                  !previous ||
                  previous.id !== doc.id ||
                  previous.type !== doc.type ||
                  previous.htmlSource !== doc.htmlSource ||
                  canvasId(previous.canvasId) !== canvasId(doc.canvasId)
                );
              })
            )
              return loadProject(false);
          }
          const patch = (
            existing: CanvasDocument[],
            fresh: CanvasDocument[],
          ) => {
            const byPath = new Map(fresh.map((doc) => [doc.relativePath, doc]));
            return reconcile(
              existing,
              sections
                ? fresh
                : existing.map((doc) => byPath.get(doc.relativePath) ?? doc),
            );
          };
          if (documents.length || sections) {
            const visible = documents
              .filter(isCanvasDocument)
              .map((doc) =>
                pendingDocument(
                  doc,
                  documentSaveStates.current.get(
                    `${workspace.saveScope}:${doc.id}`,
                  ),
                ),
              );
            setDocuments((existing) => patch(existing, visible));
            const htmlLinks = documents.filter((doc) => !!doc.htmlSource);
            setHtmlLinkDocuments((existing) => patch(existing, htmlLinks));
            const sources = new Map(
              htmlLinks.map((doc) => [doc.relativePath, doc]),
            );
            setPreviews((existing) => {
              const next = existing.map((preview) => {
                const source =
                  preview.sourcePath && sources.get(preview.sourcePath);
                if (!source || source.htmlSource !== preview.relativePath)
                  return preview;
                const {
                  statusPropertyEnabled,
                  workflowStatusId,
                  workflowOrder,
                } = source;
                const initial = preview.initialWindow;
                const moved =
                  initial && (source.x !== initial.x || source.y !== initial.y);
                return moved ||
                  statusPropertyEnabled !== preview.statusPropertyEnabled ||
                  workflowStatusId !== preview.workflowStatusId ||
                  workflowOrder !== preview.workflowOrder
                  ? {
                      ...preview,
                      statusPropertyEnabled,
                      workflowStatusId,
                      workflowOrder,
                      initialWindow: moved
                        ? { ...initial, x: source.x, y: source.y }
                        : initial,
                    }
                  : preview;
              });
              return next.every((preview, i) => preview === existing[i])
                ? existing
                : next;
            });
          }
          if (nextSections)
            setSections((existing) => reconcile(existing, nextSections));
          if (board) {
            setKanbanView((existing) =>
              existing.raw === board.raw ? existing : board,
            );
            setKanbanViewError('');
          }
          setUndoState(undo);
          return;
        }
      });
      layoutLoads.current = load.catch(() => undefined);
      return load;
    },
    [loadProject],
  );

  return { loadProject, loadCanvasChange };
}
