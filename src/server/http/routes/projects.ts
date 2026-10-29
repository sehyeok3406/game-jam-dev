import {
  projectActionRoute,
  type ProjectActionHttpPorts,
} from './project-actions.ts';
import type { HttpRoute } from '../router.ts';
import { body } from '../request.ts';
import { reply } from '../response.ts';
import { ApiError } from '../errors.ts';
type Ports = {
  peer?: (request: import('node:http').IncomingMessage) => string;
  limit: (id: string, kind: string, max: number) => void;
  validKey: (key: string) => boolean;
  create: (input: Record<string, unknown>) => Promise<unknown>;
  join: (input: Record<string, unknown>) => Promise<unknown>;
  recover: (input: Record<string, unknown>) => Promise<unknown>;
};
export function projectsRoute(ports: Ports): HttpRoute {
  return async (request, response, url) => {
    if (
      request.method !== 'POST' ||
      !['/projects', '/projects-mode', '/join', '/recover'].includes(
        url.pathname,
      )
    )
      return false;
    const peer =
      ports.peer?.(request) ?? request.socket.remoteAddress ?? 'unknown';
    if (url.pathname === '/projects' || url.pathname === '/projects-mode') {
      ports.limit(peer, 'create', 10);
      if (!ports.validKey(String(request.headers['x-server-key'] ?? '')))
        throw new ApiError('서버 생성 키가 올바르지 않습니다.', 403);
    } else
      ports.limit(
        peer,
        url.pathname === '/join' ? 'join' : 'recover',
        url.pathname === '/join' ? 20 : 10,
      );
    const input = await body(request);
    if (url.pathname === '/projects-mode' && input.projectModeVersion !== 1)
      throw new ApiError('프로젝트 전환 프로토콜이 올바르지 않습니다.', 400);
    const result =
      url.pathname === '/projects' || url.pathname === '/projects-mode'
        ? await ports.create(input)
        : url.pathname === '/join'
          ? await ports.join(input)
          : await ports.recover(input);
    reply(response, 200, result);
    return true;
  };
}

export const projectsActionRoute = (ports: ProjectActionHttpPorts) =>
  projectActionRoute(
    (action) =>
      action === 'rename' ||
      action === 'lifecycle' ||
      action.startsWith('trash'),
    ports,
  );
