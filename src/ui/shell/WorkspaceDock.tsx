import { useRuntime } from '../runtime/RuntimeProvider';
import { reasoningLabel } from '../../core/ai/catalog';
import type { ComponentProps } from 'react';
import { WorkspaceCanvasTools } from '../canvas/WorkspaceCanvasTools';
import { WorkspaceHeader } from '../shell/WorkspaceHeader';
import { WorkspaceHistoryPanels } from '../history/WorkspaceHistoryPanels';
import { WorkspaceSettings } from '../shell/WorkspaceSettings';
import { WorkspaceAiPanels } from '../ai/WorkspaceAiPanels';
import { WorkspaceInspector } from '../shell/WorkspaceInspector';
import { WorkspaceCanvas } from '../canvas/WorkspaceCanvas';
import { WorkspaceAiDialogs } from '../ai/WorkspaceAiDialogs';
import { FilePropertiesEditor } from '../FileProperties';
import { statusPropertyApplied } from '../../file-properties';
import { KanbanControls } from '../../features/kanban/KanbanControls';
import { PluginControlPanel } from '../../features/plugins/PluginControlPanel';
import { GameUiControls } from '../../features/game-ui/GameUiControls';
import { gameUiHeight } from '../../game-ui-types';
import { DrawingInspector } from '../drawing/DrawingControls';
import { CanvasMiniMap } from '../CanvasMiniMap';
import { CanvasVisibilityPicker } from '../../features/kanban/CanvasVisibilityPicker';
import { AiQueuePanel } from '../AiQueuePanel';
import { CanvasPanel } from '../CanvasChrome';
import {
  Keyboard,
  Columns2,
  AlertCircle,
  Bot,
  CheckCircle2,
  Folder,
  FolderOpen,
  Frame,
  History,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  Square,
  Users,
  X,
} from 'lucide-react';
import { MultiplayerLobby } from '../MultiplayerLobby';
import { authorLabel } from '../../author-label';
import {
  entryTaskRecord,
  historyTaskPath,
  isAiTaskPath,
  relatedAiEntries,
} from '../../ai-task-records';
import { AiTaskDetails } from '../AiTaskDetails';
import { getAiProvider } from '../ai/presentation';
import { CODEX_STATUS_LABELS } from '../workspace/workspace-types';
import { getAiModelLabel } from '../ai/presentation';
import { previewNodeId } from '../workspace/workspace-types';
import { sectionNodeId } from '../workspace/workspace-types';
import { TYPE_LABELS } from '../documents/presentation';
import { statusLabel } from '../documents/presentation';
import { requireDesktopApi } from '../runtime/desktop-api';

type Props = Pick<
  ComponentProps<typeof WorkspaceCanvasTools>,
  | 'activeCanvas'
  | 'canvasSheets'
  | 'deleteDrawings'
  | 'drawing'
  | 'drawingContinuous'
  | 'drawingPressure'
  | 'drawingStyle'
  | 'drawingTool'
  | 'drawingTouch'
  | 'duplicateDrawings'
  | 'gameUi'
  | 'pluginPanelOpen'
  | 'selectedDrawings'
  | 'setDrawingContinuous'
  | 'setDrawingPressure'
  | 'setDrawingStyle'
  | 'setDrawingTouch'
  | 'setPluginPanelOpen'
  | 'setPluginPanelPage'
  | 'submitDrawing'
  | 'tool'
