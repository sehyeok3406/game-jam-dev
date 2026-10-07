import { useEffect, useRef, useState } from 'react';
import { Copy, Globe2, LockKeyhole, X } from 'lucide-react';
import type { GameCanvasApi, ProjectEntry } from '../shared';
export function WebViewerDialog({
  projects,
  close,
}: {
  projects: ProjectEntry[];
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Awaited<
    ReturnType<GameCanvasApi['getWebViewer']>
  > | null>(null);
  const [selected, setSelected] = useState<string[]>(
    projects.map((project) => project.id),
  );
  const [liveLocal, setLiveLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    void window.gameCanvas
      .getWebViewer()
      .then((value) => {
        setSettings(value);
        setLiveLocal(value.liveLocal);
      })
      .catch(() => setError('웹 뷰어 연결 설정을 불러오지 못했습니다.'));
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="web-viewer-dialog"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
      onClose={close}
    >
      <div className="web-viewer-dialog-heading">
        <Globe2 size={22} />
        <h2>웹 뷰어</h2>
        <button aria-label="닫기" disabled={busy} onClick={close}>
          <X size={20} />
        </button>
      </div>
      <p>모바일이나 다른 PC에서 프로젝트를 선택해 읽을 수 있습니다.</p>
      {settings?.configured ? (
        <>
          <label className="web-code-label">
            <LockKeyhole size={14} /> 보기 전용 연결 코드
          </label>
          <div className="web-code-row">
            <input
              type="password"
              value={settings.accessCode}
              readOnly
              aria-label="연결 코드"
            />
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(settings.accessCode)
                  .then(() => setMessage('연결 코드를 복사했습니다.'))
                  .catch(() => setError('코드를 복사하지 못했습니다.'))
              }
            >
              <Copy size={16} /> 복사
            </button>
          </div>
          <small>
            연결 코드를 가진 사람은 게시된 모든 프로젝트를 볼 수 있습니다.
          </small>
          <div className="web-publish-projects">
            {projects.map((project) => (
              <label key={project.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(project.id)}
                  disabled={busy}
                  onChange={(event) =>
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, project.id]
                        : ids.filter((id) => id !== project.id),
                    )
                  }
                />
                <span>
                  {project.name}
                  <small>
                    {project.kind === 'shared'
                      ? '공동 프로젝트'
                      : '로컬 프로젝트'}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <label className="web-live-option">
            <input
              type="checkbox"
              checked={liveLocal}
              disabled={busy}
              onChange={(event) => setLiveLocal(event.target.checked)}
            />{' '}
            로컬 프로젝트도 자동 갱신
          </label>
          <small>
            공동 프로젝트와 자동 갱신은 이 PC의 연결 프로그램이 실행 중일 때 약
            15초 간격으로 확인합니다. PC를 끄면 마지막 게시본이 표시됩니다.
            체크한 항목을 추가·갱신하며, 기존 게시본은 유지됩니다.
          </small>
          <div className="web-viewer-dialog-actions">
            <button
              disabled={busy || !selected.length}
              className="button-primary"
              onClick={async () => {
                setBusy(true);
                setError('');
                setMessage('');
                try {
                  const result = await window.gameCanvas.publishWebViewer({
                    projects: selected,
                    liveLocal,
                  });
                  setMessage(`${result.published}개 프로젝트를 게시했습니다.`);
                  setError(result.errors.join('\n'));
                  setSettings(await window.gameCanvas.getWebViewer());
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : '게시하지 못했습니다.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '게시 중…' : '선택한 프로젝트 게시'}
            </button>
            <button onClick={() => void window.gameCanvas.openWebViewer()}>
              웹 뷰어 열기
            </button>
          </div>
        </>
      ) : (
        settings && <p>이 PC의 웹 뷰어 연결 프로그램을 먼저 설정해주세요.</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
