import { useEffect, useRef, useState } from 'react';
import type { DocumentStatuses } from '../../document-statuses';
import { kanbanBackground, type KanbanView } from './view';
export function KanbanAppearanceManager({
  value,
  statuses,
  save,
  close,
}: {
  value: KanbanView;
  statuses: DocumentStatuses;
  save: (value: KanbanView) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(value));
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector('select')?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="workflow-modal-backdrop"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="workflow-manager kanban-appearance-manager floating-surface"
        role="dialog"
        aria-modal="true"
        aria-label="칸반 열 배경 관리"
        ref={dialog}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) close();
          if (e.key === 'Tab') {
            const items = [
                ...dialog.current!.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
                ),
              ],
              first = items[0],
              last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2>칸반 열 배경 관리</h2>
        <p>
          칸반 보기 설정입니다. 파일의 상태 값과 상태 색은 변경하지 않습니다.
        </p>
        <fieldset disabled={busy}>
          {statuses.statuses.map((s) => {
            const background = kanbanBackground(draft, s);
            const patch = (b: typeof background) =>
              setDraft((d) => ({
                ...d,
                backgrounds: { ...d.backgrounds, [s.id]: b },
              }));
            return (
              <div className="workflow-status-row" key={s.id}>
                <strong>{s.name}</strong>
                <select
                  aria-label={`${s.name} 열 배경`}
                  value={background.mode}
                  onChange={(e) =>
                    patch(
                      e.target.value === 'custom'
                        ? { mode: 'custom', color: s.badgeColor }
                        : { mode: e.target.value as 'none' | 'status' },
                    )
                  }
                >
                  <option value="status">상태 색 사용</option>
                  <option value="custom">직접 지정</option>
                  <option value="none">배경색 해제</option>
                </select>
                {background.mode === 'custom' && (
                  <div className="workflow-color-input">
                    <input
                      type="color"
                      aria-label={`${s.name} 열 배경 색`}
                      value={background.color}
                      onChange={(e) =>
                        patch({ mode: 'custom', color: e.target.value })
                      }
                    />
                    <input
                      aria-label={`${s.name} 열 배경 HEX 색`}
                      maxLength={7}
                      value={background.color}
                      onChange={(e) =>
                        patch({ mode: 'custom', color: e.target.value })
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button disabled={busy} onClick={close}>
            취소
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await save(draft);
                close();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            저장
          </button>
        </footer>
      </div>
    </div>
  );
}
