import type { HttpRoute } from '../router.ts';
import { bearerToken } from '../request.ts';
import type { ProjectEvents } from '../../services/project-events.ts';

type EventAccess = {
  authenticate: (projectId: string, token: string) => { id: string };
  limit: (identity: string, category: string, max: number) => void;
};

export function eventsRoute(
  access: EventAccess,
  events: Pick<ProjectEvents, 'open'>,
): HttpRoute {
  return (request, response, url) => {
    const match = /^\/projects\/([a-f0-9-]{36})\/events$/.exec(url.pathname);
    if (request.method !== 'GET' || !match) return false;
    const id = match[1];
    const member = access.authenticate(id, bearerToken(request));
    access.limit(`${id}:${member.id}`, 'stream', 30);
    events.open(id, member.id, response);
    return true;
  };
}
