import { useEffect, useRef, useState } from 'react';
import {
  validateStatuses,
  workflowId,
  type DocumentStatuses,
  type StatusesInput,
} from '../document-statuses';
export function DocumentStatusManager({
  value,
  raw,
  documents,
  save,
  close,
}: {
  value: DocumentStatuses;
  raw: string | null;
  documents: { workflowStatusId?: string }[];
  save: (input: StatusesInput) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(value));
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previous?.focus();
  }, []);
  const patch = (
    id: string,
    update: Partial<DocumentStatuses['statuses'][number]>,
  ) =>
    setDraft((d) => ({
      ...d,
      statuses: d.statuses.map((s) => (s.id === id ? { ...s, ...update } : s)),
    }));
  const move = (index: number, delta: number) =>
    setDraft((d) => {
      const statuses = [...d.statuses];
      [statuses[index], statuses[index + delta]] = [
        statuses[index + delta],
        statuses[index],
      ];
      return { ...d, statuses };
    });
  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      await save({
        expected: raw,
        value: validateStatuses(draft),
        replacements,
      });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="workflow-modal-backdrop"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="workflow-manager floating-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-manager-title"
        ref={dialog}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !busy) close();
          if (e.key === 'Tab') {
            const items = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
              ) ?? []),
            ];
            const first = items[0],
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
        <h2 id="workflow-manager-title">문서 상태 관리</h2>
        <p>
          프로젝트의 모든 캔버스에 적용됩니다. 상태 색과 열 배경을 따로 지정할
          수 있습니다.
        </p>
        <fieldset disabled={busy}>
          {draft.statuses.map((s, index) => (
            <div className="workflow-status-row" key={s.id}>
              <label>
                이름
                <input
                  aria-label={`상태 ${index + 1} 이름`}
                  value={s.name}
                  maxLength={40}
                  onChange={(e) => patch(s.id, { name: e.target.value })}
                />
              </label>
              <label>
                상태 색
                <div className="workflow-color-input">
                  <input
                    type="color"
                    aria-label={`${s.name} 색 선택`}
                    value={s.badgeColor}
                    onChange={(e) =>
                      patch(s.id, { badgeColor: e.target.value })
                    }
                  />
                  <input
                    aria-label={`${s.name} HEX 색`}
                    value={s.badgeColor}
                    onChange={(e) =>
                      patch(s.id, { badgeColor: e.target.value })
                    }
                    maxLength={7}
                  />
                </div>
              </label>
              <label>
                열 배경
                <select
                  value={s.boardBackground.mode}
                  onChange={(e) =>
                    patch(s.id, {
                      boardBackground:
                        e.target.value === 'custom'
                          ? { mode: 'custom', color: s.badgeColor }
                          : { mode: e.target.value as 'none' | 'status' },
                    })
                  }
                >
                  <option value="status">상태 색 사용</option>
                  <option value="custom">직접 지정</option>
                  <option value="none">배경색 해제</option>
                </select>
              </label>
              {s.boardBackground.mode === 'custom' && (
                <label>
                  배경 색
                  <div className="workflow-color-input">
                    <input
                      type="color"
                      value={s.boardBackground.color}
                      onChange={(e) =>
                        patch(s.id, {
                          boardBackground: {
                            mode: 'custom',
                            color: e.target.value,
                          },
                        })
                      }
                    />
                    <input
                      aria-label={`${s.name} 배경 HEX 색`}
                      value={s.boardBackground.color}
                      maxLength={7}
                      onChange={(e) =>
                        patch(s.id, {
                          boardBackground: {
                            mode: 'custom',
                            color: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </label>
              )}
              <label className="workflow-default">
                <input
                  type="radio"
                  name="workflow-default"
                  checked={draft.defaultStatusId === s.id}
                  onChange={() =>
                    setDraft((d) => ({ ...d, defaultStatusId: s.id }))
                  }
                />
                새 문서 기본값
              </label>
              <span>
                {documents.filter((d) => workflowId(d) === s.id).length}개 문서
              </span>
              <div className="workflow-row-actions">
                <button
                  type="button"
                  aria-label={`${s.name} 앞으로 이동`}
                  disabled={!index}
                  onClick={() => move(index, -1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label={`${s.name} 뒤로 이동`}
                  disabled={index === draft.statuses.length - 1}
                  onClick={() => move(index, 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  disabled={draft.statuses.length === 1}
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      statuses: d.statuses.filter((n) => n.id !== s.id),
                      defaultStatusId:
                        d.defaultStatusId === s.id
                          ? d.statuses.find((n) => n.id !== s.id)!.id
                          : d.defaultStatusId,
                    }));
                    setReplacements((r) => ({ ...r, [s.id]: '' }));
                  }}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
          {Object.keys(replacements).map((id) => (
            <label className="workflow-replacement" key={id}>
              삭제할 {value.statuses.find((s) => s.id === id)?.name ?? id}의
              문서 {documents.filter((d) => workflowId(d) === id).length}개를
              이동할 상태
              <select
                aria-label={`${id} 대체 상태`}
                value={replacements[id]}
                onChange={(e) =>
                  setReplacements((r) => ({ ...r, [id]: e.target.value }))
                }
              >
                <option value="">대체 상태 선택</option>
                {draft.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            disabled={draft.statuses.length >= 50}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                statuses: [
                  ...d.statuses,
                  {
                    id: `status-${crypto.randomUUID()}`,
                    name: `새 상태 ${d.statuses.length + 1}`,
                    badgeColor: '#8B5CF6',
                    boardBackground: { mode: 'status' },
                  },
                ],
              }))
            }
          >
            + 상태 추가
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="workflow-error">
            {error}
          </p>
        )}
        <footer>
          <button disabled={busy} onClick={close}>
            취소
          </button>
          <button disabled={busy} onClick={() => void commit()}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </footer>
      </div>
    </div>
  );
}
