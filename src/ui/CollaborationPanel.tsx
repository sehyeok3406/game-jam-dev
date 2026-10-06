import { useEffect, useState } from 'react';
import { Copy, LoaderCircle, Users, X } from 'lucide-react';
import type { CollaborationState, TestUsersState } from '../shared';

export const ROLE_NAMES = { admin: '관리자', editor: '편집자', viewer: '뷰어' };

export function CollaborationPanel({
  state,
  close,
  beforeSwitch,
  changed,
  report,
}: {
  state: CollaborationState;
  close: () => void;
  beforeSwitch: () => Promise<void>;
  changed: () => Promise<void>;
  report: (message: string) => void;
}) {
  const [tab, setTab] = useState<'create' | 'join' | 'recover'>('create');
  const [serverUrl, setServerUrl] = useState(
    state.serverUrl ?? 'http://127.0.0.1:4317',
  );
  const [serverKey, setServerKey] = useState('');
  const [name, setName] = useState(
    () => localStorage.getItem('game-canvas-nickname') ?? '',
  );
  const [code, setCode] = useState('');
  const [projectId, setProjectId] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [testUsers, setTestUsers] = useState<TestUsersState | null>(null);
  const [testCount, setTestCount] = useState(3);
  const [testPrefix, setTestPrefix] = useState('테스트 사용자');
  const [testRole, setTestRole] = useState<'editor' | 'viewer'>('editor');
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await window.gameCanvas.getTestUsers();
        if (!disposed) setTestUsers(next);
      } catch {
        /* Collaboration itself remains usable if the test API is unavailable. */
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [state.projectId]);
  const action = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      await changed();
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
  const connect = () =>
    action(async () => {
      if (tab !== 'recover' && !name.trim())
        throw new Error('닉네임을 입력해주세요.');
      await beforeSwitch();
      localStorage.setItem('game-canvas-nickname', name.trim());
      if (tab === 'create')
        await window.gameCanvas.createCollaboration({
          serverUrl,
          serverKey,
          nickname: name.trim(),
        });
      else if (tab === 'recover')
        await window.gameCanvas.recoverCollaboration({
          serverUrl,
          projectId,
          recoveryKey,
        });
      else
        await window.gameCanvas.joinCollaboration({
          serverUrl,
          code,
          nickname: name.trim(),
        });
      report(
        '공동 프로젝트에 연결했습니다. 서버에 저장되는 변경을 함께 확인할 수 있습니다.',
      );
    });
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <section
        className="collaboration-dialog modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaboration-title"
      >
        <header>
          <div>
            <span className="eyebrow">COLLABORATION</span>
            <h2 id="collaboration-title">
              <Users size={20} /> 함께 작업하기
            </h2>
          </div>
          <button
            className="icon-button"
            title="협업 창 닫기"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {testUsers?.isTestUser && (
          <div className="collaboration-test-banner">
            <strong>
              {testUsers.nickname ?? '테스트 사용자'} · 독립 테스트 창
            </strong>
            <p>
              이 창의 설정과 초안은 관리자 창과 분리됩니다. 다른 사용자의 창처럼
              사용하고, 종료할 때는 이 앱 창을 닫아주세요.
            </p>
          </div>
        )}
        {state.active ? (
          <>
            <div
              className={`collaboration-connection ${state.connected ? '' : 'is-offline'}`}
            >
              <strong>{state.projectName ?? '공동 프로젝트'}</strong>
              <span>
                {state.connected
                  ? '서버 연결됨 · 자동 동기화'
                  : '연결 끊김 · 편집 일시 중지'}
              </span>
              <small>{state.serverUrl}</small>
              <small>
                내 역할: {state.role ? ROLE_NAMES[state.role] : '연결 중'}
              </small>
            </div>
            {state.message && (
              <p className="collaboration-error">{state.message}</p>
            )}
            {state.role === 'admin' && (
              <div className="collaboration-invite">
                <label>초대 코드</label>
                <div>
                  <code>
                    {state.inviteCode ??
                      '다른 관리자가 발급한 코드는 재발급 후 표시됩니다.'}
                  </code>
                  {state.inviteCode && (
                    <button
                      title="초대 정보 복사"
                      onClick={() =>
                        void action(() =>
                          window.gameCanvas.copyText(
                            `Game Canvas 초대\n서버: ${state.serverUrl}\n코드: ${state.inviteCode}`,
                          ),
                        )
                      }
                    >
                      <Copy size={15} />
                    </button>
                  )}
                </div>
                <small>
                  입장 역할: 편집자 ·{' '}
                  {state.inviteExpiresAt
                    ? `${new Date(state.inviteExpiresAt).toLocaleString()}까지 유효`
                    : '24시간 유효'}
                </small>
                <button
                  disabled={busy || !state.connected}
                  onClick={() =>
                    void action(() => window.gameCanvas.rotateInvite())
                  }
                >
                  코드 재발급
                </button>
                <p>
                  코드를 가진 사람이 참여할 수 있습니다. 재발급해도 기존
                  참여자는 유지됩니다.
                </p>
              </div>
            )}
            {state.role === 'admin' && testUsers && !testUsers.isTestUser && (
              <section
                className="collaboration-test-users"
                aria-labelledby="test-users-title"
              >
                <h3 id="test-users-title">내 PC에서 여러 사용자 테스트</h3>
                <p className="collaboration-help">
                  각 사용자마다 독립된 앱을 실행하고 현재 프로젝트에 자동
                  참여합니다. 실제 서버 동기화·문서 잠금·역할·편집 히스토리를
                  확인할 수 있습니다.
                </p>
                {!testUsers.supported ? (
                  <p className="collaboration-help">
                    데스크톱 앱에서 사용할 수 있습니다. 브라우저 미리보기는 실제
                    협업 테스트를 지원하지 않습니다.
                  </p>
                ) : (
                  <>
                    <div className="collaboration-test-fields">
                      <label>
                        인원 수
                        <input
                          aria-label="테스트 사용자 인원 수"
                          type="number"
                          min={1}
                          max={testUsers.maxWindows}
                          value={testCount}
                          onChange={(event) =>
                            setTestCount(Number(event.target.value))
                          }
                        />
                      </label>
                      <label>
                        시작 역할
                        <select
                          aria-label="테스트 사용자 시작 역할"
                          value={testRole}
                          onChange={(event) =>
                            setTestRole(
                              event.target.value as 'editor' | 'viewer',
                            )
                          }
                        >
                          <option value="editor">편집자</option>
                          <option value="viewer">뷰어</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      닉네임 접두어
                      <input
                        aria-label="테스트 사용자 닉네임 접두어"
                        maxLength={24}
                        value={testPrefix}
                        onChange={(event) => setTestPrefix(event.target.value)}
                      />
                    </label>
                    <button
                      className="button-primary"
                      disabled={
                        busy ||
                        !state.connected ||
                        !state.inviteCode ||
                        !Number.isInteger(testCount) ||
                        testCount < 1 ||
                        testCount > testUsers.maxWindows ||
                        !testPrefix.trim()
                      }
                      onClick={() =>
                        void action(async () => {
                          const windows =
                            await window.gameCanvas.launchTestUsers({
                              count: testCount,
                              role: testRole,
                              nicknamePrefix: testPrefix,
                            });
                          setTestUsers((previous) =>
                            previous ? { ...previous, windows } : previous,
                          );
                          const failed = windows.filter(
                            (item) => item.status === 'failed',
                          );
                          if (failed.length)
                            setError(
                              failed
                                .map(
                                  (item) => `${item.nickname}: ${item.message}`,
                                )
                                .join('\n'),
                            );
                          report(
                            `${testCount}명의 테스트 사용자 창을 요청했습니다. 각 창에서 독립적으로 작업할 수 있습니다.`,
                          );
                        })
                      }
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <Users size={15} />
                      )}{' '}
                      테스트 사용자 창 열기
                    </button>
                    <small className="collaboration-help">
                      동시 테스트 창 최대 {testUsers.maxWindows}개 · 프로젝트
                      참여자는 관리자 포함 최대 20명. 여러 앱을 실행하므로 PC
                      메모리 사용량이 늘어납니다. 역할은 아래 참여자 목록에서
                      변경할 수 있습니다.
                    </small>
                    {testUsers.windows.length > 0 && (
                      <ul
                        className="collaboration-test-window-list"
                        aria-label="테스트 창 상태"
                      >
                        {testUsers.windows.map((item) => (
                          <li key={item.id}>
                            <strong>{item.nickname}</strong>
                            <span>
                              {state.members.find(
                                (member) => member.id === item.memberId,
                              )?.role
                                ? ROLE_NAMES[
                                    state.members.find(
                                      (member) => member.id === item.memberId,
                                    )!.role
                                  ]
                                : ROLE_NAMES[item.role]}{' '}
                              ·{' '}
                              {
                                {
                                  starting: '실행 준비 중',
                                  ready: '창 표시 완료',
                                  closed: '창 닫힘',
                                  failed: '실행 실패',
                                }[item.status]
                              }
                            </span>
                            {item.message && (
                              <small className="collaboration-error">
                                {item.message}
                              </small>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="collaboration-help">
                      내장 서버를 사용하는 경우 관리자 앱을 닫으면 동기화가
                      중지됩니다. 테스트 창을 먼저 닫아주세요. 닫힌 테스트
                      사용자를 더 이상 쓰지 않으면 참여자 목록에서 ‘제외’할 수
                      있습니다.
                    </p>
                  </>
                )}
              </section>
            )}
            <h3>참여자</h3>
            <div className="collaboration-members">
              {state.members.map((member) => (
                <div className="collaboration-member" key={member.id}>
                  <span
                    className={`member-dot ${member.online ? 'online' : ''}`}
                  />
                  <div>
                    <strong>
                      {member.nickname}
                      {member.id === state.memberId ? ' (나)' : ''}
                    </strong>
                    <small>
                      {member.owner
                        ? '프로젝트 생성자'
                        : member.online
                          ? '접속 중'
                          : '오프라인'}
                    </small>
                  </div>
                  <select
                    aria-label={`${member.nickname} 역할`}
                    value={member.role}
                    disabled={
                      busy ||
                      !state.connected ||
                      state.role !== 'admin' ||
                      member.owner
                    }
                    onChange={(event) =>
                      void action(() =>
                        window.gameCanvas.setMemberRole(
                          member.id,
                          event.target.value as 'admin' | 'editor' | 'viewer',
                        ),
                      )
                    }
                  >
                    <option value="admin">관리자</option>
                    <option value="editor">편집자</option>
                    <option value="viewer">뷰어</option>
                  </select>
                  {state.role === 'admin' && !member.owner && (
                    <button
                      className="button-danger"
                      disabled={busy || !state.connected}
                      onClick={() => setRemoveId(member.id)}
                    >
                      제외
                    </button>
                  )}
                </div>
              ))}
            </div>
            {removeId && (
              <div className="collaboration-confirm">
                <p>
                  이 참여자의 접근 권한을 회수할까요? 모든 세션의 편집·조회
                  권한이 중지됩니다.
                </p>
                <button disabled={busy} onClick={() => setRemoveId(null)}>
                  취소
                </button>
                <button
                  className="button-danger"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await window.gameCanvas.setMemberRole(
                        removeId,
                        'removed',
                      );
                      setRemoveId(null);
                    })
                  }
                >
                  권한 회수
                </button>
              </div>
            )}
            {state.recoveryKey && (
              <details
                className="collaboration-recovery"
                onToggle={(event) => setShowRecovery(event.currentTarget.open)}
              >
                <summary>관리자 복구 정보 — 초대할 때 공유하지 마세요</summary>
                {showRecovery && (
                  <>
                    <p>
                      앱 세션을 잃었을 때 별도 서버 복구 도구에서 사용합니다.
                      안전한 곳에 보관하세요.
                    </p>
                    <code>{state.projectId}</code>
                    <button
                      onClick={() =>
                        void action(() =>
                          window.gameCanvas.copyText(
                            `프로젝트: ${state.projectId}\n복구 키: ${state.recoveryKey}`,
                          ),
                        )
                      }
                    >
                      프로젝트 ID·복구 키 복사
                    </button>
                  </>
                )}
              </details>
            )}
            <p className="collaboration-help">
              같은 메모는 한 명씩 편집합니다. AI 작업 중에는 모두의 문서 편집이
              잠깁니다. HTML 플레이 상태와 최소화는 각자 유지됩니다.
            </p>
            {leaveConfirm ? (
              <div className="collaboration-confirm">
                <p>
                  공동 프로젝트를 닫고 이전 로컬 프로젝트로 돌아갈까요? 서버
                  문서는 삭제되지 않습니다.
                </p>
                <button disabled={busy} onClick={() => setLeaveConfirm(false)}>
                  취소
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await beforeSwitch();
                      await window.gameCanvas.leaveCollaboration();
                      setLeaveConfirm(false);
                      report('이전 로컬 프로젝트로 돌아왔습니다.');
                    })
                  }
                >
                  로컬로 돌아가기
                </button>
              </div>
            ) : (
              <button disabled={busy} onClick={() => setLeaveConfirm(true)}>
                공동 프로젝트 닫기
              </button>
            )}
          </>
        ) : (
          <>
            <p>
              로그인 없이 코드와 닉네임으로 같은 캔버스에 참여합니다. 공동
              프로젝트는 서버에 저장됩니다.
            </p>
            <div className="collaboration-tabs">
              <button
                aria-pressed={tab === 'create'}
                onClick={() => setTab('create')}
              >
                현재 프로젝트 공유
              </button>
              <button
                aria-pressed={tab === 'join'}
                onClick={() => setTab('join')}
              >
                코드로 참여
              </button>
            </div>
            <label>
              서버 주소
              <input
                aria-label="협업 서버 주소"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="http://192.168.0.10:4317"
              />
            </label>
            <label>
              내 닉네임
              <input
                aria-label="협업 닉네임"
                maxLength={40}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="캔버스와 히스토리에 표시할 이름"
              />
            </label>
            {tab === 'create' ? (
              <>
                <label>
                  서버 생성 키
                  <input
                    aria-label="서버 생성 키"
                    type="password"
                    value={serverKey}
                    onChange={(event) => setServerKey(event.target.value)}
                    placeholder="외부 서버에서 프로젝트 생성 시 필요"
                  />
                </label>
                <p className="collaboration-help">
                  현재 로컬 문서를 서버에 복사합니다. 원본 로컬 폴더는 그대로
                  남으며, 이후 공동 편집은 서버 사본에 저장됩니다.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const result =
                        await window.gameCanvas.startLocalCollaborationServer();
                      setServerUrl(result.serverUrl);
                      setServerKey('');
                      report('이 PC의 로컬 테스트 서버를 시작했습니다.');
                    })
                  }
                >
                  이 PC에서 테스트 서버 시작
                </button>
                <small className="collaboration-help">
                  내장 테스트 서버는 이 PC에서만 접속하며 앱 종료 시 중지됩니다.
                  다른 PC와 협업하려면 별도 서버를 실행하고 그 주소를
                  사용하세요.
                </small>
              </>
            ) : tab === 'recover' ? (
              <>
                <label>
                  프로젝트 ID
                  <input
                    aria-label="복구 프로젝트 ID"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  />
                </label>
                <label>
                  관리자 복구 키
                  <input
                    aria-label="관리자 복구 키"
                    type="password"
                    value={recoveryKey}
                    onChange={(event) => setRecoveryKey(event.target.value)}
                  />
                </label>
                <p className="collaboration-help">
                  복구하면 이전 관리자 세션과 복구 키가 무효화됩니다. 새 복구
                  정보를 다시 보관하세요.
                </p>
              </>
            ) : (
              <label>
                초대 코드
                <input
                  aria-label="초대 코드"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="관리자에게 받은 코드"
                />
              </label>
            )}
            <button
              className="button-primary"
              disabled={
                busy ||
                (tab !== 'recover' && !name.trim()) ||
                !serverUrl.trim() ||
                (tab === 'join' && !code.trim()) ||
                (tab === 'recover' &&
                  (!projectId.trim() || !recoveryKey.trim()))
              }
              onClick={() => void connect()}
            >
              {busy ? <LoaderCircle size={15} className="spin" /> : null}
              {tab === 'create'
                ? '서버에 공유하고 코드 발급'
                : tab === 'recover'
                  ? '관리자 세션 복구'
                  : '같은 캔버스에 참여'}
            </button>
            <button
              className="subtle-button"
              onClick={() => setTab(tab === 'recover' ? 'join' : 'recover')}
            >
              {tab === 'recover'
                ? '코드로 참여로 돌아가기'
                : '관리자 세션을 잃었나요? 복구하기'}
            </button>
          </>
        )}
        {error && (
          <p className="collaboration-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