> &
  Pick<
    ComponentProps<typeof WorkspaceHeader>,
    | 'aiBusy'
    | 'canWriteAiRequest'
    | 'collaboration'
    | 'locked'
    | 'openHistory'
    | 'projectAiQueue'
    | 'queueSupported'
    | 'setApprovalInboxOpen'
    | 'setCollaborationOpen'
    | 'setCollaborationTab'
    | 'setNavigatorOpen'
    | 'setSettingsOpen'
    | 'settingsOpen'
    | 'theme'
    | 'uiHidden'
  > &
  Pick<
    ComponentProps<typeof WorkspaceHistoryPanels>,
    | 'aiHistorySelection'
    | 'canRestoreHistory'
    | 'creatingTask'
    | 'filteredHistoryEntries'
    | 'focusResultPath'
    | 'historyAiOnly'
    | 'historyEntries'
    | 'historyFilter'
    | 'historyOpen'
    | 'historyRequest'
    | 'historySelection'
    | 'inspectHistory'
    | 'onBlocked'
    | 'restoring'
    | 'reuseAiEntry'
    | 'setAiHistorySelection'
    | 'setHistoryAiOnly'
    | 'setHistoryConfirm'
    | 'setHistorySelection'
  > &
  Pick<
    ComponentProps<typeof WorkspaceSettings>,
    | 'api'
    | 'codexStatus'
    | 'editBusy'
    | 'loadProject'
    | 'movingResults'
    | 'setCodexStatusOpen'
    | 'setResultFolderPrompt'
    | 'setShortcutsOpen'
    | 'setSnapEnabled'
    | 'setStatusManagerOpen'
    | 'setUpdateOpen'
    | 'snapEnabled'
    | 'statusError'
    | 'workflowBusy'
    | 'workflowEditable'
  > &
  Pick<
    ComponentProps<typeof WorkspaceAiPanels>,
    | 'canRunAi'
    | 'canStopAi'
    | 'cancelCodexRun'
    | 'cancellingCodexRun'
    | 'closeCompletion'
    | 'closeRunPanel'
    | 'codexLogsRef'
    | 'codexRun'
    | 'codexRunCollapsed'
    | 'completion'
    | 'flowRef'
    | 'home'
    | 'nodes'
    | 'runFailure'
    | 'runOutputPaths'
    | 'runPanelVisible'
    | 'setAiQueue'
    | 'setCodexRunCollapsed'
    | 'setHistoryOpen'
    | 'setNotice'
    | 'showError'
  > &
  Pick<
    ComponentProps<typeof WorkspaceInspector>,
    | 'canvasItems'
    | 'documents'
    | 'filePropertyViews'
    | 'focusSource'
    | 'inspectorAiRecords'
    | 'inspectorAuthorship'
    | 'inspectorId'
    | 'jumpTo'
    | 'pathLocked'
    | 'previews'
    | 'propertyVisibilityFor'
    | 'sections'
    | 'setCompareFirst'
    | 'setInspectorId'
    | 'setSectionRename'
    | 'statusSettings'
    | 'taskDocuments'
    | 'updateFilePropertyViews'
    | 'workflowChange'
    | 'workflowReason'
  > &
  Pick<
    ComponentProps<typeof WorkspaceCanvas>,
    'minimapPreferences' | 'updateMiniMapPreferences'
  > &
  Pick<ComponentProps<typeof WorkspaceAiDialogs>, 'noticeProject'> & {
    dockPanel: import('../CanvasChrome').CanvasPanelId | null;
    eraserMode: import('../../drawing-types').EraserMode;
    gameUiPanelActive: boolean;
    gameUiSettings: { enabled: boolean };
    kanbanPreferences: ComponentProps<
      typeof import('../../features/kanban/KanbanControls').KanbanControls
    >['preferences'];
    kanbanViewError: string;
    kanbanVisibilityValue: ComponentProps<
      typeof import('../../features/kanban/CanvasVisibilityPicker').CanvasVisibilityPicker
    >['value'];
    pluginPanelGeometry: import('../../features/plugins/PluginControlPanel').PluginPanelGeometry;
    pluginPanelPage: import('../../features/plugins/builtin-features').PluginPanelPage;
    revealKanban: () => void;
    setDiscordApprovalOpen: import('react').Dispatch<
      import('react').SetStateAction<boolean>
    >;
    setDockPanel: import('react').Dispatch<
      import('react').SetStateAction<
        import('../CanvasChrome').CanvasPanelId | null
      >
    >;
    setGameUiPanelHost: import('react').Dispatch<
      import('react').SetStateAction<HTMLDivElement | null>
    >;
    setGameUiSettings: (value: { enabled: boolean }) => void;
    setKanbanAppearanceOpen: (
      value: import('react').SetStateAction<boolean>,
    ) => void;
    toggleKanban: (value: boolean) => void;
    updateKanbanPreferences: ComponentProps<
      typeof import('../../features/kanban/KanbanControls').KanbanControls
    >['update'];
    updateKanbanVisibility: ComponentProps<
      typeof import('../../features/kanban/CanvasVisibilityPicker').CanvasVisibilityPicker
    >['change'];
    updatePluginPanelGeometry: (
      value: import('../../features/plugins/PluginControlPanel').PluginPanelGeometry,
    ) => void;
  };

