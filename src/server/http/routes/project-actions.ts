import type { HttpRoute } from '../router.ts';
import type { Project, Member } from '../../project-state.ts';
import { body, bearerToken } from '../request.ts';
import { reply } from '../response.ts';
import { projectResponse } from '../../services/project-response.ts';
export type ProjectActionHttpPorts = {
  peer?: (request: import('node:http').IncomingMessage) => string;
  get: (id: string) => Project | undefined;
  unavailable: (id: string) => never;
  authenticate: (p: Project, t: string) => Member;
  limit: (id: string, kind: string, max: number) => void;
  run: (
    id: string,
    t: string,
    action: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
};
export function projectActionRoute(
  accept: (action: string) => boolean,
  ports: ProjectActionHttpPorts,
): HttpRoute {
  return async (request, response, url) => {
    const match = /^\/projects\/([a-f0-9-]{36})\/([a-z-]+)$/.exec(url.pathname);
    if (request.method !== 'POST' || !match || !accept(match[2])) return false;
    const [, id, action] = match;
    ports.limit(
      ports.peer?.(request) ?? request.socket.remoteAddress ?? 'unknown',
      'project-ingress',
      2400,
    );
    const project = ports.get(id);
    if (!project) return ports.unavailable(id);
    const token = bearerToken(request);
    const member = ports.authenticate(project, token);
    ports.limit(id + ':' + member.id, 'member', 600);
    const input = await body(request);
    const result = await ports.run(id, token, action, input);
    reply(response, 200, projectResponse(ports.get(id), input, result));
    return true;
  };
}
