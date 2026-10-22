import type { ReactFlowInstance } from '@xyflow/react';
import {
  AlertCircle,
  CheckCircle2,
  History,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Play,
  Square,
  X,
} from 'lucide-react';
import type { AiQueueTask } from '../../ai-task-queue.ts';
import { reasoningLabel } from '../../core/ai/catalog.ts';
import type {
  CanvasDocument,
  CollaborationState,
  HistoryEntry,
  PreviewResult,
} from '../../shared.ts';
import { getAiModelLabel, getAiProvider } from './presentation.ts';
import { AiQueuePanel } from '../AiQueuePanel';
import { requireDesktopApi } from '../runtime/desktop-api.ts';
import {
  CODEX_STATUS_LABELS,
  previewNodeId,
  type CanvasNode,
  type CodexRunView,
} from '../workspace/workspace-types.ts';
interface Props {
  home: boolean;
  projectAiQueue: AiQueueTask[];
  canRunAi: boolean;
  api: import('../../contracts/app-api.ts').AppApi;
  collaboration: CollaborationState;
  setAiQueue: import('react').Dispatch<
    import('react').SetStateAction<AiQueueTask[]>
  >;
  codexRun: CodexRunView | null;
  setCodexRunCollapsed: import('react').Dispatch<
    import('react').SetStateAction<boolean>
  >;
  openHistory: (
    relative?: string | null,
    aiOnly?: boolean,
    entry?: HistoryEntry,
  ) => void;
  runPanelVisible: boolean;
  codexRunCollapsed: boolean;
  runOutputPaths: string[];
  previews: PreviewResult[];
  jumpTo: (id: string) => void;
  documents: CanvasDocument[];
  flowRef: import('react').RefObject<ReactFlowInstance<CanvasNode> | null>;
  setNavigatorOpen: (value: import('react').SetStateAction<boolean>) => void;
  cancelCodexRun: () => Promise<void>;
  cancellingCodexRun: boolean;
  canStopAi: boolean;
  setInspectorId: import('react').Dispatch<
    import('react').SetStateAction<string | null>
  >;
  setSettingsOpen: (value: import('react').SetStateAction<boolean>) => void;
  setHistoryOpen: (value: import('react').SetStateAction<boolean>) => void;
  closeRunPanel: () => void;
  runFailure: import('../../app-errors.ts').FailureInfo | undefined;
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  showError: (error: unknown) => void;
  codexLogsRef: import('react').RefObject<HTMLDivElement | null>;
  completionVisible: boolean;
  completion: {
    project: string;
    runId: string;
    status: 'completed' | 'failed';
    taskPath: string;
  } | null;
  closeCompletion: () => void;
  nodes: CanvasNode[];
}
export function WorkspaceAiPanels({
  home,
  projectAiQueue,
  canRunAi,
  api,
  collaboration,
  setAiQueue,
  codexRun,
  setCodexRunCollapsed,
  openHistory,
  runPanelVisible,
  codexRunCollapsed,
  runOutputPaths,
  previews,
  jumpTo,
  documents,
  flowRef,
  setNavigatorOpen,
  cancelCodexRun,
  cancellingCodexRun,
  canStopAi,
  setInspectorId,
  setSettingsOpen,
  setHistoryOpen,
  closeRunPanel,
  runFailure,
  setNotice,
  showError,
  codexLogsRef,
  completionVisible,
  completion,
  closeCompletion,
  nodes,
}: Props) {
  return (
    <>
      {!home && (
        <AiQueuePanel
          tasks={projectAiQueue}
          canCancel={canRunAi}
          cancel={async (task) => {
            if (task.status === 'queued')
              await api.ai.cancelQueuedTask(task.taskId);
            else await api.ai.cancelCodexRun(task.runId);
            if (!collaboration.active) setAiQueue(await api.ai.listAiQueue());
          }}
          open={(task) => {
            if (codexRun?.runId === task.runId) setCodexRunCollapsed(false);
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
                <strong>{getAiProvider(codexRun.providerId).label} 작업</strong>
                <span>
                  {CODEX_STATUS_LABELS[codexRun.status]} ·{' '}
                  {getAiModelLabel(codexRun.providerId, codexRun.modelId)} ·{' '}
                  {reasoningLabel(codexRun.reasoningEffort)}
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
                      .filter((preview) => paths.includes(preview.relativePath))
                      .at(-1);
                    if (result) jumpTo(previewNodeId(result.relativePath));
                    else {
                      const ids = documents
                        .filter((doc) => paths.includes(doc.relativePath))
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
                  codexRunCollapsed ? '작업 패널 펼치기' : '작업 패널 최소화'
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
              <code className="codex-run-panel__task">{codexRun.taskPath}</code>
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
                      onClick={() => {
                        void requireDesktopApi(api)
                          .copyText(
                            JSON.stringify(
                              {
                                runId: codexRun.runId,
                                taskPath: codexRun.taskPath,
                                provider: codexRun.providerId,
                                model: codexRun.modelId,
                                reasoningEffort: codexRun.reasoningEffort,
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
                        {new Date(event.timestamp).toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
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

      {completionVisible && completion && (
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
  );
}
