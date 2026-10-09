import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { GameCanvasApi } from '../shared';
import './connection-info.css';
export function ConnectionInfoDialog({
  close,
  changed,
}: {
  close: () => void;
  changed: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Awaited<
    ReturnType<GameCanvasApi['inspectConnectionInfo']>
  > | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(
              /^Error invoking remote method '[^']+': /,
              '',
            )
          : '연결 정보를 적용하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="connection-info-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="connection-info-title"
    >
      <header className="connection-info-heading">
        <h2 id="connection-info-title">연결 정보 붙여넣기</h2>
        <button aria-label="연결 정보 닫기" disabled={busy} onClick={close}>
          <X size={18} />
        </button>
      </header>
      <p>
        기존 프로젝트의 주소가 바뀌었을 때 사용합니다. 호스트가 복사해준 연결
        정보 전체를 붙여넣으세요. 내 역할·참여 세션·미반영 작업은 유지됩니다.
      </p>
      <label>
        호스트가 전달한 연결 정보
        <textarea
          autoFocus
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
            setTrusted(false);
          }}
          placeholder={'{ "format": "gamejam-connection", ... }'}
        />
      </label>
      <button
        disabled={busy || !text.trim()}
        onClick={() =>
          void action(async () => {
            setPreview(await window.gameCanvas.inspectConnectionInfo(text));
            setTrusted(false);
          })
        }
      >
        변경 내용 확인
      </button>
      {preview && (
        <>
          <dl className="connection-info-preview">
            <dt>프로젝트</dt>
            <dd>{preview.name}</dd>
            <dt>기존 서버</dt>
            <dd>{preview.previousUrl}</dd>
            <dt>새 서버</dt>
            <dd>{preview.serverUrl}</dd>
          </dl>
          <label className="connection-trust">
            <input
              type="checkbox"
              checked={trusted}
              disabled={busy}
              onChange={(event) => setTrusted(event.target.checked)}
            />
            <span>
              이 프로젝트의 호스트에게 받은 정보이며 새 서버 주소를 신뢰합니다.
              다음에 프로젝트를 열면 이 주소로 참여 인증이 전송됩니다.
            </span>
          </label>
          <button
            className="button-primary"
            disabled={busy || !trusted}
            onClick={() =>
              void action(async () => {
                await window.gameCanvas.applyConnectionInfo(text);
                await changed();
                close();
              })
            }
          >
            기존 프로젝트 연결 갱신
          </button>
        </>
      )}
      <details className="connection-info-help">
        <summary>다음에 어떻게 접속하나요?</summary>
        <p>
          갱신 후 홈에서 같은 공동 프로젝트 카드를 여세요. 주소 변경만으로
          탈퇴하거나 관리자 복구를 할 필요는 없습니다. 호스트의 PC·서버가 꺼져
          있거나 절전 상태라면 접속할 수 없습니다. 계속 실패하면 호스트에게 상태
          확인을 요청하세요. 참여 세션이 만료된 경우에는 새 초대 또는 관리자
          복구가 필요합니다.
        </p>
      </details>
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
