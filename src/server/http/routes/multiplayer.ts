import type { HttpRoute } from '../router.ts';
import type { Project, Member } from '../../project-state.ts';
import { body, bearerToken } from '../request.ts';
import { reply } from '../response.ts';
import { ApiError } from '../errors.ts';
import {
  diagnosticRef,
  PlayDiagnostics,
} from '../../../multiplayer/diagnostics.ts';
type Ports = {
  get: (id: string) => Project | undefined;
  authenticate: (p: Project, token: string) => Member;
  assertActive: (p: Project) => void;
  limit: (id: string, kind: string, max: number) => void;
  control: (id: string, token: string, input: unknown) => unknown;
  record: PlayDiagnostics['record'];
};
export function multiplayerRoute(ports: Ports): HttpRoute {
  return async (request, response, url) => {
    if (request.method !== 'POST') return false;
    const playMatch = /^\/projects\/([a-f0-9-]{36})\/play$/.exec(url.pathname);
    if (playMatch) {
      let playContext: Record<string, unknown> = {};
      try {
        const project = ports.get(playMatch[1]);
        if (!project) throw new ApiError('프로젝트를 찾을 수 없습니다.', 404);
        const token = bearerToken(request);
        const member = ports.authenticate(project, token);
        ports.assertActive(project);
        ports.limit(`${project.id}:${member.id}`, 'play-control', 120);
        const payload = await body(request);
        const action = payload as {
          action?: unknown;
          roomId?: unknown;
        };
        playContext = {
          operation: action?.action,
          roomRef:
            typeof action?.roomId === 'string' &&
            /^[a-f0-9-]{36}$/.test(action.roomId)
              ? diagnosticRef(action.roomId)
              : undefined,
        };
        reply(response, 200, ports.control(project.id, token, payload));
      } catch (error) {
        const failure = ports.record(error, 'GC-MP-020', {
          side: 'server',
          projectRef: diagnosticRef(playMatch[1]),
          ...playContext,
        });
        reply(response, error instanceof ApiError ? error.status : 400, {
          error: `[${failure.code}] ${failure.message}`,
          code: failure.code,
          failure,
        });
      }
      return true;
    }
    return false;
  };
}