export function WorkspaceDock({
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
}: Props) {
  const { capabilities } = useRuntime();
  return (
    <>
      {!uiHidden && dockPanel && (
        <CanvasPanel
          active={dockPanel}
          change={(id) => {
            if (id === 'ai') setCodexRunCollapsed(false);
            if (id === 'activity') openHistory();
            else setDockPanel(id);
          }}
          close={() => setDockPanel(null)}
        >
          {dockPanel === 'navigation' && (
            <CanvasMiniMap
              theme={theme}
              preferences={minimapPreferences}
              change={updateMiniMapPreferences}
            />
          )}
          {dockPanel === 'ai' && (
            <>
              {!projectAiQueue.length && !codexRun && (
                <p className="canvas-panel-empty">
                  진행 중인 AI 작업이 없습니다. gamejam!에서 새 작업을
                  시작하세요.
                </p>
              )}
              {!home && (
                <AiQueuePanel
                  tasks={projectAiQueue}
                  canCancel={canRunAi}
                  cancel={async (task) => {
                    if (task.status === 'queued')
                      await api.ai.cancelQueuedTask(task.taskId);
                    else await api.ai.cancelCodexRun(task.runId);
                    if (!collaboration.active)
                      setAiQueue(await api.ai.listAiQueue());
                  }}
                  open={(task) => {
                    if (codexRun?.runId === task.runId)
                      setCodexRunCollapsed(false);
                    else openHistory(task.taskPath, true);
                  }}
                />
              )}
              {runPanelVisible && codexRun && (
                <aside
                  className={`codex-run-panel floating-surface${codexRunCollapsed ? ' codex-run-panel--collapsed' : ''}`}
                  aria-live="polite"
                >
                  <header>
                    <div className="codex-run-panel__title">
                      {codexRun.status === 'starting' ||
                      codexRun.status === 'running' ||
                      codexRun.status === 'validating' ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : codexRun.status === 'completed' ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <AlertCircle size={16} />
                      )}
                      <div>
                        <strong>
                          {getAiProvider(codexRun.providerId).label} 작업
                        </strong>
                        <span>
                          {CODEX_STATUS_LABELS[codexRun.status]} ·{' '}
                          {getAiModelLabel(
                            codexRun.providerId,
                            codexRun.modelId,
                          )}{' '}
                          · {reasoningLabel(codexRun.reasoningEffort)}
                        </span>
                      </div>
                    </div>
                    <div className="codex-run-panel__header-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title="AI 작업 기록 열기"
                        onClick={() => openHistory(codexRun.taskPath, true)}
                      >
                        <History size={14} />
                      </button>
                      {codexRun.status === 'completed' && (
                        <button
                          title="생성 결과로 이동"
                          onClick={() => {
                            const paths = runOutputPaths;
                            const result = previews
                              .filter((preview) =>
                                paths.includes(preview.relativePath),
                              )
                              .at(-1);
                            if (result)
                              jumpTo(previewNodeId(result.relativePath));
                            else {
                              const ids = documents
                                .filter((doc) =>
                                  paths.includes(doc.relativePath),
                                )
                                .map((doc) => ({ id: doc.id }));
                              if (ids.length)
                                void flowRef.current?.fitView({
                                  nodes: ids,
                                  padding: 0.2,
                                  duration: 300,
                                });
                              else setNavigatorOpen(true);
                            }
                          }}
                        >
                          <Play size={13} /> 결과 보기
                        </button>
                      )}
                      {(codexRun.status === 'starting' ||
                        codexRun.status === 'running' ||
                        codexRun.status === 'validating') && (
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => void cancelCodexRun()}
                          disabled={cancellingCodexRun || !canStopAi}
                          title="현재 AI 작업 중지"
                        >
                          {cancellingCodexRun ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Square size={13} />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                          if (codexRunCollapsed) {
                            setInspectorId(null);
                            setSettingsOpen(false);
                            setHistoryOpen(false);
                          }
                          setCodexRunCollapsed((current) => !current);
                        }}
                        title={
                          codexRunCollapsed
                            ? '작업 패널 펼치기'
                            : '작업 패널 최소화'
                        }
                      >
                        {codexRunCollapsed ? (
                          <Maximize2 size={14} />
                        ) : (
                          <Minimize2 size={14} />
                        )}
                      </button>
                      {codexRun.status !== 'starting' &&
                        codexRun.status !== 'running' &&
                        codexRun.status !== 'validating' && (
                          <button
                            type="button"
                            className="icon-button"
                            onClick={closeRunPanel}
                            title="실행 패널 닫기"
                          >
                            <X size={14} />
                          </button>
                        )}
                    </div>
                  </header>
                  {!codexRunCollapsed && (
                    <>
                      <ol className="ai-stages" aria-label="AI 진행 단계">
                        {[
                          ['starting', '준비'],
                          ['running', '실행'],
                          ['validating', '검증'],
                          ['completed', '완료'],
                        ].map(([status, label], index) => (
                          <li
                            key={status}
                            className={
                              codexRun.status === status
                                ? 'is-current'
                                : [
                                      'starting',
                                      'running',
                                      'validating',
                                      'completed',
                                    ].indexOf(codexRun.status) > index
                                  ? 'is-done'
                                  : ''
                            }
                          >
                            <span>{index + 1}</span>
                            {label}
                          </li>
                        ))}
                      </ol>
                      <code className="codex-run-panel__task">
                        {codexRun.taskPath}
                      </code>
                      {runFailure && (
                        <section
                          className="ai-failure-details"
                          aria-label="AI 오류 진단"
                        >
                          <strong>
                            {runFailure.code} · {runFailure.stage}
                          </strong>
                          <p>{runFailure.message}</p>
                          <p>{runFailure.hint}</p>
                          <small>실행 ID: {codexRun.runId}</small>
                          <div>
                            <button
                              disabled={!capabilities.nativeClipboard}
                              onClick={() => {
                                void requireDesktopApi(api)
                                  .copyText(
                                    JSON.stringify(
                                      {
                                        runId: codexRun.runId,
                                        taskPath: codexRun.taskPath,
                                        provider: codexRun.providerId,
                                        model: codexRun.modelId,
                                        reasoningEffort:
                                          codexRun.reasoningEffort,
                                        ...runFailure,
                                      },
                                      null,
                                      2,
                                    ),
                                  )
                                  .then(() =>
                                    setNotice('오류 진단 정보를 복사했습니다.'),
                                  )
                                  .catch(showError);
                              }}
                            >
                              진단 정보 복사
                            </button>
                            {runFailure.diagnosticPath && (
                              <button
                                disabled={!capabilities.localFiles}
                                onClick={() => {
                                  void requireDesktopApi(api)
                                    .revealPath(runFailure.diagnosticPath!)
                                    .catch(showError);
                                }}
                              >
                                진단 파일 보기
                              </button>
                            )}
                          </div>
                        </section>
                      )}
                      <div
                        ref={codexLogsRef}
                        className="codex-run-panel__logs nowheel"
                        role="log"
                        aria-label="AI 작업 진행 로그"
                      >
                        {codexRun.events.length === 0 ? (
                          <p>AI 프로세스의 응답을 기다리고 있습니다.</p>
                        ) : (
                          codexRun.events.map((event, index) => (
                            <p
                              key={`${event.timestamp}-${index}`}
                              className={`codex-log codex-log--${event.kind}`}
                            >
                              <time>
                                {new Date(event.timestamp).toLocaleTimeString(
                                  'ko-KR',
                                  {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  },
                                )}
                              </time>
                              <span>{event.message}</span>
                            </p>
                          ))
                        )}
                      </div>
                      {(codexRun.status === 'starting' ||
                        codexRun.status === 'running' ||
                        codexRun.status === 'validating') && (
                        <footer>
                          <span>
                            새 로그가 추가되면 자동으로 최신 위치를 표시합니다.
                          </span>
                          <button
                            type="button"
                            onClick={() => void cancelCodexRun()}
                            disabled={cancellingCodexRun || !canStopAi}
                          >
                            {cancellingCodexRun ? (
                              <LoaderCircle className="spin" size={13} />
                            ) : (
                              <Square size={13} />
                            )}{' '}
                            {cancellingCodexRun ? '중지 중' : '작업 중지'}
                          </button>
                        </footer>
                      )}
                    </>
                  )}
                </aside>
              )}

              {completion && completion.project === noticeProject && (
                <section
                  className={`ai-completion-toast floating-surface${completion.status === 'failed' ? ' ai-completion-toast--failed' : ''}`}
                  role="status"
                  aria-live="polite"
                  aria-label="AI 작업 완료 알림"
                >
                  <button
                    className="icon-button ai-completion-toast__close"
                    title="완료 알림 닫기"
                    onClick={closeCompletion}
                  >
                    <X size={14} />
                  </button>
                  <strong>
                    {completion.status === 'completed' ? (
                      <>
                        <CheckCircle2 size={18} /> 완료!
                      </>
                    ) : (
                      <>
                        <AlertCircle size={18} /> 작업 실패 ·{' '}
                        {runFailure?.code ?? '진단 확인'}
                      </>
                    )}
                  </strong>
                  <p>
                    {completion.status === 'completed'
                      ? `${completion.taskPath.includes('/gamejam-') ? '문서 정리 + HTML 구현' : completion.taskPath.includes('/organize-') ? '문서 정리' : 'HTML 구현'} 결과를 검증하고 저장했습니다.`
                      : '기존 결과는 유지했습니다. 오류 진단을 확인해주세요.'}
                  </p>
                  <div>
                    <button
                      onClick={() => {
                        setCodexRunCollapsed(false);
                        setInspectorId(null);
                        setHistoryOpen(false);
                        setSettingsOpen(false);
                      }}
                    >
                      {completion.status === 'completed'
                        ? '작업 내용 보기'
                        : '오류 진단 보기'}
                    </button>
                    {completion.status === 'completed' && (
                      <button
                        onClick={() => {
                          const ids = nodes
                            .filter((node) =>
                              node.data.kind === 'document'
                                ? runOutputPaths.includes(
                                    node.data.document.relativePath,
                                  )
                                : node.data.kind === 'preview'
                                  ? runOutputPaths.includes(
                                      node.data.preview.relativePath,
                                    )
                                  : false,
                            )
                            .map((node) => ({ id: node.id }));
                          if (ids.length)
                            void flowRef.current?.fitView({
                              nodes: ids,
                              padding: 0.2,
                              duration: 300,
                            });
                          else setNavigatorOpen(true);
                        }}
                      >
                        결과로 이동
                      </button>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
          {dockPanel === 'properties' && (
            <>
              <div
                ref={setGameUiPanelHost}
                className="canvas-game-ui-host"
                hidden={!gameUiPanelActive}
              />
              {inspectorId &&
                (() => {
                  const item = canvasItems.find(
                      (item) => item.id === inspectorId,
                    ),
                    doc = documents.find((doc) => doc.id === inspectorId),
                    section = sections.find(
                      (section) => sectionNodeId(section.id) === inspectorId,
                    ),
                    preview = previews.find(
                      (preview) =>
                        previewNodeId(preview.relativePath) === inspectorId,
                    );
                  if (!item) return null;
                  return (
                    <aside
                      className="object-inspector floating-surface"
                      aria-label="선택 항목 상세 정보"
                    >
                      <header>
                        <strong>상세 정보</strong>
                        <button
                          className="icon-button"
                          title="상세 정보 닫기"
                          onClick={() => setInspectorId(null)}
                        >
                          <X size={16} />
                        </button>
                      </header>
                      <h3>{item.title}</h3>
                      <dl>
                        <dt>파일</dt>
                        <dd>
                          <code>{item.path}</code>
                        </dd>
                        {(doc || section || preview?.sourceId) && (
                          <>
                            <dt>ID</dt>
                            <dd>
                              <code>
                                {doc?.id ?? section?.id ?? preview?.sourceId}
                              </code>
                            </dd>
                          </>
                        )}
                        {doc && (
                          <>
                            <dt>문서 유형</dt>
                            <dd>
                              {TYPE_LABELS[doc.type]} ·{' '}
                              {statusLabel(doc.status)}
                            </dd>
                            <dt>위치 · 크기</dt>
                            <dd>
                              {doc.x}, {doc.y} · {doc.width} × {doc.height}
                            </dd>
                            <dt>최근 변경</dt>
                            <dd>
                              {new Date(doc.modifiedAt).toLocaleString('ko-KR')}
                            </dd>
                            <dt>소속 섹션</dt>
                            <dd>{item.parent ?? '섹션 없음'}</dd>
                          </>
                        )}
                      </dl>
                      {((doc && doc.type !== 'ai-task') || preview) && (
                        <FilePropertiesEditor
                          key={doc?.id ?? preview!.sourceId}
                          document={doc ?? preview!}
                          statuses={statusSettings.value}
                          authorship={
                            inspectorAuthorship?.path === item.path
                              ? inspectorAuthorship.value
                              : undefined
                          }
                          visibility={propertyVisibilityFor(
                            doc?.id ?? preview!.sourceId!,
                            preview?.propertyPreviousIds ?? [],
                          )}
                          disabled={
                            !workflowEditable ||
                            workflowBusy ||
                            pathLocked(item.path) ||
                            pathLocked(preview?.sourcePath ?? '')
                          }
                          reason={
                            workflowReason ||
                            (pathLocked(item.path) ||
                            pathLocked(preview?.sourcePath ?? '')
                              ? 'AI 작업이 이 파일을 보호하고 있습니다.'
                              : undefined)
                          }
                          change={async (value) => {
                            const file = doc ?? preview!;
                            await workflowChange({
                              relativePath: item.path,
                              objectId: doc?.id ?? preview!.sourceId!,
                              expectedEnabled: statusPropertyApplied(file),
                              expectedStatus: file.workflowStatusId,
                              workflowRevision: doc?.workflowRevision,
                              structureRevision: doc?.structureRevision,
                              ...value,
                            });
                          }}
                          display={(id, visible) => {
                            const key = doc?.id ?? preview!.sourceId!;
                            const aliases = preview?.propertyPreviousIds ?? [];
                            const value = {
                              ...propertyVisibilityFor(key, aliases),
                              [id]: visible,
                            };
                            updateFilePropertyViews({
                              version: 1,
                              files: {
                                ...filePropertyViews.files,
                                ...Object.fromEntries(
                                  [key, ...aliases].map((alias) => [
                                    alias,
                                    value,
                                  ]),
                                ),
                              },
                            });
                          }}
                          manage={() => setStatusManagerOpen(true)}
                        />
                      )}
                      {!((doc && doc.type !== 'ai-task') || preview) && (
                        <dl className="inspector-authorship">
                          <dt>생성한 사람</dt>
                          <dd>
                            {inspectorAuthorship?.path === item.path &&
                            inspectorAuthorship.value
                              ? authorLabel(inspectorAuthorship.value.createdBy)
                              : inspectorAuthorship?.path === item.path &&
                                  inspectorAuthorship.error
                                ? '정보를 불러오지 못했습니다'
                                : '기록 불러오는 중…'}
                            {inspectorAuthorship?.path === item.path &&
                              inspectorAuthorship.value?.createdAt && (
                                <small>
                                  {new Date(
                                    inspectorAuthorship.value.createdAt,
                                  ).toLocaleString('ko-KR')}
                                </small>
                              )}
                          </dd>
                          <dt title="본문·제목·위치·크기·섹션 등 파일 변경을 포함합니다">
                            마지막으로 편집한 사람
                          </dt>
                          <dd>
                            {inspectorAuthorship?.path === item.path &&
                            inspectorAuthorship.value
                              ? authorLabel(
                                  inspectorAuthorship.value.lastEditedBy,
                                )
                              : inspectorAuthorship?.path === item.path &&
                                  inspectorAuthorship.error
                                ? '정보를 불러오지 못했습니다'
                                : '기록 불러오는 중…'}
                            {inspectorAuthorship?.path === item.path &&
                              inspectorAuthorship.value?.lastEditedAt && (
                                <small>
                                  {new Date(
                                    inspectorAuthorship.value.lastEditedAt,
                                  ).toLocaleString('ko-KR')}
                                </small>
                              )}
                          </dd>
                        </dl>
                      )}
                      {doc?.sources.length ? (
                        <div className="inspector-sources">
                          <strong>
                            참고한 원본 자료 {doc.sources.length}개
                          </strong>
                          {doc.sources.map((source) => (
                            <button
                              key={source.id}
                              title={source.contribution}
                              onClick={() => focusSource(source.id)}
                            >
                              {documents.find((doc) => doc.id === source.id)
                                ?.title ??
                                previews.find(
                                  (preview) => preview.sourceId === source.id,
                                )?.title ??
                                source.id}
                              <small>{source.contribution}</small>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {section && (
                        <>
                          <button
                            disabled={locked}
                            onClick={() =>
                              setSectionRename({
                                section,
                                title: section.title,
                              })
                            }
                          >
                            섹션 이름 변경
                          </button>
                          <strong>포함 문서 {section.members.length}개</strong>
                          {section.members.map((member) => (
                            <button
                              key={member.id}
                              onClick={() => jumpTo(member.id)}
                            >
                              {documents.find((doc) => doc.id === member.id)
                                ?.title ?? member.path}
                            </button>
                          ))}
                        </>
                      )}
                      {!section && (
                        <div
                          className="inspector-sources"
                          aria-label="관련 AI 작업 기록"
                        >
                          <strong>관련 AI 작업 기록</strong>
                          {inspectorAiRecords?.path !== item.path ||
                          !inspectorAiRecords.entries ? (
                            <small>
                              {inspectorAiRecords?.error
                                ? '기록을 불러오지 못했습니다.'
                                : '기록 불러오는 중…'}
                            </small>
                          ) : (
                            (() => {
                              const entries = relatedAiEntries(
                                inspectorAiRecords.entries,
                                item.path,
                                taskDocuments,
                                previews.find(
                                  (preview) =>
                                    preview.relativePath === item.path,
                                )?.previousPaths,
                              );
                              return entries.length ? (
                                <>
                                  {entries.slice(0, 3).map((entry) => (
                                    <button
                                      key={entry.id}
                                      onClick={() =>
                                        openHistory(item.path, true, entry)
                                      }
                                    >
                                      {entryTaskRecord(entry, taskDocuments)
                                        ?.title ?? entry.label}
                                      <small>
                                        {new Date(
                                          entry.createdAt,
                                        ).toLocaleString('ko-KR')}{' '}
                                        · {CODEX_STATUS_LABELS[entry.status]} ·{' '}
                                        {entry.actorName ?? '로컬 사용자'}
                                      </small>
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => openHistory(item.path, true)}
                                  >
                                    AI 작업 기록 전체 보기 ({entries.length})
                                  </button>
                                </>
                              ) : (
                                <small>
                                  이 결과와 연결된 AI 실행 기록이 없습니다.
                                </small>
                              );
                            })()
                          )}
                        </div>
                      )}
                      <div className="inspector-actions">
                        <button
                          disabled={!capabilities.localFiles}
                          onClick={() =>
                            void requireDesktopApi(api).revealPath(item.path)
                          }
                        >
                          <Folder size={14} /> 파일 보기
                        </button>
                        <button onClick={() => void openHistory(item.path)}>
                          <History size={14} /> 히스토리
                        </button>
                        {preview && (
                          <button
                            onClick={() =>
                              setCompareFirst(preview.relativePath)
                            }
                          >
                            <Columns2 size={14} /> 버전 비교
                          </button>
                        )}
                      </div>
                    </aside>
                  );
                })()}
              {!inspectorId && !gameUiPanelActive && (
                <>
                  {(tool === 'drawing' || selectedDrawings.length > 0) && (
                    <DrawingInspector
                      eraserMode={eraserMode}
                      objects={drawing.items.filter((o) =>
                        selectedDrawings.some((s) => s.id === o.id),
                      )}
                      tool={drawingTool}
                      style={drawingStyle}
                      onStyle={setDrawingStyle}
                      submit={submitDrawing}
                      disabled={locked || drawing.saving}
                      onDuplicate={() => duplicateDrawings()}
                      allObjects={drawing.items}
                      onDelete={deleteDrawings}
                      pressure={drawingPressure}
                      onPressure={setDrawingPressure}
                      touch={drawingTouch}
                      onTouch={setDrawingTouch}
                      continuous={drawingContinuous}
                      onContinuous={setDrawingContinuous}
                      canvases={canvasSheets.canvases}
                      canvasId={activeCanvas}
                    />
                  )}
                </>
              )}
              {!inspectorId &&
                tool !== 'drawing' &&
                !selectedDrawings.length &&
                !gameUiPanelActive && (
                  <p className="canvas-panel-empty">
                    항목의 속성 버튼을 누르거나 도형·그리기 도구를 선택하세요.
                  </p>
                )}
            </>
          )}
          {settingsOpen && (
            <aside
              className="canvas-settings floating-surface"
              aria-label="캔버스 설정"
            >
              <header>
                <strong>설정 및 도구</strong>
                <button
                  className="icon-button"
                  title="설정 닫기"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X size={16} />
                </button>
              </header>
              <button
                disabled={!workflowEditable || workflowBusy}
                onClick={() => {
                  setSettingsOpen(false);
                  setStatusManagerOpen(true);
                }}
              >
                상태 속성 옵션 관리
              </button>
              {statusError && (
                <p className="workflow-error" role="alert">
                  {statusError}
                </p>
              )}
              <button
                disabled={!capabilities.localAiExecution}
                onClick={() => {
                  setSettingsOpen(false);
                  setCodexStatusOpen(true);
                }}
              >
                <Bot size={16} /> AI 연결 설정{' '}
                <small>
                  {codexStatus?.available && codexStatus.authenticated
                    ? '연결됨'
                    : '연결 필요'}
                </small>
              </button>
              <button
                disabled={!capabilities.appUpdates}
                onClick={() => {
                  setSettingsOpen(false);
                  setUpdateOpen(true);
                }}
              >
                <RefreshCw size={16} /> 앱 업데이트
              </button>
              {(!collaboration.active || collaboration.role === 'admin') && (
                <button
                  disabled={!api.desktop?.discordApproval}
                  onClick={() => {
                    setSettingsOpen(false);
                    setDiscordApprovalOpen(true);
                  }}
                >
                  디스코드 알림 · 테스트
                </button>
              )}
              <button onClick={() => void loadProject(false)}>
                <RefreshCw size={16} /> 캔버스 새로고침
              </button>
              <button
                disabled={!capabilities.localFiles}
                onClick={() => void requireDesktopApi(api).openWorkspace()}
              >
                <FolderOpen size={16} /> 프로젝트 폴더 열기
              </button>
              <button
                disabled={locked || editBusy || movingResults}
                onClick={() => {
                  setSettingsOpen(false);
                  setResultFolderPrompt('legacy');
                }}
              >
                <FolderOpen size={16} /> 기존 결과물 폴더 정리
              </button>
              <button
                aria-pressed={snapEnabled}
                onClick={() => setSnapEnabled((value) => !value)}
              >
                <Frame size={16} /> 스마트 정렬 가이드{' '}
                <small>{snapEnabled ? '켜짐' : '꺼짐'}</small>
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  setShortcutsOpen(true);
                }}
              >
                <Keyboard size={16} /> 단축키 안내 <kbd>?</kbd>
              </button>
            </aside>
          )}
          {!home && pluginPanelOpen && (
            <PluginControlPanel
              page={pluginPanelPage}
              navigate={setPluginPanelPage}
              enabled={(id) =>
                id === 'builtin.game-ui'
                  ? gameUiSettings.enabled
                  : kanbanVisibilityValue.enabled
              }
              toggle={(id, value) =>
                id === 'builtin.game-ui'
                  ? setGameUiSettings({ enabled: value })
                  : toggleKanban(value)
              }
              geometry={pluginPanelGeometry}
              updateGeometry={updatePluginPanelGeometry}
              canvasName={
                canvasSheets.canvases.find((c) => c.id === activeCanvas)
                  ?.name ?? '현재 캔버스'
              }
              close={() => setPluginPanelOpen(false)}
            >
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
                    (collaboration.active && collaboration.gameUiVersion !== 2)
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
            </PluginControlPanel>
          )}
          {historyOpen && (
            <aside
              className={`history-panel floating-surface${aiHistorySelection || historySelection ? ' history-panel--has-detail' : ''}`}
              aria-label="프로젝트 히스토리"
            >
              <header>
                <strong>
                  {historyFilter
                    ? `${historyFilter} 히스토리`
                    : '프로젝트 히스토리'}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  title="히스토리 닫기"
                  onClick={() => {
                    historyRequest.current += 1;
                    setHistoryOpen(false);
                  }}
                >
                  <X size={16} />
                </button>
              </header>
              <div
                className="history-tabs"
                role="group"
                aria-label="히스토리 보기 방식"
              >
                <button
                  aria-pressed={!historyAiOnly}
                  onClick={() => {
                    setHistoryAiOnly(false);
                    setAiHistorySelection(null);
                    setHistorySelection(null);
                    historyRequest.current++;
                  }}
                >
                  전체 히스토리
                </button>
                <button
                  aria-pressed={historyAiOnly}
                  onClick={() => {
                    setHistoryAiOnly(true);
                    setAiHistorySelection(null);
                    setHistorySelection(null);
                    historyRequest.current++;
                  }}
                >
                  AI 작업 기록
                </button>
              </div>
              <div className="history-panel__body">
                <div className="history-panel__entries">
                  {filteredHistoryEntries.map((entry) => (
                    <div
                      className="history-entry"
                      data-history-kind={entry.kind}
                      key={entry.id}
                    >
                      <strong>{entry.label}</strong>
                      <small>
                        {new Date(entry.createdAt).toLocaleString()} ·{' '}
                        {CODEX_STATUS_LABELS[entry.status]}
                        {entry.modelId ? ` · ${entry.modelId}` : ''} ·{' '}
                        {reasoningLabel(entry.reasoningEffort)}
                        {` · ${entry.actorName ?? '로컬 사용자'}`}
                      </small>
                      {entry.error && (
                        <p className="history-error">{entry.error}</p>
                      )}
                      {(historyTaskPath(entry) || entry.kind === 'ai') && (
                        <button
                          type="button"
                          className="history-ai-record-button"
                          aria-pressed={aiHistorySelection?.id === entry.id}
                          onClick={() => {
                            historyRequest.current++;
                            setHistorySelection(null);
                            setAiHistorySelection(entry);
                          }}
                        >
                          <Bot size={13} /> 작업 지시 · 실행 상세 보기
                        </button>
                      )}
                      {entry.files
                        .filter((file) => !isAiTaskPath(file.relativePath))
                        .map((file) => (
                          <button
                            type="button"
                            key={file.relativePath}
                            onClick={() => {
                              const target = documents.find(
                                (document) =>
                                  document.relativePath === file.relativePath,
                              );
                              if (target) focusSource(target.id);
                              void inspectHistory(
                                entry,
                                file.relativePath,
                                file.after ? 'after' : 'before',
                              );
                            }}
                          >
                            {file.after
                              ? file.before
                                ? '수정'
                                : '생성'
                              : '삭제'}{' '}
                            · {file.relativePath}
                          </button>
                        ))}
                      {entry.status === 'completed' &&
                        entry.files.some(
                          (file) => !isAiTaskPath(file.relativePath),
                        ) && (
                          <button
                            type="button"
                            disabled={restoring || !canRestoreHistory}
                            onClick={() => {
                              if (locked) onBlocked();
                              else setHistoryConfirm({ entry });
                            }}
                          >
                            이 기록의 파일 함께 복원
                          </button>
                        )}
                    </div>
                  ))}
                  {!filteredHistoryEntries.length && (
                    <p>
                      {historyAiOnly
                        ? '아직 연결된 AI 작업 기록이 없습니다.'
                        : '아직 저장된 버전이 없습니다.'}
                    </p>
                  )}
                </div>
                {aiHistorySelection && (
                  <div className="history-preview">
                    <AiTaskDetails
                      entry={aiHistorySelection}
                      record={entryTaskRecord(
                        aiHistorySelection,
                        taskDocuments,
                      )}
                      statusLabel={
                        CODEX_STATUS_LABELS[aiHistorySelection.status]
                      }
                      onOpenPath={focusResultPath}
                      onReuse={() => reuseAiEntry(aiHistorySelection)}
                      reuseDisabled={
                        creatingTask ||
                        !canWriteAiRequest ||
                        (collaboration.role !== 'editor' &&
                          ((aiBusy && !queueSupported) || locked))
                      }
                      onOpenRetry={(id) => {
                        const previous = historyEntries.find(
                          (entry) => entry.id === id,
                        );
                        if (previous) setAiHistorySelection(previous);
                        else setNotice('이전 요청 기록을 찾을 수 없습니다.');
                      }}
                    />
                  </div>
                )}
                {historySelection && (
                  <div className="history-preview">
                    <strong>{historySelection.path}</strong>
                    <div className="history-preview__actions">
                      <button
                        type="button"
                        onClick={() =>
                          void inspectHistory(
                            historySelection.entry,
                            historySelection.path,
                            'before',
                          )
                        }
                      >
                        변경 전
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void inspectHistory(
                            historySelection.entry,
                            historySelection.path,
                            'after',
                          )
                        }
                      >
                        변경 후
                      </button>
                      {!historySelection.entry.files.some(
                        (file) =>
                          file.relativePath.startsWith('sections/') ||
                          file.relativePath.startsWith('assets/images/'),
                      ) &&
                        historySelection.entry.status === 'completed' && (
                          <button
                            type="button"
                            disabled={restoring || !canRestoreHistory}
                            onClick={() => {
                              if (locked) onBlocked();
                              else
                                setHistoryConfirm({
                                  entry: historySelection.entry,
                                  path: historySelection.path,
                                  version: historySelection.version,
                                });
                            }}
                          >
                            이 파일 버전 복원
                          </button>
                        )}
                    </div>
                    <small>
                      {historySelection.version === 'before'
                        ? '변경 전 내용'
                        : '변경 후 내용'}{' '}
                      · 파일 복원은 지금 보고 있는 버전을 사용합니다.
                    </small>
                    {historySelection.content === null ? (
                      <p>이 시점에는 파일이 없습니다.</p>
                    ) : historySelection.path.startsWith('assets/images/') ? (
                      <img
                        className="project-image"
                        src={historySelection.content}
                        alt="이전 이미지 원본"
                      />
                    ) : historySelection.path.endsWith('.html') ? (
                      <iframe
                        title="이전 HTML 결과"
                        sandbox="allow-scripts"
                        srcDoc={historySelection.content}
                      />
                    ) : (
                      <pre>{historySelection.content}</pre>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}
          {dockPanel === 'collaboration' && (
            <section className="canvas-collaboration">
              <h3>협업</h3>
              <p>
                {collaboration.active
                  ? collaboration.connected
                    ? '공동 프로젝트에 연결되어 있습니다.'
                    : '협업 연결을 확인해주세요.'
                  : '함께 작업할 사람을 초대하세요.'}
              </p>
              <button
                onClick={() => {
                  setCollaborationTab('create');
                  setCollaborationOpen(true);
                }}
              >
                <Users size={16} /> 참여자 · 초대 관리
              </button>
              {collaboration.active && (
                <button onClick={() => setApprovalInboxOpen(true)}>
                  {collaboration.role === 'admin' ? '요청함' : '내 요청'}{' '}
                  {collaboration.pendingRequests
                    ? '(' + collaboration.pendingRequests + ')'
                    : ''}
                </button>
              )}
              {(!collaboration.active || collaboration.role === 'admin') && (
                <button
                  aria-label="디스코드 알림 설정 및 테스트"
                  onClick={() => setDiscordApprovalOpen(true)}
                >
                  디스코드 알림
                </button>
              )}
              {collaboration.active && (
                <MultiplayerLobby key={collaboration.projectId} projectOnly />
              )}
            </section>
          )}
        </CanvasPanel>
      )}
    </>
  );
}
