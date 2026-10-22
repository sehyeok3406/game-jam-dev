import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock3, X } from 'lucide-react';
import { isQueuePending, type AiQueueTask } from '../ai-task-queue';
import { aiProvider, reasoningLabel } from '../core/ai/catalog.ts';

const labels = {
  queued: '예약됨',
  starting: '준비 중',
  running: '작업 중',
  validating: '검증 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
};
export function AiQueuePanel({
  tasks,
  canCancel,
  cancel,
  open,
}: {
  tasks: AiQueueTask[];
  canCancel: boolean;
  cancel: (task: AiQueueTask) => Promise<void>;
  open: (task: AiQueueTask) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!tasks.length) return null;
  const pending = tasks.filter(isQueuePending);
  const running = pending.filter((t) => t.status !== 'queued').length;
  const queued = pending.length - running;
  const visible = [
    ...pending,
    ...tasks
      .filter((t) => !isQueuePending(t))
      .slice(-3)
      .reverse(),
  ];
  return (
    <aside
      className="ai-queue-panel floating-surface"
      aria-label="AI 작업 예약 목록"
    >
      <button
        className="ai-queue-panel__heading"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <Clock3 size={15} />
        <strong>AI 작업</strong>
        <span>
          실행 {running} · 예약 {queued}
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded && (
        <>
          <p className="ai-queue-panel__hint">
            등록한 순서대로 하나씩 실행합니다.
          </p>
          <ol>
            {visible.map((task) => (
              <li key={task.taskId} data-status={task.status}>
                <button
                  className="ai-queue-panel__task"
                  title={task.message}
                  onClick={() => open(task)}
                >
                  <strong>{task.title}</strong>
                  <small>
                    {aiProvider(task.providerId).label} ·{' '}
                    {task.modelId || '자동 선택'} ·{' '}
                    {reasoningLabel(task.reasoningEffort)}
                  </small>
                  <small>
                    {labels[task.status]}
                    {task.status === 'queued'
                      ? ` · ${tasks.filter((t) => t.status === 'queued').indexOf(task) + 1}번째`
                      : ''}
                  </small>
                  {task.message && <small>{task.message}</small>}
                </button>
                {canCancel && isQueuePending(task) && (
                  <button
                    className="icon-button"
                    disabled={busy !== null}
                    aria-label={`${task.title} ${task.status === 'queued' ? '예약 취소' : '작업 중지'}`}
                    title={task.status === 'queued' ? '예약 취소' : '작업 중지'}
                    onClick={async () => {
                      setBusy(task.taskId);
                      setError('');
                      try {
                        await cancel(task);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </aside>
  );
}
