import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<SelfHostState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [localProjects, setLocalProjects] = useState<ProjectEntry[]>([]);
  const [localId, setLocalId] = useState('');
  const [hostedId, setHostedId] = useState('');
  const [confirmation, setConfirmation] = useState<'stop' | 'restart' | null>(
    null,
  );
  const api = window.gameCanvas.selfHost;
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
    void window.gameCanvas
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
      setPrompt('');
      if (next.stage === 'problem') setError(next.message);
      await window.gameCanvas.listProjects();
    });
  const alive =
    state?.checks?.serverOwnership === 'owned' ||
    state?.checks?.tunnelOwnership === 'owned';
  const selectedProject = state?.projects.find((item) => item.id === hostedId);
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
            {state ? labels[state.stage] : '상태 확인 중'}
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
          <ul className="self-host-checks">
            <li>
              서버 실행 도구: {state.checks.serverFile ? '준비됨' : '확인 필요'}
            </li>
            <li>
              로컬 서버: {state.checks.localHealthy ? '응답 정상' : '응답 없음'}
            </li>
            <li>
              인터넷 연결:{' '}
              {state.checks.publicHealthy ? '응답 정상' : '확인 필요'}
            </li>
          </ul>
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
          <HelpCircle size={17} /> 연결 후 서버 관리 · 유지 방법
        </summary>
        {HOST_HELP.map(([title, body]) => (
          <details key={title}>
            <summary>{title}</summary>
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
        <summary>설정이 막혔나요? AI에게 도움받기</summary>
        <p>
          아래 요청문을 Codex 등 PC 작업이 가능한 AI에 붙여넣으세요. 터미널에서
          실행하는 명령어가 아닙니다. 현재 상태와 오류 코드가 포함되며
          키·토큰·문서는 포함하지 않습니다.
        </p>
        <button
          disabled={busy || !api}
          onClick={() =>
            void action(async () => {
              const value = await api!.getSelfHostPrompt();
              setPrompt(value);
              await navigator.clipboard.writeText(value);
              setMessage(
                'AI 요청문을 복사했습니다. PC 작업이 가능한 AI에 붙여넣으세요.',
              );
            })
          }
        >
          <Copy size={15} /> AI 요청문 복사
        </button>
        {prompt && (
          <>
            <pre>{prompt}</pre>
            <button
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(prompt);
                  setMessage('AI 요청문을 복사했습니다.');
                })
              }
            >
              <Copy size={15} /> AI 요청문 복사
            </button>
          </>
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
