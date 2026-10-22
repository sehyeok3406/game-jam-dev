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

interface Ports {
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
  showError: (error: unknown) => void;
}
export function useProjectLoading(ports: () => Ports) {
  const current = useRef(ports);
  current.current = ports;
  const loadProject = useCallback(async (fit = false, throwOnError = false) => {
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
            preferences.getItem('game-canvas-active-sheet:' + state.root) ??
            'default';
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
      const savedWindows = await Promise.all(
        nextPreviews.map((result) =>
          previewWindowCache.current.root === state.root &&
          previewWindowCache.current.windows[result.relativePath]
            ? Promise.resolve(
                previewWindowCache.current.windows[result.relativePath],
              )
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
          ...nextPreviews.map((result) => previewNodeId(result.relativePath)),
        ],
        Object.fromEntries(
          nextPreviews.flatMap((result) =>
            (result.previousPaths ?? []).map((old) => [
              previewNodeId(old),
              previewNodeId(result.relativePath),
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
      setPreviewWindows((current) =>
        JSON.stringify(current) === JSON.stringify(nextWindows)
          ? current
          : nextWindows,
      );
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
        hasSavedViewport = !!preferences.getItem(
          'game-canvas-sheet-view:' + state.root + ':' + selectedCanvas,
        );
      } catch {
        /* Optional preference. */
      }
      if (fit && !hasSavedViewport)
        setTimeout(
          () =>
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
            void flowRef.current?.fitView({
              nodes: nextPreviews
                .filter(
                  (result) =>
                    canvasId(result.canvasId) === activeCanvasRef.current,
                )
                .map((result) => ({
                  id: previewNodeId(result.relativePath),
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

  return { loadProject };
}
