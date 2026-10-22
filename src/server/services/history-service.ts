import { ServerLimits } from '../../contracts/server-limits.ts';
import type { Project, Member } from '../project-state.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type { HistoryEntry } from '../../shared.ts';
import { changedGroups } from '../../sync-properties.ts';
import { checkSnapshot } from '../../collaboration-model.ts';
import { invertEdit } from '../../edit-journal.ts';
import { ApiError } from './errors.ts';
import { listProjectHistory, readProjectHistory } from './history-query.ts';
import { planHistoryRestoration } from './history-restoration.ts';
type Ports = {
  admin: (member: Member) => void;
  editable: (project: Project, member: Member) => void;
  locks: (id: string) => ReadonlyMap<string, unknown>;
  assertAiMutation: (project: Project, files: Snapshot) => void;
  clone: (project: Project) => Project;
  recordChanges: (
    project: Project,
    member: Member,
    files: Snapshot,
    label: string,
    kind?: HistoryEntry['kind'],
  ) => void;
  persist: (project: Project) => Promise<void>;
  checkpoint: (project: Project) => Promise<void>;
  envelope: (project: Project, member: Member) => CollaborationEnvelope;
};
/** Queue, current authentication and common lifecycle/capability gates belong to the caller. */
export function createHistoryService(ports: Ports) {
  async function execute(
    project: Project,
    member: Member,
    action: string,
    input: Record<string, unknown>,
  ) {
    if (action === 'history-change') {
      ports.editable(project, member);
      if (input.direction !== 'undo' && input.direction !== 'redo')
        throw new ApiError('편집 방향이 올바르지 않습니다.');
      if (
        typeof input.operationId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(input.operationId)
      )
        throw new ApiError('작업 ID가 올바르지 않습니다.');
      const applied = project.applied.find(
        (operation) => operation.id === input.operationId,
      );
      if (applied) {
        if (applied.memberId !== member.id)
          throw new ApiError('작업 ID가 충돌했습니다.');
        return ports.envelope(project, member);
      }
      const record = project.history.find(
        (record) => record.entry.id === input.id,
      );
      if (
        !record ||
        record.entry.kind !== 'user' ||
        record.entry.actorId !== member.id
      )
        throw new ApiError('본인의 편집 작업만 되돌릴 수 있습니다.', 403);
      for (const file of record.entry.files) {
        if (file.relativePath.startsWith('.ai/tasks/')) ports.admin(member);
        if (
          ports.locks(project.id).has(file.relativePath) &&
          changedGroups(
            file.relativePath,
            record.before[file.relativePath],
            record.after[file.relativePath],
          ).some((group) => group === 'content' || group === 'structure')
        )
          throw new ApiError('해당 문서의 편집이 끝난 뒤 되돌려주세요.');
      }
      const files = invertEdit(
        project.files,
        record.before,
        record.after,
        input.direction,
      );
      ports.assertAiMutation(project, files);
      checkSnapshot(files);
      const next = ports.clone(project);
      ports.recordChanges(
        next,
        member,
        files,
        `${input.direction === 'undo' ? '실행 취소' : '다시 실행'} · ${record.entry.label}`,
      );
      next.applied.push({
        id: input.operationId,
        memberId: member.id,
        result: null,
      });
      next.applied = next.applied.slice(-ServerLimits.receipts);
      await ports.persist(next);
      return ports.envelope(next, member);
    }
    if (action === 'history') return listProjectHistory(project);
    if (action === 'history-read') return readProjectHistory(project, input);
    if (action === 'restore') {
      ports.admin(member);
      ports.editable(project, member);
      if (ports.locks(project.id).size)
        throw new ApiError('다른 문서 편집이 끝난 뒤 복원해주세요.');
      if (input.revision !== project.revision)
        throw new ApiError(
          '복원 확인 이후 변경되었습니다. 최신 내용을 확인해주세요.',
        );
      const record = project.history.find(
        (record) => record.entry.id === input.id,
      );
      if (!record || record.entry.status !== 'completed')
        throw new ApiError('복원할 기록을 찾을 수 없습니다.');
      const next = ports.clone(project);
      const files = planHistoryRestoration(project.files, record, input);
      ports.assertAiMutation(project, files);
      ports.recordChanges(next, member, files, '이전 버전 복원', 'restore');
      await ports.persist(next);
      await ports.checkpoint(next);
      return ports.envelope(next, member);
    }
    throw new ApiError('지원하지 않는 기록 작업입니다.', 404);
  }
  return { execute };
}
