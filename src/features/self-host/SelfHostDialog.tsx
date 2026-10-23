import { useRuntime } from '../../ui/runtime/RuntimeProvider';
import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  FolderOpen,
  HelpCircle,
  LoaderCircle,
  Server,
  X,
} from 'lucide-react';
import type { ProjectEntry } from '../../shared';
import type { SelfHostState } from './types';
import { HOST_HELP } from './help';
import './self-host.css';

const labels: Record<SelfHostState['stage'], string> = {
  off: '꺼짐',
  preparing: '준비 중',
  starting: '시작 중',
  checking: '연결 확인 중',
  ready: '정상 연결',
  problem: '연결 문제',
  stopping: '종료 중',
};
export function SelfHostDialog({
  close,
  share,
}: {
  close: () => void;
  share: (id: string) => Promise<void>;
}) {
  const { api: runtimeApi } = useRuntime();

  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<SelfHostState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const [copyError, setCopyError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [localProjects, setLocalProjects] = useState<ProjectEntry[]>([]);
  const [localId, setLocalId] = useState('');
  const [hostedId, setHostedId] = useState('');
  const [confirmation, setConfirmation] = useState<'stop' | 'restart' | null>(
    null,
  );
  const api = runtimeApi.desktop?.selfHost;
  const busy =
    working ||
    (!!state &&
      ['preparing', 'starting', 'checking', 'stopping'].includes(state.stage));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    let disposed = false;
    if (!api) {
      setError('이 배포판에서는 PC 서버를 지원하지 않습니다.');
      return;
    }
    const refresh = () =>
      api
        .getSelfHost()
        .then((next) => {
          if (!disposed) setState(next);
        })
        .catch(() => {
          if (!disposed)
            setError('서버 상태를 확인하지 못했습니다. 다시 확인해주세요.');
        });
    void refresh();
    void runtimeApi.projects
      .listProjects()
      .then((projects) => {
        if (!disposed)
          setLocalProjects(projects.filter((item) => item.kind === 'local'));
      })
      .catch(() => {
        if (!disposed) setError('프로젝트 목록을 불러오지 못했습니다.');
      });
    const unsubscribe = api.onSelfHostChanged((next) => {
      if (!disposed) setState(next);
    });
    const timer = setInterval(() => {
      if (!disposed) void refresh();
    }, 15_000);
    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, [api]);
  useEffect(() => {
    if (!state?.projects.some((item) => item.id === hostedId))
      setHostedId(state?.projects[0]?.id ?? '');
  }, [state?.projects, hostedId]);
  const action = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setWorking(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(
              /^Error invoking remote method '[^']+': /,
              '',
            )
          : '작업을 완료하지 못했습니다.',
      );
    } finally {
      setWorking(false);
    }
  };
  const run = (operation: 'prepare' | 'start' | 'check' | 'stop' | 'restart') =>
    action(async () => {
      if (!api) return;
      const next = await api.runSelfHost(operation);
      setState(next);
      if (next.stage === 'problem') setError(next.message);
      await runtimeApi.projects.listProjects();
    });
  const alive =
    state?.checks?.serverOwnership === 'owned' ||
    state?.checks?.tunnelOwnership === 'owned';
  const selectedProject = state?.projects.find((item) => item.id === hostedId);
  const copyPrompt = async () => {
    const copyText = runtimeApi.desktop?.copyText;
    if (!api || !copyText || copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    setCopyError('');
    setCopyMessage('');
    try {
      const value = await api.getSelfHostPrompt();
      setPrompt(value);
      await copyText(value);
      setCopyMessage(
        'AI 요청문을 복사했습니다. PC 작업이 가능한 AI에 붙여넣으세요.',
      );
    } catch {
      setCopyError(
        '요청문을 자동으로 복사하지 못했습니다. 아래 요청문을 선택해 Ctrl+C로 복사해주세요.',
      );
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="self-host-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="self-host-title"
    >
      <header className="self-host-heading">
        <Server size={22} />
        <div>
          <p>이 PC에서 팀 협업하기</p>
          <h2 id="self-host-title">협업 서버 설정 · 관리</h2>
        </div>
        <button aria-label="서버 관리 닫기" disabled={busy} onClick={close}>
          <X size={18} />
        </button>
      </header>
      <p className="self-host-intro">
        연결 도구가 이 PC의 협업 서버에 인터넷 주소를 만들어 줍니다. Cloudflare
        가입이나 도메인 구매 없이 인터넷 협업을 시작합니다. 함께 작업하는 동안
        이 PC와 서버를 켜두세요.
      </p>
      <ol className="self-host-steps" aria-label="설정 단계">
        {['안내 확인', '연결 준비', '서버 실행', '공유 · 관리'].map(
          (label, index) => {
            const complete =
              index === 0 ||
              (index === 1 &&
                !!state?.checks?.serverFile &&
                state.checks.nodeReady !== false &&
                state.checks.cloudflaredReady !== false) ||
              (index >= 2 && state?.stage === 'ready');
            return (
              <li key={label} data-complete={complete}>
                {complete ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                <span>
                  {index + 1}. {label}
                </span>
              </li>
            );
          },
        )}
      </ol>
      <section
        className="self-host-status"
        data-stage={state?.stage}
        aria-live="polite"
        aria-busy={busy}
      >
        <div>
          <strong>
            {busy && <LoaderCircle size={17} className="self-host-spinner" />}
            {state?.stage === 'problem' && state.diagnosticFailure
              ? '상태 확인 실패'
              : state
                ? labels[state.stage]
                : '상태 확인 중'}
          </strong>
          {state?.checkedAt && (
            <small>
              마지막 확인 {new Date(state.checkedAt).toLocaleTimeString()}
            </small>
          )}
        </div>
        <p>
          {state?.message ?? '서버 실행 도구와 기존 연결 상태를 확인합니다.'}
        </p>
        {state?.code && <small>오류 코드: {state.code}</small>}
        {state?.stage === 'ready' && (
          <label>
            현재 인터넷 주소
            <input
              readOnly
              value={state.publicUrl}
              aria-label="현재 인터넷 서버 주소"
            />
          </label>
        )}
        {state?.checks && (
          <>
            {(busy || state.diagnosticFailure) && (
              <small>
                아래 항목은 마지막으로 완료한 검사 결과입니다. 현재 상태는 다시
                확인이 필요합니다.
              </small>
            )}
            <ul className="self-host-checks">
              <li>
                서버 실행 도구:{' '}
                {state.checks.serverFile ? '준비됨' : '확인 필요'}
              </li>
              <li>
                로컬 서버:{' '}
                {state.checks.localHealthy ? '응답 정상' : '응답 없음'}
              </li>
              <li>
                인터넷 연결:{' '}
                {state.checks.publicHealthy ? '응답 정상' : '확인 필요'}
              </li>
              {state.checks.serverVersion && (
                <li>실행 중인 서버: {state.checks.serverVersion}</li>
              )}
              {state.checks.multiplayerVersion != null && (
                <li>
                  함께 플레이:{' '}
                  {state.checks.multiplayerVersion === 1
                    ? '사용 가능'
                    : '서버 업데이트 필요'}
                  {state.checks.multiplayerVersion === 1 &&
                  state.checks.multiplayerLobbyVersion !== 1
                    ? ' · 방 자동 알림은 서버 업데이트가 필요해요.'
                    : ''}
                </li>
              )}
            </ul>
          </>
        )}
      </section>
      <div className="self-host-actions">
        <button
          disabled={
            busy ||
            !api ||
            !state?.supported ||
            !!alive ||
            state.checks?.cloudflaredReady === true
          }
          onClick={() => void run('prepare')}
        >
          연결 도구 준비
        </button>
        <button
          className="button-primary"
          disabled={
            busy ||
            !api ||
            !state?.supported ||
            !!alive ||
            !state.checks?.serverFile ||
            state.checks?.nodeReady !== true ||
            state.checks?.cloudflaredReady !== true
          }
          onClick={() => void run('start')}
        >
          서버 켜기
        </button>
        <button disabled={busy || !api} onClick={() => void run('check')}>
          다시 확인
        </button>
        <button
          disabled={busy || !alive}
          onClick={() => setConfirmation('stop')}
        >
          서버 끄기
        </button>
        <button
          disabled={busy || !alive}
          onClick={() => setConfirmation('restart')}
        >
          서버 재시작
        </button>
      </div>
      {confirmation && (
        <section className="self-host-confirm" role="alert">
          <strong>
            {confirmation === 'stop'
              ? '서버를 종료할까요?'
              : '서버와 연결을 다시 시작할까요?'}
          </strong>
          <p>
            참가자의 저장과 AI 작업 완료를 확인하세요. 모든 참가자의 연결이
            끊깁니다.
            {confirmation === 'restart' &&
              ' 인터넷 주소가 바뀔 수 있습니다.'}{' '}
            저장한 프로젝트는 보존됩니다.
          </p>
          <div className="self-host-actions">
            <button
              disabled={busy}
              onClick={() => {
                const operation = confirmation;
                setConfirmation(null);
                void run(operation);
              }}
            >
              확인 후 {confirmation === 'stop' ? '종료' : '재시작'}
            </button>
            <button disabled={busy} onClick={() => setConfirmation(null)}>
              취소
            </button>
          </div>
        </section>
      )}
      {state?.stage === 'ready' && (
        <section className="self-host-share">
          <h3>프로젝트 공유와 재연결</h3>
          <label>
            공유할 로컬 프로젝트
            <select
              value={localId}
              onChange={(event) => setLocalId(event.target.value)}
            >
              <option value="">프로젝트 선택</option>
              {localProjects.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !localId}
            onClick={() =>
              void action(async () => {
                await share(localId);
                close();
              })
            }
          >
            프로젝트 공유
          </button>
          {!localProjects.length && (
            <p>홈에서 새 로컬 프로젝트를 만든 뒤 공유하세요.</p>
          )}
          {!!state.projects.length && (
            <>
              <label>
                이 PC 서버의 공동 프로젝트
                <select
                  value={hostedId}
                  onChange={(event) => setHostedId(event.target.value)}
                >
                  {state.projects.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="self-host-actions">
                <button
                  disabled={busy || !hostedId}
                  onClick={() =>
                    void action(async () => {
                      await api!.copySelfHostInfo(hostedId, 'connection');
                      setMessage(
                        '기존 참가자에게 전달할 연결 정보를 복사했습니다.',
                      );
                    })
                  }
                >
                  <Copy size={15} /> 연결 정보 복사
                </button>
                <button
                  disabled={busy || !selectedProject?.inviteAvailable}
                  onClick={() =>
                    void action(async () => {
                      await api!.copySelfHostInfo(hostedId, 'invite');
                      setMessage(
                        '신규 참가자용 초대 정보를 복사했습니다. 코드가 만료되면 프로젝트에서 새로 발급하세요.',
                      );
                    })
                  }
                >
                  초대 정보 복사
                </button>
              </div>
              <small>
                기존 참가자는 홈에서 연결 정보를 붙여넣고 같은 프로젝트를
                엽니다. 신규 참가자는 초대 코드로 참여합니다.
              </small>
            </>
          )}
        </section>
      )}
      <label className="self-host-auto-start-setting">
        <input
          type="checkbox"
          checked={state?.autoStart ?? false}
          disabled={busy || !state?.supported}
          onChange={(event) => {
            const value = event.target.checked;
            void action(async () =>
              setState(await api!.setSelfHostAutoStart(value)),
            );
          }}
        />
        프로그램 시작 시 서버 자동 켜기
        <span>{state?.autoStart ? 'On' : 'Off'}</span>
      </label>
      <small>
        On으로 저장하면 다음 프로그램 시작 시 서버를 켜고 이 관리 화면을 엽니다.
        Off로 바꿔도 실행 중인 서버는 유지됩니다.
      </small>
      <label className="self-host-close-setting">
        창을 닫을 때
        <select
          disabled={busy || !api || !state}
          value={state?.closeBehavior ?? 'ask'}
          onChange={(event) =>
            void action(async () => {
              setState(
                await api!.setSelfHostCloseBehavior(
                  event.target.value as SelfHostState['closeBehavior'],
                ),
              );
            })
          }
        >
          <option value="ask">매번 선택하기</option>
          <option value="background">
            서버 계속 실행 · 숨겨진 아이콘으로 관리
          </option>
          <option value="stop">서버 종료 · 작업 완료 확인</option>
        </select>
      </label>
      <details className="self-host-help">
        <summary>
          <ChevronRight
            size={16}
            className="self-host-disclosure"
            aria-hidden="true"
          />
          <HelpCircle size={17} /> 연결 후 서버 관리 · 유지 방법
        </summary>
        {HOST_HELP.map(([title, body]) => (
          <details key={title}>
            <summary>
              <ChevronRight
                size={15}
                className="self-host-disclosure"
                aria-hidden="true"
              />
              {title}
            </summary>
            <p>{body}</p>
          </details>
        ))}
        <button
          disabled={busy || !api}
          onClick={() => void action(() => api!.revealSelfHostData())}
        >
          <FolderOpen size={15} /> 서버 데이터 폴더 열기
        </button>
        <small>{state?.dataDirectory}</small>
      </details>
      <details className="self-host-help">
        <summary>
          <ChevronRight
            size={16}
            className="self-host-disclosure"
            aria-hidden="true"
          />
          설정이 막혔나요? AI에게 도움받기
        </summary>
        <p>
          아래 요청문을 Codex 등 PC 작업이 가능한 AI에 붙여넣으세요. 터미널에서
          실행하는 명령어가 아닙니다. 현재 상태와 오류 코드가 포함되며
          키·토큰·문서는 포함하지 않습니다.
        </p>
        <button
          disabled={copying || !api || !runtimeApi.desktop?.copyText}
          onClick={() => void copyPrompt()}
        >
          {copying ? (
            <LoaderCircle size={15} className="self-host-spinner" />
          ) : (
            <Copy size={15} />
          )}{' '}
          AI 요청문 복사
        </button>
        {prompt && (
          <>
            <label>
              AI 도움 요청문
              <textarea readOnly value={prompt} aria-label="AI 도움 요청문" />
            </label>
            <small>직접 복사하려면 요청문을 선택한 뒤 Ctrl+C를 누르세요.</small>
          </>
        )}
        {copyError && (
          <p className="home-error" role="alert">
            {copyError}
          </p>
        )}
        {copyMessage && (
          <p className="self-host-message" role="status">
            {copyMessage}
          </p>
        )}
      </details>
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="self-host-message" role="status">
          {message}
        </p>
      )}
    </dialog>
  );
}
