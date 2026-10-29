import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useRuntime } from './runtime/RuntimeProvider';
import { requireDesktopApi } from './runtime/desktop-api';
import {
  MAX_PROJECT_NAME,
  projectDirectoryName,
} from '../core/projects/project-name';

export function ProjectCreateDialog({
  initialName = '',
  close,
  opened,
}: {
  initialName?: string;
  close(): void;
  opened(): Promise<void>;
}) {
  const { api, preferences } = useRuntime();
  const [mode, setMode] = useState<'local' | 'shared'>('local');
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const [parent, setParent] = useState('');
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:4317');
  const [serverKey, setServerKey] = useState('');
  const [nickname, setNickname] = useState(
    () => preferences.getItem('game-canvas-nickname') ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  let normalized = '',
    nameError = '';
  try {
    normalized = projectDirectoryName(name);
  } catch (error) {
    nameError = (error as Error).message;
  }
  const valid =
    !nameError &&
    (mode === 'local'
      ? !!parent
      : !!serverUrl.trim() &&
        !!nickname.trim() &&
        nickname.trim().length <= 40);
  useEffect(() => {
    let disposed = false;
    void api.desktop?.selfHost
      ?.getSelfHost()
      .then((host) => {
        if (!disposed && host.stage === 'ready') setServerUrl(host.publicUrl);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [api]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(error),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal-card home-create-dialog project-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-create-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            if (!busy) close();
          }
          if (event.key === 'Tab') {
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'input, button:not(:disabled)',
              ),
            ];
            const first = items[0],
              last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!valid || busy) return;
          void run(async () => {
            const result = await api.projects.createProject({
              requestId: requestId.current,
              mode,
              name: normalized,
              parent: mode === 'local' ? parent : undefined,
              serverUrl,
              serverKey,
              nickname: nickname.trim(),
            });
            if (mode === 'shared')
              preferences.setItem('game-canvas-nickname', nickname.trim());
            if (result.root) {
              await opened();
              close();
            }
          });
        }}
      >
        <h2 id="project-create-title">새 프로젝트</h2>
        <p>작업 방식을 고르고 이름과 저장 위치를 확인한 뒤 완료하세요.</p>
        <div
          className="project-mode-options"
          role="group"
          aria-label="작업 방식"
        >
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'local'}
            onClick={() => setMode('local')}
          >
            로컬
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'shared'}
            onClick={() => setMode('shared')}
          >
            공동
          </button>
        </div>
        <label>
          프로젝트 이름
          <input
            autoFocus
            required
            maxLength={MAX_PROJECT_NAME}
            disabled={busy}
            value={name}
            aria-invalid={touched && !!nameError}
            aria-describedby="project-name-feedback"
            onBlur={() => setTouched(true)}
            onChange={(event) => {
              setName(event.target.value);
              setTouched(true);
            }}
          />
        </label>
        <p
          id="project-name-feedback"
          className={touched && nameError ? 'home-error' : ''}
          role={touched && nameError ? 'alert' : undefined}
        >
          {touched && nameError
            ? nameError
            : '1~100자. 앞뒤 공백은 제거하며, 파일 이름에 쓸 수 없는 문자와 Windows 예약 이름은 사용할 수 없습니다.'}
        </p>
        {mode === 'local' ? (
          <>
            <label>
              저장 위치
              <span className="project-location-row">
                <input
                  readOnly
                  value={parent}
                  placeholder="상위 폴더를 선택하세요"
                  aria-label="저장 위치"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const selected = await api.projects.chooseProjectParent();
                      if (selected) setParent(selected);
                    })
                  }
                >
                  <FolderOpen size={16} /> 폴더 선택
                </button>
              </span>
            </label>
            {parent && normalized && (
              <p className="project-target-path">
                생성될 폴더
                <br />
                <strong>
                  {parent.replace(/[\\/]$/, '')}
                  {parent.includes('\\') ? '\\' : '/'}
                  {normalized}
                </strong>
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              서버에 저장하고 팀원과 함께 편집합니다. 홈에는 프로젝트 하나만
              표시됩니다.
            </p>
            <label>
              서버 주소
              <input
                required
                disabled={busy}
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
              />
            </label>
            <label>
              닉네임
              <input
                required
                maxLength={40}
                disabled={busy}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </label>
            <label>
              서버 생성 키
              <input
                type="password"
                aria-describedby="project-server-key-help"
                disabled={busy}
                value={serverKey}
                onChange={(event) => setServerKey(event.target.value)}
                placeholder="서버 운영자에게 받은 생성 키 입력"
              />
            </label>
            <p id="project-server-key-help">
              한 사람이 서버를 운영하고, 다른 사람들이 그 서버에 각자의 공동
              프로젝트를 만들 때 사용하는 키입니다. 서버 운영자에게 받아
              입력하세요. 이 PC에서 운영하는 서버나 내장 테스트 서버를
              사용한다면 비워두세요. 앱이 자동으로 처리합니다.
            </p>
            {api.desktop && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result =
                      await requireDesktopApi(
                        api,
                      ).startLocalCollaborationServer();
                    setServerUrl(result.serverUrl);
                    setServerKey('');
                  })
                }
              >
                이 PC에서 테스트 서버 시작
              </button>
            )}
            <p>
              내장 테스트 서버는 이 PC에서만 접속하며 앱 종료 시 중지됩니다.
            </p>
          </>
        )}
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
        <div className="home-dialog-actions">
          <button type="button" disabled={busy} onClick={close}>
            취소
          </button>
          <button
            type="submit"
            className="button-primary"
            disabled={busy || !valid}
          >
            {busy ? '처리 중…' : '완료'}
          </button>
        </div>
      </form>
    </div>
  );
}
