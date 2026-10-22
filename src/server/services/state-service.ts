import type { Project, Member, Lock } from '../project-state.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import { collaborationPath } from '../../collaboration-model.ts';
import { ApiError } from './errors.ts';
type Ports = {
  admin: (m: Member) => void;
  editable: (p: Project, m: Member) => void;
  locks: (id: string) => Map<string, Lock>;
  assertUnlocked: (p: Project, path: string) => void;
  envelope: (p: Project, m: Member) => CollaborationEnvelope;
  secret: () => string;
  now: () => number;
  announce: (id: string) => void;
};
/** Existing queue/actor/capability gates are required at the caller. No durable writes. */
export function createStateService(ports: Ports) {
  function execute(
    project: Project,
    member: Member,
    action: string,
    input: Record<string, unknown>,
  ) {
    if (action === 'state') {
      for (const item of Array.isArray(input.renewLocks)
        ? input.renewLocks
        : []) {
        if (!item || typeof item !== 'object') continue;
        const { relativePath, token } = item as {
          relativePath: string;
          token: string;
        };
        const lock = ports.locks(project.id).get(relativePath);
        if (lock?.memberId === member.id && lock.token === token)
          lock.expiresAt = ports.now() + 30000;
      }
      const result = ports.envelope(project, member);
      if (input.metadataOnly === true) return { state: result.state };
      return input.knownRevision === project.revision
        ? { ...result, files: undefined, revisions: undefined }
        : result;
    }
    if (action === 'lock') {
      ports.editable(project, member);
      const relative = collaborationPath(input.relativePath);
      ports.assertUnlocked(project, relative);
      if (
        !project.files[relative] ||
        !relative.endsWith('.md') ||
        relative.startsWith('sections/')
      )
        throw new ApiError('편집할 문서를 찾을 수 없습니다.');
      if (relative.startsWith('.ai/tasks/')) ports.admin(member);
      const current = ports.locks(project.id).get(relative);
      if (current && current.memberId !== member.id)
        throw new ApiError('다른 참여자가 이 문서를 편집 중입니다.');
      const token = current?.token ?? ports.secret();
      ports.locks(project.id).set(relative, {
        token,
        memberId: member.id,
        expiresAt: ports.now() + 30000,
      });
      ports.announce(project.id);
      return { ...ports.envelope(project, member), lockToken: token };
    }
    if (action === 'unlock') {
      const lock = ports.locks(project.id).get(String(input.relativePath));
      if (lock?.memberId === member.id && lock.token === input.token)
        ports.locks(project.id).delete(String(input.relativePath));
      ports.announce(project.id);
      return ports.envelope(project, member);
    }
    throw new ApiError('지원하지 않는 상태 작업입니다.', 404);
  }
  return { execute };
}
