import { useEffect, useRef } from 'react';
import type { DrawingObject, DrawingTool } from '../../drawing-types.ts';
import {
  defaultCanvasKanban,
  type KanbanCanvasPreferences,
} from '../../features/kanban/preferences.ts';
import type { PluginPanelPage } from '../../features/plugins/builtin-features.ts';
import type { GamejamPage } from '../../gamejam-wizard.ts';
import type {
  CanvasDocument,
  CanvasSection,
  HistoryEntry,
  PreviewResult,
} from '../../shared.ts';
import { DEFAULT_TASK_INSTRUCTIONS } from '../../task-instructions.ts';
import {
  SAMPLE_DOCUMENT,
  SAMPLE_HISTORY,
  SAMPLE_PREVIEW,
  SAMPLE_SECTION,
  SAMPLE_TIME,
  sampleRun,
} from './uiDebugFixtures.ts';
import type { UiDebugSelection } from './uiDebugRegistry.ts';
import type { CanvasTool } from '../workspace/workspace-types.ts';
import {
  previewDeletionItem,
  previewNodeId,
  sectionNodeId,
  type CanvasNode,
  type CodexRunView,
  type ContextMenuState,
  type DocumentContextMenuState,
  type PreviewContextMenuState,
  type SectionContextMenuState,
} from '../workspace/workspace-types.ts';

interface Ports {
  setDockPanel: (
    value: import('react').SetStateAction<
      import('../CanvasChrome').CanvasPanelId | null
    >,
  ) => void;
  setMinimapVisible: (value: import('react').SetStateAction<boolean>) => void;
  setEraserSettings: (value: {
    mode: import('../../drawing-types').EraserMode;
    size: number;
  }) => void;
  setCheckingCodex: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;
  setTool: import('react').Dispatch<import('react').SetStateAction<CanvasTool>>;
  setNoteDraft: import('react').Dispatch<
    import('react').SetStateAction<{
      start: { x: number; y: number };
      end: { x: number; y: number };
    } | null>
  >;
  chooseDrawingTool: (next: DrawingTool) => void;
  setGuides: import('react').Dispatch<
    import('react').SetStateAction<{ x?: number; y?: number }>
  >;
  documents: CanvasDocument[];
  sections: CanvasSection[];
  previews: PreviewResult[];
  setCollaborationOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  setCollaborationTab: import('react').Dispatch<
    import('react').SetStateAction<'create' | 'join' | 'recover'>
  >;
  setUpdateOpen: (value: import('react').SetStateAction<boolean>) => void;
  setUpdateRestarting: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  setNavigatorOpen: (value: import('react').SetStateAction<boolean>) => void;
  setFindOpen: (value: import('react').SetStateAction<boolean>) => void;
  setCommandOpen: (value: import('react').SetStateAction<boolean>) => void;
  setShortcutsOpen: (value: import('react').SetStateAction<boolean>) => void;
  setCompareFirst: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setSettingsOpen: (value: import('react').SetStateAction<boolean>) => void;
  setUiHidden: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setDocuments: import('react').Dispatch<
    import('react').SetStateAction<CanvasDocument[]>
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
  setNewFileNodes: import('react').Dispatch<
    import('react').SetStateAction<Set<string>>
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
  setHistoryConfirm: (
    value: import('react').SetStateAction<{
      entry: HistoryEntry;
      path?: string;
      version?: 'before' | 'after';
    } | null>,
  ) => void;
  setRestoring: (value: import('react').SetStateAction<boolean>) => void;
  setCodexStatusOpen: (value: import('react').SetStateAction<boolean>) => void;

