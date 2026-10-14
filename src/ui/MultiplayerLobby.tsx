import { useEffect, useState } from 'react';
import { readMultiplayerManifest } from '../multiplayer/contract';
import type { PlayRoom } from '../multiplayer/types';

export function MultiplayerLobby({
  path,
  html,
  projectOnly = false,
}: {
  path?: string;
  html?: string;
  projectOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<PlayRoom[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  let supported = false;
  try {
    supported = projectOnly || !!readMultiplayerManifest(html ?? '');
  } catch {
    /* Malformed games have validation diagnostics. */
  }
  const api = window.gameCanvas.multiplayer;
  useEffect(() => {
    if (!open || !api) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await api.control({ action: 'list' });
        if (active) {
          setRooms(result.rooms ?? []);
          setError('');
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, api]);
  if (!supported) return null;
  const enter = async (roomId?: string) => {
    if (!api) return;
    setBusy(true);
    setError('');
    try {
      if (!roomId) {
        const result = await api.control({ action: 'create', path });
        roomId = result.room?.id;
      }
      if (roomId) await api.open(roomId);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
          <button type="button" onClick={() => setOpen(false)}>
            닫기
          </button>
        </section>
      )}
    </span>
  );
}
