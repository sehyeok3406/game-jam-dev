import { useEffect, useRef, useState } from 'react';
import {
  Download,
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { UpdateState } from '../shared';

export function UpdatePanel({
  open,
  close,
  show,
}: {
  open: boolean;
  close: () => void;
  show: () => void;
}) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const busyRef = useRef(false);
  useEffect(() => {
    let mounted = true,
      eventReceived = false;
    const unsubscribe = window.gameCanvas.onUpdateChanged((value) => {
      eventReceived = true;
      if (mounted) setState(value);
    });
    void window.gameCanvas
      .getUpdateState()
      .then((value) => {
        if (mounted && !eventReceived) setState(value);
      })
      .catch(() => {
        if (mounted) setError('업데이트 상태를 불러오지 못했습니다.');
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, close]);
  const run = async (operation: () => Promise<UpdateState>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      setState(await operation());
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': /, '')
          : '업데이트 작업에 실패했습니다.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const notification = state && ['ready', 'error'].includes(state.status);
  const notificationId = state
    ? `${state.status}:${state.lastCheckedAt ?? 0}:${state.errorCode ?? ''}`
    : '';
  const inProgress =
    !!state && ['checking', 'downloading', 'installing'].includes(state.status);
  return (
    <>
      {!open && notification && dismissed !== notificationId && (
        <aside
          className="update-notice floating-surface"
          role="status"
          aria-label="앱 업데이트 알림"
        >
          {state.status === 'ready' ? (
            <CheckCircle2 size={18} />
          ) : (
            <AlertCircle size={18} />
          )}
          <span>
            {state.status === 'ready'
              ? '새 업데이트 준비 완료'
              : '업데이트 확인 실패'}
            <small>설정의 ‘앱 업데이트’에서 확인할 수 있습니다.</small>
          </span>
          <button type="button" onClick={show}>
            보기
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="업데이트 알림 닫기"
            onClick={() => setDismissed(notificationId)}
          >
            <X size={16} />
          </button>
        </aside>
      )}
      {open && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            className="update-dialog floating-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <header>
              <h2 id="update-title">
                <Download size={22} />{' '}
                {state && ['downloading', 'ready'].includes(state.status)
                  ? '새 버전이 있습니다'
                  : '앱 업데이트'}
              </h2>
              <button
                type="button"
                className="icon-button"
                aria-label="업데이트 창 닫기"
                onClick={close}
              >
                <X size={18} />
              </button>
            </header>
            <dl>
              <div>
                <dt>현재 버전</dt>
                <dd>{state ? `v${state.currentVersion}` : '확인 중…'}</dd>
              </div>
              <div>
                <dt>배포 저장소</dt>
                <dd>{state?.repository ?? '아직 연결되지 않음'}</dd>
              </div>
            </dl>
            <div
              className={`update-status${state?.errorCode ? ' update-status--warning' : ''}`}
              role="status"
            >
              {inProgress && <RefreshCw size={18} className="spin" />}
              <p>{state?.message ?? '업데이트 상태를 확인하고 있습니다.'}</p>
              {state?.releaseName && (
                <small>새 릴리스: {state.releaseName}</small>
              )}
              {state?.errorCode && <code>{state.errorCode}</code>}
            </div>
            {state?.lastCheckedAt && (
              <small>
                마지막 확인:{' '}
                {new Date(state.lastCheckedAt).toLocaleString('ko-KR')}
              </small>
            )}
            <label className="update-automatic">
              <input
                type="checkbox"
                checked={state?.automatic ?? true}
                disabled={!state || busy || state.status === 'installing'}
                onChange={(event) =>
                  void run(() =>
                    window.gameCanvas.setAutomaticUpdates(event.target.checked),
                  )
                }
              />
              <span>
                6시간마다 자동 확인·다운로드
                <small>
                  앱 시작 시에는 항상 확인합니다. 자동 재시작하지 않습니다.
                </small>
              </span>
            </label>
            <p className="update-help">
              {state?.status === 'unconfigured'
                ? '저장소가 준비되면 배포 주소를 연결한 버전을 한 번 설치해야 합니다. 현재는 외부 업데이트 요청을 보내지 않습니다.'
                : '새 버전은 백그라운드에서 다운로드됩니다. 편집·저장·AI 작업을 마친 뒤 재시작해주세요. 다운로드한 업데이트는 다음 실행 때도 적용될 수 있습니다.'}
            </p>
            <p className="update-help">
              내장 협업 서버에 다른 참여자가 있거나 테스트 사용자 창이 열려
              있으면 업데이트 재시작을 차단합니다. 별도로 실행한 서버와
              Cloudflare 터널은 앱 업데이트 대상이 아닙니다.
            </p>
            {error && (
              <p className="update-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button type="button" onClick={close}>
                나중에
              </button>
              <button
                type="button"
                disabled={
                  !state?.available ||
                  busy ||
                  inProgress ||
                  state.status === 'ready'
                }
                onClick={() =>
                  void run(() => window.gameCanvas.checkForUpdates())
                }
              >
                <RefreshCw size={16} />
                {state?.status === 'error' ? '다시 확인' : '업데이트 확인'}
              </button>
              {state?.status === 'ready' && (
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => window.gameCanvas.installUpdate())
                  }
                >
                  <Download size={16} />
                  업데이트 후 재시작
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
