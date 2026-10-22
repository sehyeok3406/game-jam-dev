import { ArrowRight, Bot, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import { isQueuePending, type AiQueueTask } from '../../ai-task-queue.ts';
import { AI_PROVIDERS } from '../../core/ai/catalog.ts';
import type { DocumentOutputTemplate } from '../../document-format.ts';
import type { GamejamPage } from '../../gamejam-wizard.ts';
import type {
  AiProviderId,
  CanvasDocument,
  CanvasSection,
  CanvasSheets,
  CodexConnectionStatus,
  CollaborationState,
  HistoryEntry,
  PreviewResult,
} from '../../shared.ts';
import { GamejamRequestFields } from './GamejamRequestFields';
import { GamejamRequestFlow } from './GamejamRequestFlow';
import { getAiProvider } from './presentation.ts';
import type { CanvasItem } from '../CanvasOverlays';
import { GamejamRequestInbox } from '../GamejamRequestInbox';
import { GamejamValidationSummary } from '../GamejamValidation';
interface Props {
  codexStatusOpen: boolean;
  setCodexStatusOpen: (value: import('react').SetStateAction<boolean>) => void;
  selectedAiProvider: AiProviderId;
  setCodexStatus: import('react').Dispatch<
    import('react').SetStateAction<CodexConnectionStatus | null>
  >;
  setSelectedAiProvider: import('react').Dispatch<
    import('react').SetStateAction<AiProviderId>
  >;
  setSelectedAiModel: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  setSelectedAiReasoning: import('react').Dispatch<
    import('react').SetStateAction<
      import('../../shared').AiReasoningEffort | null
    >
  >;
  codexStatus: CodexConnectionStatus | null;
  checkingCodex: boolean;
  refreshCodexStatus: () => Promise<CodexConnectionStatus | null>;
  approvalInboxOpen: boolean;
  aiRequest: import('../../gamejam-request').GamejamRequest | null;
  collaboration: CollaborationState;
  noticeProject: string | null;
  selectedAiModel: string;
  aiBusy: boolean;
  changeAiModel: (model: string) => void;
  selectedAiReasoning: import('../../shared').AiReasoningEffort | null;
  setApprovalInboxOpen: (
    value: import('react').SetStateAction<boolean>,
  ) => void;
  editApprovalRequest: (
    item: import('../../gamejam-approval').GamejamApproval,
    copy: boolean,
  ) => void;
  startApprovalRequest: (
    detail: import('../../gamejam-approval').ApprovalDetail,
    commandId: string,
  ) => Promise<void>;
  focusResultPath: (path: string) => void;
  creatingTask: boolean;
  closeAiRequest: () => void;
  aiRequestDialogRef: import('react').RefObject<HTMLElement | null>;
  loadingAiRequest: boolean;
  savedAiDraft: import('../../gamejam-history.ts').GamejamDraft | null;
  aiDraftStatus: string;
  initializeAiRequest: (
    request: import('../../gamejam-request').GamejamRequest,
    saved?: import('../../gamejam-history.ts').GamejamSavedRequest,
    draft?: import('../../gamejam-history.ts').GamejamDraft,
    approval?: { id: string; revision: number },
  ) => void;
  loadRecentAiRequest: () => Promise<void>;
  openHistory: (
    relative?: string | null,
    aiOnly?: boolean,
    entry?: HistoryEntry,
  ) => void;
  aiRequestPage: 2 | 1 | 3 | 4 | 5;
  aiRequestVisited: number;
  navigateAiPage: (
    page: GamejamPage,
    instruction?: 'organize' | 'implement',
  ) => void;
  aiRequestIssues: import('../../gamejam-validation').GamejamIssue[];
  aiPageIssues: import('../../gamejam-validation').GamejamIssue[];
  aiRequestSubmitError: string;
  focusAiIssue: (
    issue: import('../../gamejam-validation').GamejamIssue,
  ) => void;
  editingApproval: { id: string; revision: number } | null;
  setApprovalCopyFrom: import('react').Dispatch<
    import('react').SetStateAction<string | undefined>
  >;
  setEditingApproval: import('react').Dispatch<
    import('react').SetStateAction<{ id: string; revision: number } | null>
  >;
  setAiDraftStatus: import('react').Dispatch<
    import('react').SetStateAction<string>
  >;
  activeAiInstruction: 'organize' | 'implement';
  previousAiPage: () => void;
  nextAiPage: () => void;
  submitAiRequest: () => Promise<void>;
  submittingApproval: boolean;
  queueSupported: boolean;
  projectAiQueue: AiQueueTask[];
  documents: CanvasDocument[];
  sections: CanvasSection[];
  previews: PreviewResult[];
  setAiRequest: import('react').Dispatch<
    import('react').SetStateAction<
      import('../../gamejam-request').GamejamRequest | null
    >
  >;
  canvasSheets: CanvasSheets;
  canvasItems: CanvasItem[];
  jumpTo: (id: string) => void;
  organizedSets: {
    baseDir: string;
    version: number;
    label: string;
    structure: 'custom' | 'systems' | 'legacy';
    paths: string[];
  }[];
  documentChoiceForUpdate: (baseDir: string) => {
    structure?: 'custom' | undefined;
    documents?:
      | {
          key: string;
          title: string;
          type: DocumentOutputTemplate['type'];
          instructions: string;
        }[]
      | undefined;
    mode: 'update';
    baseDir: string;
  };
  multiplayerChoiceRequired: boolean;
  effectiveAiRequest: import('../../gamejam-request').GamejamRequest | null;
}
export function WorkspaceAiDialogs({
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
  canvasItems,
  jumpTo,
  organizedSets,
  documentChoiceForUpdate,
  multiplayerChoiceRequired,
  effectiveAiRequest,
}: Props) {
  return (
    <>
      {codexStatusOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCodexStatusOpen(false);
          }}
        >
          <section
            className="codex-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="codex-status-title"
          >
            <div className="codex-dialog__icon">
              <Bot size={20} />
            </div>
            <div>
              <p>LOCAL AI CONNECTION</p>
              <h2 id="codex-status-title">내 AI 연결</h2>
              <span>
                실행하는 사람의 PC에 설치된 CLI와 본인 로그인 정보를 사용합니다.
                웹사이트나 일반 채팅 앱에 로그인한 것만으로 연결되지는 않습니다.
                계정별 사용량·요금 정책이 적용됩니다.
              </span>
              <label>
                AI 제공자{' '}
                <select
                  aria-label="연결할 AI 제공자"
                  value={selectedAiProvider}
                  onChange={(event) => {
                    setCodexStatus(null);
                    setSelectedAiProvider(event.target.value as AiProviderId);
                    setSelectedAiModel('');
                    setSelectedAiReasoning(null);
                  }}
                >
                  {AI_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <p>{getAiProvider(selectedAiProvider).description}</p>
              <p>
                설치: <code>{getAiProvider(selectedAiProvider).install}</code>
              </p>
              <p>
                로그인: <code>{getAiProvider(selectedAiProvider).login}</code>
              </p>
            </div>
            <div className="codex-status-card">
              <div>
                <span
                  className={`codex-connection-dot ${
                    codexStatus?.available && codexStatus.authenticated
                      ? 'connected'
                      : 'disconnected'
                  }`}
                />
                <strong>
                  {checkingCodex
                    ? '연결 확인 중'
                    : codexStatus?.available && codexStatus.authenticated
                      ? '사용 가능'
                      : '연결 필요'}
                </strong>
              </div>
              <p>
                {codexStatus?.message ?? '선택한 AI CLI를 확인하고 있습니다.'}
              </p>
              {codexStatus?.version && <code>{codexStatus.version}</code>}
              {codexStatus?.executablePath && (
                <code>{codexStatus.executablePath}</code>
              )}
            </div>
            <div className="codex-dialog__scope">
              <strong>현재 실행 정책</strong>
              <span>
                {selectedAiProvider === 'codex-cli'
                  ? '격리 작업 사본 · 외부 MCP 제외 · Codex 자동 검토'
                  : '격리 작업 사본 · 파일 도구만 허용 · 셸·브라우저·MCP 제외'}{' '}
                · 결과 검증 후 반영
              </span>
            </div>
            <div className="codex-dialog__actions">
              <button
                type="button"
                onClick={() => void refreshCodexStatus()}
                disabled={checkingCodex}
              >
                <RefreshCw size={14} /> 다시 확인
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={() => setCodexStatusOpen(false)}
              >
                확인
              </button>
            </div>
          </section>
        </div>
      )}

      {approvalInboxOpen && !aiRequest && collaboration.active && (
        <GamejamRequestInbox
          key={`${noticeProject}:${collaboration.memberId}`}
          collaboration={collaboration}
          provider={selectedAiProvider}
          model={selectedAiModel}
          aiBusy={aiBusy}
          setProvider={(value) => {
            setSelectedAiProvider(value);
            setSelectedAiReasoning(null);
            setCodexStatus(null);
          }}
          setModel={changeAiModel}
          reasoningEffort={selectedAiReasoning}
          setReasoningEffort={setSelectedAiReasoning}
          close={() => setApprovalInboxOpen(false)}
          edit={editApprovalRequest}
          run={startApprovalRequest}
          openResult={focusResultPath}
        />
      )}
      {aiRequest && (
        <GamejamRequestFlow
          request={aiRequest}
          busy={creatingTask}
          close={closeAiRequest}
          dialogRef={aiRequestDialogRef}
          history={{
            loading: loadingAiRequest,
            draft: savedAiDraft,
            status: aiDraftStatus,
            restore: () => {
              if (savedAiDraft)
                initializeAiRequest(
                  savedAiDraft.request,
                  savedAiDraft,
                  savedAiDraft,
                );
            },
            recent: loadRecentAiRequest,
            open: () => {
              closeAiRequest();
              openHistory(null, true);
            },
          }}
          wizard={{
            page: aiRequestPage,
            visited: aiRequestVisited,
            navigate: navigateAiPage,
          }}
        >
          <GamejamRequestFields
            {...{
              aiRequestPage,
              aiRequestIssues,
              aiRequest,
              documents,
              sections,
              previews,
              setAiRequest,
              creatingTask,
              canvasSheets,
              canvasItems,
              jumpTo,
              organizedSets,
              documentChoiceForUpdate,
              activeAiInstruction,
              navigateAiPage,
              focusAiIssue,
              multiplayerChoiceRequired,
              effectiveAiRequest,
              submittingApproval,
              selectedAiProvider,
              selectedAiModel,
              selectedAiReasoning,
              codexStatus,
              setSelectedAiProvider,
              setCodexStatus,
              setSelectedAiModel,
              setSelectedAiReasoning,
              changeAiModel,
              checkingCodex,
              refreshCodexStatus,
            }}
          />
          <footer>
            <GamejamValidationSummary
              issues={aiRequestPage === 5 ? aiRequestIssues : aiPageIssues}
              submitError={aiRequestPage === 5 ? aiRequestSubmitError : ''}
              focusIssue={focusAiIssue}
            />
            <button disabled={creatingTask} onClick={closeAiRequest}>
              취소
            </button>
            {editingApproval && (
              <button
                disabled={creatingTask}
                onClick={() => {
                  setApprovalCopyFrom(editingApproval.id);
                  setEditingApproval(null);
                  setAiDraftStatus(
                    '내용을 보존해 새 요청으로 전환했습니다. 기존 요청은 변경하지 않습니다.',
                  );
                }}
              >
                새 요청으로 전환
              </button>
            )}
            <span className="gamejam-page-count">{aiRequestPage} / 5</span>
            {(aiRequestPage > 1 ||
              (aiRequestPage === 3 &&
                activeAiInstruction === 'implement' &&
                aiRequest.organize)) && (
              <button
                type="button"
                id="ai-request-previous"
                disabled={creatingTask}
                onClick={previousAiPage}
              >
                이전
              </button>
            )}
            {aiRequestPage < 5 ? (
              <button
                type="button"
                id="ai-request-next"
                className="button-primary"
                disabled={creatingTask}
                aria-disabled={aiPageIssues.length > 0}
                aria-describedby={
                  aiPageIssues.length ? 'ai-request-validation' : undefined
                }
                onClick={nextAiPage}
              >
                {aiRequestPage === 3 &&
                aiRequest.organize &&
                aiRequest.implement &&
                activeAiInstruction === 'organize'
                  ? 'HTML 구현 지침'
                  : '다음'}{' '}
                <ArrowRight size={15} />
              </button>
            ) : (
              <button
                className="button-primary"
                disabled={creatingTask}
                aria-disabled={creatingTask || aiRequestIssues.length > 0}
                aria-describedby={
                  aiRequestIssues.length || aiRequestSubmitError
                    ? 'ai-request-validation'
                    : undefined
                }
                onClick={() => void submitAiRequest()}
              >
                {creatingTask ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Play size={15} />
                )}{' '}
                {creatingTask
                  ? '준비 중…'
                  : editingApproval
                    ? '수정 저장'
                    : submittingApproval
                      ? '요청하기'
                      : queueSupported &&
                          (aiBusy || projectAiQueue.some(isQueuePending))
                        ? '예약하기'
                        : '바로 구현하기'}
              </button>
            )}
          </footer>
        </GamejamRequestFlow>
      )}
    </>
  );
}
