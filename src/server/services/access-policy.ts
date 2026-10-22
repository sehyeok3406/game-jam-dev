import type {
  CollaborationCommand,
  CollaborationRole,
} from '../../contracts/collaboration.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { PropertyVersions } from '../../contracts/sync-properties.ts';
import { changedGroups, objectId } from '../../sync-properties.ts';
import { isDrawingPath } from '../../drawing-model.ts';
import { isGameUiPath } from '../../game-ui-model.ts';
import { ApiError } from './errors.ts';

type AccessMember = {
  id: string;
  role: CollaborationRole;
  tokenHash: string;
  removed?: boolean;
};
type EditableProject = {
  id: string;
  revisions: Record<string, number>;
  propertyVersions?: PropertyVersions;
  propertySync?: boolean;
  job?: { fileLock?: unknown } | null;
};
type AccessPorts = {
  matches: (token: string, hash: string) => boolean;
  now: () => number;
  seen: (projectId: string, memberId: string, at: number) => void;
  locks: (projectId: string) => ReadonlyMap<string, { memberId: string }>;
};

/** Stateless decisions over the current project; transport and persistence stay outside. */
export function createAccessPolicy(ports: AccessPorts) {
  const authenticate = <M extends AccessMember>(
    project: { id: string; members: M[] },
    token: string,
  ): M => {
    const member = project.members.find(
      (member) => !member.removed && ports.matches(token, member.tokenHash),
    );
    if (!member)
      throw new ApiError(
        '참여 권한이 없거나 회수되었습니다. 코드를 통해 다시 참여해주세요.',
        403,
      );
    ports.seen(project.id, member.id, ports.now());
    return member;
  };
  const admin = (member: Pick<AccessMember, 'role'>) => {
    if (member.role !== 'admin')
      throw new ApiError('관리자만 사용할 수 있는 기능입니다.', 403);
  };
  const editable = (
    project: Pick<EditableProject, 'job'>,
    member: Pick<AccessMember, 'role'>,
  ) => {
    if (member.role === 'viewer')
      throw new ApiError('뷰어는 문서를 편집할 수 없습니다.', 403);
    if (project.job && !project.job.fileLock)
      throw new ApiError(
        '현재 AI 작업이 진행 중입니다. 문서 편집이 잠겨 있습니다.',
      );
  };
  const assertBases = (
    project: EditableProject,
    before: Snapshot,
    after: Snapshot,
    bases: Record<string, number>,
    member: AccessMember,
    command?: CollaborationCommand,
  ) => {
    for (const relative of Object.keys({ ...before, ...after }).filter(
      (relative) => before[relative] !== after[relative],
    )) {
      const groups = changedGroups(relative, before[relative], after[relative]);
      // Targets are checked by the drawing reducer against the current snapshot.
      if (
        command?.channel === 'game-ui:apply' &&
        (isGameUiPath(relative) || relative.startsWith('docs/ui/'))
      )
        continue;
      if (
        (command?.channel === 'drawings:apply' ||
          command?.channel === 'canvas:batch') &&
        isDrawingPath(relative)
      )
        continue;
      const scoped =
        command?.propertySyncVersion === 1 &&
        [
          'documents:save',
          'documents:set-color',
          'documents:set-workflow',
          'documents:update-layout',
          'sections:update-layout',
          'layouts:update',
        ].includes(command.channel) &&
        before[relative] !== undefined &&
        after[relative] !== undefined &&
        !groups.includes('structure');
      if (scoped) {
        if (
          (command.properties?.[relative]?.structure ?? 0) !==
          (project.propertyVersions?.[relative]?.structure ?? 0)
        )
          throw new ApiError(
            `객체 소속이나 생성 버전이 변경되었습니다: ${relative}`,
          );
        if (
          command.objects?.[relative] !==
          (objectId(before[relative]) || relative)
        )
          throw new ApiError(`객체가 변경되었거나 삭제되었습니다: ${relative}`);
        for (const group of groups) {
          if (
            (group === 'content' || group === 'workflow') &&
            (command.properties?.[relative]?.[group] ?? 0) !==
              (project.propertyVersions?.[relative]?.[group] ?? 0)
          )
            throw new ApiError(
              `문서 내용이 변경되었습니다. 초안은 보관됩니다: ${relative}`,
            );
        }
      }
      if (
        !scoped &&
        (bases?.[relative] ?? 0) !== (project.revisions[relative] ?? 0)
      )
        throw new ApiError(
          `다른 참여자가 변경했습니다. 최신 내용을 확인하고 다시 시도해주세요: ${relative}`,
        );
      const lock = ports.locks(project.id).get(relative);
      const metadataOnly =
        (project.propertySync || scoped) &&
        !groups.includes('structure') &&
        !groups.includes('content') &&
        before[relative] !== undefined &&
        after[relative] !== undefined;
      if (lock && lock.memberId !== member.id && !metadataOnly)
        throw new ApiError(`다른 참여자가 편집 중입니다: ${relative}`);
      if (
        member.role !== 'admin' &&
        relative.startsWith('.ai/tasks/') &&
        before[relative] !== undefined
      )
        throw new ApiError('AI 작업 문서는 관리자만 변경할 수 있습니다.', 403);
    }
  };
  return { authenticate, admin, editable, assertBases };
}
