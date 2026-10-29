import { detachStatus } from './project-mode-service.ts';
import { assertEraseSupport } from './drawing-capabilities.ts';
import type { Project, Member } from '../project-state.ts';
import {
  assertLifecycleVersion,
  assertProjectCapabilities,
} from './project-capabilities.ts';
type Ports = {
  get: (id: string) => Project | undefined;
  unavailable: (id: string) => never;
  authenticate: (p: Project, token: string) => Member;
  queue: <T>(id: string, work: () => Promise<T>) => Promise<T>;
  assertActive: (p: Project) => void;
  admin: (m: Member) => void;
  expire: (p: Project) => Promise<Project>;
  lifecycle: (
    p: Project,
    m: Member,
    action: string,
    input: Record<string, unknown>,
  ) => unknown;
  dispatch: (
    p: Project,
    m: Member,
    action: string,
    input: Record<string, unknown>,
  ) => unknown;
};
/** Reacquire the project and actor inside FIFO. Never trust actor fields in the body. */
export function createProjectRequest(ports: Ports) {
  return (
    id: string,
    token: string,
    action: string,
    input: Record<string, unknown>,
  ) =>
    ports.queue(id, async () => {
      let project = ports.get(id);
      if (!project) return ports.unavailable(id);
      if (action === 'detach-status') return detachStatus(project, input);
      const member = ports.authenticate(project, token);
      if (action === 'lifecycle' || action.startsWith('trash'))
        return ports.lifecycle(project, member, action, input);
      ports.assertActive(project);
      assertEraseSupport(project.files, input);
      assertLifecycleVersion(project, action, input);
      project = await ports.expire(project);
      assertProjectCapabilities(project, member, action, input, ports.admin);
      return ports.dispatch(project, member, action, input);
    });
}
