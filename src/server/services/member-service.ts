import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { Project, Member } from '../project-state.ts';
import { assertRemainingAdmin } from './project-mode-service.ts';
import { ApiError } from './errors.ts';
import type { CollaborationRole } from '../../contracts/collaboration.ts';

type Input = Record<string, unknown>;
type Ports = {
  identity: {
    now: () => number;
    invite: () => string;
    digest: (value: string) => string;
  };
  admin: (member: Member) => void;
  clone: (project: Project) => Project;
  recordChanges: (
    project: Project,
    member: Member,
    files: Snapshot,
    label: string,
  ) => void;
  persist: (project: Project) => Promise<void>;
  envelope: (project: Project, member: Member) => CollaborationEnvelope;
  releaseLocks: (projectId: string, memberId: string) => void;
  forgetPresence: (projectId: string, memberId: string) => void;
};
const role = (value: unknown): CollaborationRole => {
  if (!['admin', 'editor', 'viewer'].includes(value as string))
    throw new ApiError('역할이 올바르지 않습니다.', 400);
  return value as CollaborationRole;
};
/** Called with the current actor inside the existing project queue. */
export function createMemberService(ports: Ports) {
  async function rotateInvite(project: Project, member: Member) {
    ports.admin(member);
    const next = ports.clone(project),
      code = ports.identity.invite();
    next.inviteHash = ports.identity.digest(code);
    next.inviteExpiresAt = ports.identity.now() + 24 * 60 * 60000;
    ports.recordChanges(next, member, next.files, '초대 코드 재발급');
    await ports.persist(next);
    return { ...ports.envelope(next, member), code };
  }
  async function setRole(project: Project, member: Member, input: Input) {
    ports.admin(member);
    const next = ports.clone(project),
      target = next.members.find(
        (candidate) => candidate.id === input.memberId && !candidate.removed,
      );
    if (!target) throw new ApiError('참여자를 찾을 수 없습니다.');
    if (target.owner)
      throw new ApiError(
        '프로젝트 소유자의 관리자 권한은 회수할 수 없습니다. 소유권 인계를 사용해주세요.',
      );
    if (project.job && project.job.memberId === target.id)
      throw new ApiError(
        'AI 실행 중에는 실행자의 역할을 변경할 수 없습니다. 먼저 작업을 중지해주세요.',
      );
    if (input.role === 'removed') target.removed = true;
    else target.role = role(input.role);
    assertRemainingAdmin(next);
    ports.recordChanges(
      next,
      member,
      next.files,
      `${target.nickname} · ${input.role === 'removed' ? '참여 권한 회수' : '역할 변경'}`,
    );
    await ports.persist(next);
    ports.releaseLocks(project.id, target.id);
    return ports.envelope(next, member);
  }
  function leave(project: Project, member: Member) {
    ports.forgetPresence(project.id, member.id);
    ports.releaseLocks(project.id, member.id);
    return {};
  }
  return { rotateInvite, setRole, leave };
}
