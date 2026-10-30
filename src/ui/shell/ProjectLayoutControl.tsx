import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen } from 'lucide-react';
import type { AppApi } from '../../contracts/app-api.ts';
import type { ProjectLayoutStatus } from '../../contracts/project-layout.ts';
import { requireDesktopApi } from '../runtime/desktop-api.ts';

export function ProjectLayoutControl({
  api,
  disabled,
  prepare,
  refresh,
}: {
  api: AppApi;
  disabled: boolean;
  prepare?: () => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState<ProjectLayoutStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(
    () => () => {
      ++request.current;
    },
    [],
  );
  const inspect = async () => {
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      const result = await requireDesktopApi(api).getProjectLayout();
      if (id === request.current) setStatus(result);
    } catch (error) {
      if (id === request.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  const upgrade = async () => {
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      await prepare!();
      if (!status?.session) throw Error('프로젝트 상태를 다시 확인해주세요.');
      const result = await requireDesktopApi(api).upgradeProjectLayout(
        status.session,
      );
      if (id !== request.current) return;
      setStatus(result);
      await refresh();
    } catch (error) {
      if (id === request.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  return (
    <>
      <button
        disabled={disabled || busy || !api.desktop || !prepare}
        onClick={() => void inspect()}
      >
        <FolderOpen size={16} /> 프로젝트 파일 구조 정리…
      </button>
      {error && !status && <p role="alert">{error}</p>}
      {status &&
        createPortal(
          <div className="dialog-backdrop">
            <section
              role="dialog"
              aria-modal="true"
              aria-label="프로젝트 파일 구조 정리"
              className="import-dialog floating-surface"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) {
                  event.stopPropagation();
                  ++request.current;
                  setStatus(null);
                }
                if (event.key === 'Tab') {
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      'button:not(:disabled)',
                    ),
                  ];
                  const first = buttons[0],
                    last = buttons.at(-1);
                  if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                  } else if (
                    !event.shiftKey &&
                    document.activeElement === last
                  ) {
                    event.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <h2>프로젝트 파일 구조 정리</h2>
              {status.version === 2 ? (
                <p>이미 새 파일 구조를 사용하고 있습니다.</p>
              ) : (
                <>
                  <p>
                    문서를 docs 폴더에 모으고 앱 관리 데이터를 별도 폴더로
                    정리합니다. 기존 문서와 연결 정보는 보존합니다.
                  </p>
                  <p>
                    공동 프로젝트는 팀 전체의 저장 구조가 바뀝니다. 정리 후에는
                    다른 사용자도 업데이트한 앱을 사용해야 합니다.
                  </p>
                  {status.reason && <p>{status.reason}</p>}
                </>
              )}
              {error && <p role="alert">{error}</p>}
              <div className="import-dialog-actions">
                <button
                  autoFocus
                  disabled={busy}
                  onClick={() => {
                    ++request.current;
                    setStatus(null);
                  }}
                >
                  닫기
                </button>
                {status.version === 1 && (
                  <button
                    className="button-primary"
                    disabled={disabled || busy || !status.canUpgrade}
                    onClick={() => void upgrade()}
                  >
                    {busy ? '정리 중…' : '파일 구조 정리'}
                  </button>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
