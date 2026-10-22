import { useRuntime } from './runtime/RuntimeProvider';
import { useEffect, useState } from 'react';
import type { CollaborationState } from '../shared';
import type { GamejamApproval } from '../gamejam-approval';
import {
  DELETION_READ_EVENT,
  deletionNoticeScope,
  deletionUnread,
} from '../request-deletion-notices';

export function RequestDeletionNotice({
  collaboration: c,
  open,
}: {
  collaboration: CollaborationState;
  open: (id: string) => void;
}) {
  const { api, preferences } = useRuntime();
  const scope = deletionNoticeScope(c);
  const [data, setData] = useState<{
    scope: string;
    items: GamejamApproval[];
  } | null>(null);
  const [, refreshRead] = useState(0);
  useEffect(() => {
    const refresh = () => refreshRead((n) => n + 1);
    window.addEventListener(DELETION_READ_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(DELETION_READ_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  useEffect(() => {
    if (
      !scope ||
      !c.active ||
      !c.connected ||
      c.accessDenied ||
      c.requestDeletionVersion !== 1
    )
      return;
    let active = true;
    void api.ai
      .listApprovals()
      .then((list) => {
        if (active)
          setData({
            scope,
            items: list.items.filter(
              (r) => r.authorId === c.memberId && r.status === 'deleted',
            ),
          });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    scope,
    c.active,
    c.connected,
    c.accessDenied,
    c.memberId,
    c.requestsVersion,
    c.requestDeletionVersion,
  ]);
  const unread =
    c.active && !c.accessDenied && scope && data?.scope === scope
      ? data.items.filter((item) => deletionUnread(preferences, scope, item))
      : [];
  const item = unread[0];
  if (!item) return null;
  return (
    <section
      className="request-deletion-notice floating-surface"
      role="status"
      aria-label="요청 삭제 알림"
    >
      <strong>{item.request.resultName || '내 요청'} · 삭제됨</strong>
      <p>{item.deletion?.actorName}님이 요청을 삭제했습니다.</p>
      <p className="request-deletion-excerpt">
        삭제 이유: {item.deletion?.reason}
      </p>
      <button onClick={() => open(item.id)}>
        삭제 이유 확인{unread.length > 1 ? ` (${unread.length})` : ''}
      </button>
    </section>
  );
}
