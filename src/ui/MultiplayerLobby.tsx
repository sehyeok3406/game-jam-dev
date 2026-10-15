import { useEffect, useState } from 'react';
import { readMultiplayerManifest } from '../multiplayer/contract';
import { usesIndependentConnection } from '../multiplayer/compatibility';
import type { PlayRoom } from '../multiplayer/types';
import { playFailure, type PlayFailure } from '../multiplayer/errors';

export function MultiplayerLobby({
  path,
  html,
  projectOnly = false,
  onRepair,
  repairDisabled = false,
}: {
  path?: string;
  html?: string;
  projectOnly?: boolean;
  onRepair?: () => void;
  repairDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<PlayRoom[]>([]);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<PlayFailure | null>(null);
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);
  let supported = false;
  try {
    supported = projectOnly || !!readMultiplayerManifest(html ?? '');
  } catch {
    /* Malformed games have validation diagnostics. */
  }
  const api = window.gameCanvas.multiplayer;
  const independent = !projectOnly && usesIndependentConnection(html ?? '');
  useEffect(() => {
    if (!open || !api) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await api.control({ action: 'list' });
        if (active) {
          setRooms(result.rooms ?? []);
        }
      } catch (e) {
        if (active) {
          const value = playFailure(e, 'GC-MP-007');
          setFailure(value);
          setError(value.message);
        }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, api]);
  if (independent)
    return (
      <span
        className="multiplayer-launcher nodrag nowheel"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          title="함께 플레이 연결 확인"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          연결 확인
        </button>
        {open && (
          <section
            className="multiplayer-lobby"
            role="dialog"
            aria-label="함께 플레이 연결 확인"
          >
            <strong>이 게임은 프로젝트와 별도로 연결하고 있어요.</strong>
            <p>
              프로젝트에 함께 들어와 있어도 이 게임은 따로 연결을 시도해요.
              게임의 규칙과 화면을 유지하고 연결 방식을 수정할 수 있어요.
            </p>
            {onRepair && (
              <button
                type="button"
                disabled={repairDisabled}
                onClick={onRepair}
              >
                이 게임의 연결 방식 수정 요청
              </button>
            )}
            <small>GC-MP-030 · 연결 방식 확인 필요</small>
          </section>
        )}
      </span>
    );
  if (!supported) return null;
  const enter = async (roomId?: string) => {
    if (!api) return;
    setBusy(true);
    setError('');
    setFailure(null);
    try {
      if (!roomId) {
        const result = await api.control({ action: 'create', path });
        roomId = result.room?.id;
      }
      if (roomId) await api.open(roomId);
      setOpen(false);
    } catch (e) {
      const value = playFailure(e, 'GC-MP-029');
      setFailure(value);
      setError(value.message);
    } finally {
      setBusy(false);
    }
  };
  const diagnostics = async (copy = false) => {
    try {
      const result = await api?.diagnostics?.(copy);
      if (result) {
        setReport(result.report);
        setCopied(
          copy
            ? '오류 정보를 복사했어요.'
            : result.count
              ? '최근 오류 기록을 확인할 수 있어요.'
              : '아직 기록된 오류가 없어요.',
        );
        if (!result.storageAvailable)
          setCopied(
            '파일 저장이 어려워 현재 남아 있는 오류 정보를 표시했어요. 복사해 보관해주세요.',
          );
      }
    } catch {
      setCopied(
        '오류 기록을 가져오지 못했어요. 표시된 오류 코드를 전달해주세요.',
      );
    }
  };
  return (
    <span
      className="multiplayer-launcher nodrag nowheel"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="프로젝트 참여자와 함께 플레이"
      >
        {projectOnly ? '플레이 중인 방 보기' : '함께 플레이'}
      </button>
      {open && (
        <section
          className="multiplayer-lobby"
          role="dialog"
          aria-label="함께 플레이 방 목록"
        >
          <strong>프로젝트 함께 플레이</strong>
          <p>
            혼자 연습은 현재 미리보기에서 할 수 있습니다. 공동 프로젝트에
            연결하면 방을 만들고 참가할 수 있습니다.
          </p>
          {!api && <p>데스크톱 앱에서 공동 프로젝트에 연결해주세요.</p>}
          {error && <p role="alert">{error}</p>}
          {failure && (
            <div className="multiplayer-failure">
              <p>{failure.hint}</p>
              <details>
                <summary>오류 정보</summary>
                <p>
                  {failure.code} · 추적 번호 {failure.id}
                </p>
                <pre>
                  {JSON.stringify(
                    {
                      phase: failure.phase,
                      at: failure.at,
                      details: failure.details,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          )}
          {!projectOnly && (
            <button
              type="button"
              disabled={busy || !api}
              onClick={() => void enter()}
            >
              이 게임으로 방 만들기
            </button>
          )}
          <ul>
            {rooms.map((room) => (
              <li key={room.id}>
                <span>
                  {room.title} · {room.members.length}/
                  {room.manifest.maxPlayers}명 ·{' '}
                  {room.status === 'running'
                    ? '플레이 중'
                    : room.status === 'lobby'
                      ? '참가 대기'
                      : room.status === 'finished'
                        ? '다시 준비'
                        : room.status === 'paused'
                          ? '복구 중'
                          : '로딩 중'}
                </span>
                <button
                  type="button"
                  disabled={
                    busy || !['lobby', 'finished'].includes(room.status)
                  }
                  onClick={() => void enter(room.id)}
                >
                  참가
                </button>
              </li>
            ))}
          </ul>
          {api?.diagnostics && (
            <>
              <button type="button" onClick={() => void diagnostics()}>
                최근 오류 보기
              </button>
              <button type="button" onClick={() => void diagnostics(true)}>
                오류 정보 복사
              </button>
              <p role="status">{copied}</p>
              {report && (
                <details>
                  <summary>최근 오류 기록</summary>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      maxHeight: 240,
                      overflow: 'auto',
                    }}
                  >
                    {report}
                  </pre>
                </details>
              )}
            </>
          )}
          <button type="button" onClick={() => setOpen(false)}>
            닫기
          </button>
        </section>
      )}
    </span>
  );
}
