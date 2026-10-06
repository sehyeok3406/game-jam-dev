import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CloudOff, GitMerge, X } from 'lucide-react';
import type { CollaborationState } from '../shared';

export function OfflineStatus({
  state,
  paused,
  flush,
  changed,
}: {
  state: CollaborationState;
  paused: boolean;
  flush: () => Promise<void>;
  changed: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<'local' | 'server' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const conflict = state.conflicts?.[0];
  const seen = useRef('');
  useEffect(() => {
    if (!paused && conflict && seen.current !== conflict.id) {
      seen.current = conflict.id;
      setOpen(true);
      setChoice(null);
      setError('');
    }
    if (!conflict) {
      setOpen(false);
      setChoice(null);
    }
  }, [conflict?.id, paused]);
  useEffect(() => {
    if (!open || paused) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(false);
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled)',
        ) ?? []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      previous?.focus();
    };
  }, [open, busy, paused]);
  if (
    !state.active ||
    (state.connected && !state.pendingChanges && !state.syncMessage)
  )
    return null;
  return (
    <>
      <div className="offline-status floating-surface" role="status">
        {state.connected ? <GitMerge size={16} /> : <CloudOff size={16} />}
        <span>
          {state.accessDenied
            ? '참여 세션 만료 · 내 작업 보관됨'
            : !state.connected
              ? state.offlineSync
                ? `오프라인 · 이 PC에 저장 · 동기화 대기 ${state.pendingChanges ?? 0}개`
                : '연결 끊김 · 편집 일시 중지'
              : state.conflicts?.length
                ? `충돌 ${state.conflicts.length}건 · 선택 필요`
                : `동기화 대기 ${state.pendingChanges ?? 0}개`}
        </span>
        {state.syncMessage && <small>{state.syncMessage}</small>}
        {!!state.conflicts?.length && (
          <button onClick={() => setOpen(true)}>충돌 해결</button>
        )}
      </div>
      {open && conflict && !paused && (
        <div className="modal-backdrop">
          <div
            ref={dialog}
            tabIndex={-1}
            className="modal-card offline-conflict-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="offline-conflict-title"
          >
            <header>
              <div>
                <p className="eyebrow">REVIEW BEFORE SYNC</p>
                <h2 id="offline-conflict-title">
                  <GitMerge size={20} /> 겹친 작업을 선택해주세요
                </h2>
              </div>
              <button
                className="icon-button"
                disabled={busy}
                title="나중에 해결"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              다른 참여자와 같은 내용을 변경했습니다.{' '}
              {conflict.paths.length > 1
                ? '섹션·문서 관계를 유지하기 위해 아래 파일을 함께 선택합니다.'
                : conflict.paths[0]}
            </p>
            <div className="offline-conflict-columns">
              {(['local', 'server'] as const).map((version) => (
                <section
                  key={version}
                  className={choice === version ? 'is-selected' : ''}
                >
                  <button
                    disabled={busy}
                    aria-pressed={choice === version}
                    onClick={() => setChoice(version)}
                  >
                    {version === 'local' ? '내 PC 작업 선택' : '서버 작업 선택'}
                  </button>
                  <div className="offline-conflict-files">
                    {conflict[version].map((file) => (
                      <div key={file.path}>
                        <strong>{file.path}</strong>
                        <pre>
                          {file.content === null
                            ? '이 버전에서는 삭제됨'
                            : file.path.startsWith('assets/')
                              ? '이미지 파일 (미리보기 대신 파일 정보 표시)'
                              : file.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <p className="offline-conflict-warning">
              <AlertTriangle size={16} /> 선택한 버전이 반영되고 다른 버전은
              현재 작업에서 제외됩니다. 선택 전 내용은 이 PC의 복구 기록과 서버
              히스토리에 보관합니다.
            </p>
            {error && (
              <p className="home-error" role="alert">
                {error}
              </p>
            )}
            <div className="home-dialog-actions">
              <button disabled={busy} onClick={() => setOpen(false)}>
                나중에 해결
              </button>
              <button
                className="button-primary"
                disabled={!choice || busy || !state.connected}
                onClick={() => {
                  if (!choice) return;
                  setBusy(true);
                  setError('');
                  void (async () => {
                    await flush();
                    await window.gameCanvas.resolveOfflineConflict(
                      conflict.id,
                      choice,
                    );
                    await changed();
                    setChoice(null);
                  })()
                    .catch((error) =>
                      setError(
                        error instanceof Error ? error.message : String(error),
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? '반영 중…' : '선택한 버전 반영'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
