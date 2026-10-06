import type { FileActor } from './shared';

export function authorLabel(actor?: FileActor) {
  if (
    !actor ||
    typeof actor.name !== 'string' ||
    !actor.name ||
    !['member', 'local', 'ai'].includes(actor.kind)
  )
    return '확인할 수 없음';
  return actor.kind === 'ai' ? `AI · 실행자 ${actor.name}` : actor.name;
}
