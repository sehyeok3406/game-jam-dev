import type { CollaborationState } from './shared';
import type { GamejamApproval } from './gamejam-approval';

export const DELETION_READ_EVENT = 'gamejam-request-deletion-read';
export const deletionNoticeScope = (c: CollaborationState) =>
  c.projectId && c.memberId
    ? JSON.stringify([c.serverUrl ?? '', c.projectId, c.memberId])
    : null;
const key = (scope: string, id: string) =>
  `gamejam-request-deletion-read:${scope}:${id}`;
export function deletionUnread(
  storage: Pick<Storage, 'getItem'>,
  scope: string,
  item: GamejamApproval,
) {
  if (item.status !== 'deleted' || !item.deletion) return false;
  try {
    return Number(storage.getItem(key(scope, item.id)) ?? 0) < item.revision;
  } catch {
    return true;
  }
}
export function markDeletionRead(
  storage: Pick<Storage, 'setItem'>,
  scope: string | null,
  item: GamejamApproval,
  notify: () => void,
) {
  if (!scope || item.status !== 'deleted') return;
  try {
    storage.setItem(key(scope, item.id), String(item.revision));
    notify();
  } catch {
    /* Keep the durable notice unread if local storage is unavailable. */
  }
}
