import { Bot, X } from 'lucide-react';
import {
  entryTaskRecord,
  historyTaskPath,
  isAiTaskPath,
} from '../../ai-task-records.ts';
import { reasoningLabel } from '../../core/ai/catalog.ts';
import type {
  CanvasDocument,
  CollaborationState,
  HistoryEntry,
} from '../../shared.ts';
import { AiTaskDetails } from '../AiTaskDetails';
import { CODEX_STATUS_LABELS } from '../workspace/workspace-types.ts';
interface Props {
  historyOpen: boolean;
  aiHistorySelection: HistoryEntry | null;
  historySelection: {
    entry: HistoryEntry;
    path: string;
    version: 'before' | 'after';
    content: string | null;
  } | null;
  historyFilter: string | null;
  historyRequest: import('react').RefObject<number>;
  setHistoryOpen: (value: import('react').SetStateAction<boolean>) => void;
  historyAiOnly: boolean;
  setHistoryAiOnly: (value: import('react').SetStateAction<boolean>) => void;
  setAiHistorySelection: (
    value: import('react').SetStateAction<HistoryEntry | null>,
  ) => void;
  setHistorySelection: (
    value: import('react').SetStateAction<{
      entry: HistoryEntry;
      path: string;
      version: 'before' | 'after';
      content: string | null;
    } | null>,
  ) => void;
  filteredHistoryEntries: HistoryEntry[];
  documents: CanvasDocument[];
  focusSource: (id: string) => void;
  inspectHistory: (
    entry: HistoryEntry,
    relative: string,
    version: 'before' | 'after',
  ) => Promise<void>;
  restoring: boolean;
  canRestoreHistory: boolean;
  locked: boolean;
  onBlocked: () => void;
  setHistoryConfirm: (
    value: import('react').SetStateAction<{
      entry: HistoryEntry;
      path?: string;
      version?: 'before' | 'after';
    } | null>,
  ) => void;
  taskDocuments: CanvasDocument[];
  focusResultPath: (path: string) => void;
  reuseAiEntry: (entry: HistoryEntry) => void;
  creatingTask: boolean;
  canWriteAiRequest: boolean;
  collaboration: CollaborationState;
  aiBusy: boolean;
  queueSupported: boolean;
  historyEntries: HistoryEntry[];
  setNotice: import('react').Dispatch<import('react').SetStateAction<string>>;
  historyConfirm: {
    entry: HistoryEntry;
    path?: string;
    version?: 'before' | 'after';
  } | null;
  restoreSelectedHistory: () => Promise<void>;
}
export function WorkspaceHistoryPanels({
  historyOpen,
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
}: Props) {
  return (
    <>
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
                    {entry.modelId ? ` · ${entry.modelId}` : ''}
                    {entry.reasoningEffort
                      ? ` · ${reasoningLabel(entry.reasoningEffort)}`
                      : ''}
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
                        {file.after ? (file.before ? '수정' : '생성') : '삭제'}{' '}
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
                  record={entryTaskRecord(aiHistorySelection, taskDocuments)}
                  statusLabel={CODEX_STATUS_LABELS[aiHistorySelection.status]}
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
      {historyConfirm && (
        <div data-ui-id="history-confirm" className="dialog-backdrop">
          <section
            className="section-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-dialog-title"
          >
            <h2 id="restore-dialog-title">이 버전을 복원할까요?</h2>
            <p>
              {historyConfirm.path ?? historyConfirm.entry.label}의 저장 버전을
              복원합니다. 현재 내용은 새 기록으로 보관되며, 삭제 기록은 삭제 전
              상태로 복원됩니다.
            </p>
            <div className="section-dialog__actions">
              <button
                type="button"
                disabled={restoring}
                onClick={() => setHistoryConfirm(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={restoring}
                onClick={() => void restoreSelectedHistory()}
              >
                {restoring ? '복원 중' : '복원'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
