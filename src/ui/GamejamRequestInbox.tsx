import { useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Inbox } from 'lucide-react';
import {
  APPROVAL_STATUS_NAMES,
  approvalEditable,
  type ApprovalDetail,
  type ApprovalStatus,
  type GamejamApproval,
} from '../gamejam-approval';
import type { AiProviderId, CollaborationState } from '../shared';
import { AI_PROVIDERS, aiProvider as getAiProvider } from '../ai-providers';
import { GamejamReview } from './GamejamWizard';
import { DiscordApprovalSettings } from './DiscordApprovalSettings';

type Props = {
  collaboration: CollaborationState;
  provider: AiProviderId;
  model: string;
  aiBusy: boolean;
  setProvider: (value: AiProviderId) => void;
  setModel: (value: string) => void;
  close: () => void;
  edit: (item: GamejamApproval, copy: boolean) => void;
  run: (detail: ApprovalDetail, commandId: string) => Promise<void>;
  openResult: (path: string) => void;
};

export function GamejamRequestInbox({
  collaboration: c,
  provider,
  model,
  aiBusy,
  setProvider,
  setModel,
  close,
  edit,
  run,
  openResult,
}: Props) {
  const admin = c.role === 'admin';
  const [items, setItems] = useState<GamejamApproval[]>([]);
  const [filter, setFilter] = useState<ApprovalStatus | 'all'>('all');
  const [mine, setMine] = useState(!admin);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [changed, setChanged] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const detailId = detail?.item.id;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const operation = useRef<{ key: string; id: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void window.gameCanvas
      .listApprovals()
      .then((list) => {
        if (active) setItems(list.items);
      })
      .catch((e) => {
        if (active) setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [c.requestsVersion, c.connected, refresh]);
  // Keep the reviewed version on screen until the reviewer explicitly reloads it.
  useEffect(() => {
    if (!detailId) return;
    let active = true;
    void window.gameCanvas
      .readApproval(detailId)
      .then((fresh) => {
        if (
          active &&
          detailRef.current?.item.id === detailId &&
          (fresh.item.revision !== detailRef.current.item.revision ||
            fresh.reviewToken !== detailRef.current.reviewToken)
        )
          setChanged(true);
      })
      .catch((e) => {
        if (active) setError(String(e instanceof Error ? e.message : e));
      });
    return () => {
      active = false;
    };
  }, [detailId, c.requestsVersion, c.revision, refresh]);
  const readVersion = useRef(0);
  const read = async (id: string) => {
    const version = ++readVersion.current;
    setError('');
    setBusy(true);
    try {
      const value = await window.gameCanvas.readApproval(id);
      if (!mounted.current || version !== readVersion.current) return;
      setDetail(value);
      setChanged(false);
      setMessage('');
      operation.current = null;
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && version === readVersion.current) setBusy(false);
    }
  };
  const perform = async (action: 'feedback' | 'cancel' | 'start') => {
    if (!detail || busy) return;
    setBusy(true);
    setError('');
    const key = JSON.stringify([
      action,
      detail.item.id,
      detail.item.revision,
      message,
      detail.reviewToken,
      provider,
      model,
    ]);
    if (operation.current?.key !== key)
      operation.current = { key, id: crypto.randomUUID() };
    try {
      if (action === 'start') {
        await run(detail, operation.current.id);
        if (mounted.current) close();
      } else {
        await window.gameCanvas.mutateApproval(action, {
          commandId: operation.current.id,
          id: detail.item.id,
          revision: detail.item.revision,
          message,
        });
        if (mounted.current) {
          await read(detail.item.id);
          setRefresh((v) => v + 1);
        }
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
        setRefresh((v) => v + 1);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const item = detail?.item;
  const writable =
    c.connected && !c.accessDenied && (admin || c.role === 'editor');
  const canEdit =
    writable &&
    !!item &&
    item.authorId === c.memberId &&
    approvalEditable(item.status);
  return (
    <div className="dialog-backdrop" data-ui-id="gamejam-requests">
      <section
        className="approval-inbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-inbox-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (!busy) close();
          }
        }}
      >
        <header>
          <h2 id="approval-inbox-title">
            <Inbox size={20} /> {admin ? '요청함' : '내 요청'}
          </h2>
          <button aria-label="요청함 닫기" disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        {admin && (
          <DiscordApprovalSettings
            provider={provider}
            model={model}
            connected={c.connected && !c.accessDenied}
          />
        )}
        <div className="approval-toolbar">
          <label>
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
            />{' '}
            내 요청만
          </label>
          <label>
            상태{' '}
            <select
              aria-label="요청 상태"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="all">전체</option>
              {Object.entries(APPROVAL_STATUS_NAMES).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || loading || !c.connected}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={14} /> 새로고침
          </button>
        </div>
        {!c.connected && (
          <p role="status">
            연결이 끊겼습니다. 재연결한 뒤 요청을 변경해주세요.
          </p>
        )}
        {error && (
          <p className="approval-error" role="alert">
            {error}
          </p>
        )}
        <div className="approval-columns">
          <nav aria-label="프로젝트 요청 목록" className="approval-list">
            {loading && <p role="status">요청 불러오는 중…</p>}
            {!loading &&
              !items.some(
                (r) =>
                  (!mine || r.authorId === c.memberId) &&
                  (filter === 'all' || r.status === filter),
              ) && <p>표시할 요청이 없습니다.</p>}
            {items
              .filter(
                (r) =>
                  (!mine || r.authorId === c.memberId) &&
                  (filter === 'all' || r.status === filter),
              )
              .map((r) => (
                <button
                  key={r.id}
                  disabled={busy}
                  aria-current={item?.id === r.id ? 'true' : undefined}
                  onClick={() => void read(r.id)}
                >
                  <strong>
                    {r.request.resultName ||
                      (r.request.organize
                        ? '문서 정리 요청'
                        : 'HTML 구현 요청')}
                  </strong>
                  <span>
                    {APPROVAL_STATUS_NAMES[r.status]} · {r.authorName}
                  </span>
                  <small>{new Date(r.updatedAt).toLocaleString('ko-KR')}</small>
                </button>
              ))}
          </nav>
          <article className="approval-detail">
            {!item || !detail ? (
              <p>요청을 선택하면 내용을 확인할 수 있습니다.</p>
            ) : (
              <>
                <h3>{item.request.resultName || 'Game Jam! 요청'}</h3>
                <p>
                  {APPROVAL_STATUS_NAMES[item.status]} · {item.authorName} ·
                  수정 버전 {item.revision}
                </p>
                <p>
                  마지막 수정 {new Date(item.updatedAt).toLocaleString('ko-KR')}
                  {item.approvedName
                    ? ` · 실행 관리자 ${item.approvedName}`
                    : ''}
                </p>
                {changed && (
                  <div className="approval-change" role="status">
                    요청 내용이나 관련 자료가 변경되었습니다. 최신 내용을
                    확인해주세요.{' '}
                    <button disabled={busy} onClick={() => void read(item.id)}>
                      최신 내용 확인
                    </button>
                  </div>
                )}
                {item.feedback && (
                  <blockquote>보완 의견: {item.feedback}</blockquote>
                )}
                {detail.reviewError && (
                  <p role="alert" className="approval-error">
                    {detail.reviewError}
                  </p>
                )}
                {item.error && (
                  <p role="status" className="approval-error">
                    {item.error}
                  </p>
                )}
                <GamejamReview
                  request={item.executionRequest ?? item.request}
                  busy
                  navigate={() => {}}
                />
                {item.status === 'completed' && (
                  <div className="approval-results">
                    {item.outputs?.map((path) => (
                      <button
                        key={path}
                        onClick={() => {
                          close();
                          openResult(path);
                        }}
                      >
                        {path} 열기
                      </button>
                    ))}
                  </div>
                )}
                <div className="approval-actions">
                  {canEdit && (
                    <>
                      <button
                        disabled={busy || changed}
                        onClick={() => edit(item, false)}
                      >
                        수정하기
                      </button>
                      <button
                        disabled={busy || changed}
                        onClick={() => void perform('cancel')}
                      >
                        요청 취소
                      </button>
                    </>
                  )}
                  {writable && !approvalEditable(item.status) && (
                    <button disabled={busy} onClick={() => edit(item, true)}>
                      새 요청으로 복사
                    </button>
                  )}
                </div>
                {admin && approvalEditable(item.status) && (
                  <div className="approval-admin">
                    <label>
                      보완 의견
                      <textarea
                        aria-label="보완 의견"
                        value={message}
                        maxLength={4000}
                        onChange={(e) => setMessage(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <button
                      disabled={!writable || busy || changed || !message.trim()}
                      onClick={() => void perform('feedback')}
                    >
                      보완 요청
                    </button>
                    <label>
                      AI 제공자
                      <select
                        value={provider}
                        disabled={busy}
                        onChange={(e) => {
                          setProvider(e.target.value as AiProviderId);
                          setModel('');
                        }}
                      >
                        {AI_PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      모델
                      <select
                        value={model}
                        disabled={busy}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        {getAiProvider(provider).models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                        {model &&
                          !getAiProvider(provider).models.some(
                            (m) => m.id === model,
                          ) && <option value={model}>{model}</option>}
                      </select>
                    </label>
                    <label>
                      모델 ID (선택)
                      <input
                        value={model}
                        maxLength={128}
                        disabled={busy}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="비우면 기본 모델 사용"
                      />
                    </label>
                    <p>
                      관리자의 AI 연결로 실행합니다. 실행이 시작되면 요청 내용을
                      확정합니다.
                    </p>
                    {aiBusy && (
                      <p role="status">
                        다른 AI 작업이 끝난 뒤 승인할 수 있습니다.
                      </p>
                    )}
                    <button
                      className="button-primary"
                      disabled={
                        !writable ||
                        busy ||
                        changed ||
                        aiBusy ||
                        !detail.reviewToken
                      }
                      onClick={() => void perform('start')}
                    >
                      {busy ? '처리 중…' : '승인하고 구현하기'}
                    </button>
                  </div>
                )}
                <details>
                  <summary>변경 이력</summary>
                  <ol>
                    {item.changes.map((change, i) => (
                      <li key={i}>
                        {new Date(change.at).toLocaleString('ko-KR')} ·{' '}
                        {change.actorName} ·{' '}
                        {(
                          {
                            'requests-create': '요청 등록',
                            'requests-update': '요청 수정',
                            'requests-cancel': '요청 취소',
                            'requests-feedback': '보완 요청',
                            approved: '승인 및 구현 시작',
                            completed: '완료',
                            failed: '실패',
                            stopped: '중지',
                          } as Record<string, string>
                        )[change.action] ?? change.action}
                        {change.message ? ` · ${change.message}` : ''}
                        {change.request && (
                          <details>
                            <summary>당시 요청 내용</summary>
                            <GamejamReview
                              request={change.request}
                              busy
                              navigate={() => {}}
                            />
                          </details>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              </>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