  setCodexRun: import('react').Dispatch<
    import('react').SetStateAction<CodexRunView | null>
  >;
  noticeProject: string | null;
  setCodexRunCollapsed: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  setAiRequestPage: import('react').Dispatch<
    import('react').SetStateAction<2 | 1 | 5 | 3 | 4>
  >;
  setAiRequestVisited: import('react').Dispatch<
    import('react').SetStateAction<number>
  >;
  setAiInstructionPage: import('react').Dispatch<
    import('react').SetStateAction<'organize' | 'implement'>
  >;
  setAiRequest: import('react').Dispatch<
    import('react').SetStateAction<
      import('../../gamejam-request').GamejamRequest | null
    >
  >;
  setSelectedAiModel: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  setCreatingTask: import('react').Dispatch<
    import('react').SetStateAction<boolean>
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
  setResultFolderPrompt: import('react').Dispatch<
    import('react').SetStateAction<PreviewResult | 'legacy' | null>
  >;
  setMovingResults: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  setImportTarget: (
    value: import('react').SetStateAction<{ x: number; y: number } | null>,
  ) => void;
  setImportingFiles: (value: import('react').SetStateAction<boolean>) => void;
  setImportError: (value: import('react').SetStateAction<string>) => void;
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
  setCanvasOperationBusy: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  setStatusManagerOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  setKanbanAppearanceOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  setPluginPanelOpen: (value: import('react').SetStateAction<boolean>) => void;
  setPluginPanelPage: import('react').Dispatch<
    import('react').SetStateAction<PluginPanelPage>
  >;
  updateKanbanPreferences: (
    value: KanbanCanvasPreferences,
    canvas?: string,
  ) => void;
  updateSectionViews: (value: Record<string, boolean>) => void;
  setCreatePrompt: (
    value: import('react').SetStateAction<
      import('../canvas/section-actions').SectionCreatePrompt | null
    >,
  ) => void;
  setSectionRename: (
    value: import('react').SetStateAction<
      import('../canvas/section-actions').SectionRenamePrompt | null
    >,
  ) => void;
  setMembershipPrompt: (
    value: import('react').SetStateAction<
      import('../canvas/section-actions').MembershipPrompt | null
    >,
  ) => void;
  setSectionActionPrompt: (
    value: import('react').SetStateAction<
      import('../canvas/section-actions').SectionActionPrompt | null
    >,
  ) => void;
  setDeletePrompt: (
    value: import('react').SetStateAction<
      import('../canvas/selection-plan').DeletionItem | null
    >,
  ) => void;
  setDeleteManyPrompt: (
    value: import('react').SetStateAction<
      import('../canvas/selection-plan').DeletionItem[] | null
    >,
  ) => void;
  setBlockedMessage: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
}
export function useWorkspacePreview(
  ports: () => Ports,
  preview: UiDebugSelection | undefined,
  dependencies: React.DependencyList,
) {
  const previewSeeded = useRef(false);
  useEffect(() => {
    const {
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
    } = ports();
    if (!preview || loading || previewSeeded.current) return;
    previewSeeded.current = true;
    const { id, state } = preview;
    if (id === 'ai-run' || id === 'completion') ports().setDockPanel('ai');
    if (id === 'drawing-inspector') ports().setDockPanel('properties');
    if (id === 'minimap' || id === 'minimap-settings')
      ports().setMinimapVisible(true);
    if (id === 'drawing-eraser') {
      document.querySelector('.canvas-drawing-group')?.setAttribute('open', '');
      ports().setEraserSettings({
        mode: state === 'partial' ? 'partial' : 'stroke',
        size: 24,
      });
      chooseDrawingTool('eraser');
      if (state !== 'pending')
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLButtonElement>(
              '[data-ui-id="drawing-eraser"] > button',
            )
            ?.click(),
        );
    }
    if (id === 'note-drawing') {
      setTool('note');
      setNoteDraft({ start: { x: 440, y: 220 }, end: { x: 800, y: 470 } });
    }
    if (id === 'drawing-inspector' && state === 'tool')
      chooseDrawingTool('rectangle');
    if (id === 'drawing-tools')
      requestAnimationFrame(() =>
        document
          .querySelector('[data-ui-id="drawing-tools"]')
          ?.setAttribute('open', ''),
      );
    if (id === 'guides') setGuides({ x: 600, y: 400 });
    const doc = documents[0] ?? SAMPLE_DOCUMENT;
    const section = sections[0] ?? SAMPLE_SECTION;
    const result = previews[0] ?? SAMPLE_PREVIEW;
    const entry = {
      ...SAMPLE_HISTORY,
      ...(state === 'failed' || state === 'error'
        ? {
            status: 'failed' as const,
            error: '샘플 오류: 결과 검증에 실패했습니다.',
          }
        : {}),
    };
    if (id === 'collaboration') {
      setCollaborationOpen(true);
      setCollaborationTab(
        state === 'join' || state === 'recover' ? state : 'create',
      );
    }
    if (id === 'update') setUpdateOpen(true);
    if (id === 'update-restarting') setUpdateRestarting(true);
    if (id === 'navigator') setNavigatorOpen(true);
    if (id === 'find') setFindOpen(true);
    if (id === 'command') setCommandOpen(true);
    if (id === 'shortcuts') setShortcutsOpen(true);
    if (id === 'compare') setCompareFirst('');
    if (id === 'settings') setSettingsOpen(true);
    if (id === 'ui-hidden') setUiHidden(true);
    if (id === 'inspector' || id === 'file-properties')
      setInspectorId(
        state === 'section'
          ? sectionNodeId(section.id)
          : state === 'html'
            ? previewNodeId(result.relativePath)
            : doc.id,
      );
    if (id === 'file-properties' && state === 'unapplied')
      setDocuments((current) =>
        current.map((item) =>
          item.id === doc.id ? { ...item, statusPropertyEnabled: false } : item,
        ),
      );
    if (id === 'selection' || (id === 'section' && state === 'selected')) {
      const ids =
        id === 'section'
          ? [sectionNodeId(section.id)]
          : state === 'single'
            ? [doc.id]
            : documents.map((item) => item.id);
      setSelectedIds(id === 'section' ? [] : ids);
      setSelectedSectionIds(id === 'section' ? [section.id] : []);
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: ids.includes(node.id) })),
      );
    }
    if (id === 'document' && state === 'new')
      setNewFileNodes(new Set([doc.id]));
    if (id === 'history' || id === 'history-confirm' || id === 'ai-details') {
      setHistoryOpen(true);
      setHistoryEntries(state === 'empty' ? [] : [entry]);
      if (state === 'detail')
        setHistorySelection({
          entry,
          path: doc.relativePath,
          version: 'after',
          content: doc.body,
        });
      if (id === 'ai-details' || state === 'ai')
        setAiHistorySelection(
          state === 'missing'
            ? { ...entry, taskPath: undefined, aiTask: undefined }
            : entry,
        );
      if (id === 'history-confirm') {
        setHistoryConfirm({ entry });
        setRestoring(state === 'busy');
      }
    }
    if (id === 'ai-status') {
      setCodexStatusOpen(true);
      setCheckingCodex(state === 'busy');
    }
    if (id === 'ai-run' || id === 'completion') {
      const event = sampleRun(state);
      setCodexRun({
        project: noticeProject ?? 'ui-debug-preview',
        runId: event.runId,
        taskPath: event.taskPath,
        status: event.status,
        providerId: 'codex-cli',
        modelId: null,
        events: [
          event,
          {
            ...event,
            timestamp: SAMPLE_TIME + 1000,
            message: '샘플 로그: 화면과 진행 상태를 확인하세요.',
          },
        ],
      });
      setCodexRunCollapsed(id === 'completion' || state === 'collapsed');
    }
    if (id === 'ai-request') {
      const page: GamejamPage =
        state === 'error' || state === 'result'
          ? 2
          : state === 'empty-instructions' || state === 'instructions'
            ? 3
            : state === 'library'
              ? 4
              : state === 'busy' ||
                  state === 'invalid-model' ||
                  state === 'review'
                ? 5
                : 1;
      setAiRequestPage(page);
      setAiRequestVisited(page);
      setAiInstructionPage('organize');
      setAiRequest({
        organize:
          state !== 'implement' && state !== 'html' && state !== 'no-steps',
        implement: state !== 'organize' && state !== 'no-steps',
        inputPaths:
          state === 'html' ? [result.relativePath] : [doc.relativePath],
        x: 0,
        y: 0,
        sourceMode: state === 'html' ? 'html' : undefined,
        resultName: state === 'error' ? '../invalid' : '전투 시제품',
        instructions: {
          organize:
            state === 'empty-instructions'
              ? ''
              : DEFAULT_TASK_INSTRUCTIONS.organize,
          implement: DEFAULT_TASK_INSTRUCTIONS.implement,
        },
      });
      if (state === 'invalid-model') setSelectedAiModel('invalid model');
      setCreatingTask(state === 'busy');
    }
    const point = { screenX: 400, screenY: 180 };
    if (id === 'canvas-menu') setContextMenu({ ...point, flowX: 0, flowY: 0 });
    if (id === 'document-menu')
      setDocumentContextMenu({ ...point, document: doc });
    if (id === 'section-menu') setSectionContextMenu({ ...point, section });
    if (id === 'preview-menu')
      setPreviewContextMenu({ ...point, preview: result });
    if (id === 'result-folder') {
      setResultFolderPrompt(state === 'legacy' ? 'legacy' : result);
      setMovingResults(state === 'busy');
    }
    if (id === 'import') {
      setImportTarget({ x: 0, y: 0 });
      setImportingFiles(state === 'busy');
      setImportError(
        state === 'error' ? '샘플 오류: 파일을 불러오지 못했습니다.' : '',
      );
    }
    if (id === 'canvas-move') {
      setMovingCanvasItems({ paths: [doc.relativePath], source: 'default' });
      setMoveCanvasTarget('combat');
      setCanvasOperationBusy(state === 'busy');
    }
    if (id === 'status-manager') setStatusManagerOpen(true);
    if (id === 'kanban-appearance') setKanbanAppearanceOpen(true);
    if (id === 'plugin-controls') {
      setPluginPanelOpen(true);
      setPluginPanelPage(
        state === 'kanban'
          ? 'builtin.kanban'
          : state === 'game-ui'
            ? 'builtin.game-ui'
            : 'plugins',
      );
    }
    if (id === 'kanban') {
      updateKanbanPreferences({
        ...defaultCanvasKanban,
        enabled: state !== 'disabled',
        minimized: state === 'minimized',
        placed: true,
        x: 80,
        y: 80,
      });
      if (state === 'disabled') {
        setPluginPanelPage('builtin.kanban');
        setPluginPanelOpen(true);
      }
    }
    if (id === 'section-collapse')
      updateSectionViews({ [section.id]: state === 'collapsed' });
    if (id === 'section-create')
      setCreatePrompt({
        title: '새 섹션',
        documents: structuredClone(documents),
      });
    if (id === 'section-rename')
      setSectionRename({ section, title: section.title });
    if (id === 'membership')
      setMembershipPrompt({
        document: doc,
        fromSection: state === 'add' ? null : section,
        toSection:
          state === 'remove'
            ? null
            : state === 'move'
              ? { ...section, id: 'ui-other-section', title: '성장 시스템' }
              : section,
        x: doc.x,
        y: doc.y,
        width: doc.width,
        height: doc.height,
      });
    if (id === 'section-action')
      setSectionActionPrompt({ section, deleteMembers: state === 'delete' });
    if (id === 'delete')
      setDeletePrompt(state === 'html' ? previewDeletionItem(result) : doc);
    if (id === 'delete-many') setDeleteManyPrompt(documents);
    if (id === 'blocked')
      setBlockedMessage(
        '이 파일은 다른 사용자가 편집 중입니다. 잠시 후 다시 시도해주세요.',
      );
    if (id === 'notice')
      setNotice(
        state === 'error'
          ? '샘플 오류: 서버에 연결할 수 없습니다.'
          : 'UI 미리보기 · 샘플 프로젝트입니다.',
      );
  }, dependencies);

  return {};
}
