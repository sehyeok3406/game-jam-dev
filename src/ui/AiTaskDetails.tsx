import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { aiProvider } from '../ai-providers';
import type { AiTaskRecord, HistoryEntry } from '../shared';

export function AiTaskDetails({
  entry,
  record,
  statusLabel,
  onOpenPath,
}: {
  entry: HistoryEntry;
  record?: AiTaskRecord;
  statusLabel: string;
  onOpenPath: (path: string) => void;
}) {
  return (
    <section className="ai-task-details" aria-label="AI 작업 상세 기록">
      <h3>{record?.title ?? entry.label}</h3>
      <dl>
        <dt>실행한 사람</dt>
        <dd>{entry.actorName ?? '로컬 사용자'}</dd>
        <dt>{entry.kind === 'ai' ? '실행 시작 시각' : '요청 생성 시각'}</dt>
        <dd>{new Date(entry.createdAt).toLocaleString('ko-KR')}</dd>
        {entry.finishedAt && (
          <>
            <dt>기록 종료 시각</dt>
            <dd>{new Date(entry.finishedAt).toLocaleString('ko-KR')}</dd>
          </>
        )}
        <dt>상태</dt>
        <dd>{entry.kind === 'ai' ? statusLabel : '요청 저장'}</dd>
        <dt>AI 모델</dt>
        <dd>
          {aiProvider(entry.providerId ?? 'codex-cli').label} ·{' '}
          {entry.modelId ?? '자동 선택 / 기존 기록에 모델 정보 없음'}
        </dd>
        <dt>기록 ID</dt>
        <dd>
          <code>{entry.id}</code>
        </dd>
      </dl>
      {(entry.error || entry.failure) && (
        <p className="history-error">
          {entry.failure?.code ? `[${entry.failure.code}] ` : ''}
          {entry.error ?? entry.failure?.message}
        </p>
      )}
      {!record ? (
        <p>
          이전 작업의 지시서를 찾을 수 없습니다. 실행 상태와 파일 변경 기록은
          계속 확인할 수 있습니다.
        </p>
      ) : (
        <>
          <p className="ai-task-details__notice">
            {record.origin === 'snapshot'
              ? '실행·요청 당시 저장한 기록입니다. 현재 문서를 변경해도 이 지시서는 바뀌지 않습니다.'
              : '기존 기록은 현재 내부 작업 파일 기준으로 표시합니다. 실행 당시 내용과 다를 수 있습니다.'}
          </p>
          <details open>
            <summary>지시사항 · 입력 자료 · 예정 출력</summary>
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                  a: ({ children }) => <span>{children}</span>,
                  img: ({ alt }) => <span>{alt ?? '이미지'}</span>,
                }}
              >
                {record.specification}
              </ReactMarkdown>
            </div>
          </details>
          {!!record.outputs.length && (
            <div className="ai-task-details__outputs">
              <strong>결과로 이동</strong>
              {record.outputs.map((path) => (
                <button key={path} onClick={() => onOpenPath(path)}>
                  {path}
                </button>
              ))}
              <small>
                실패·중지된 작업의 예정 출력은 실제로 생성되지 않았을 수
                있습니다.
              </small>
            </div>
          )}
        </>
      )}
    </section>
  );
}
