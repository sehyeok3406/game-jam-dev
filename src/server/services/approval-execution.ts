import type { Project, Member } from '../project-state.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type { AiProviderId, AiReasoningEffort } from '../../contracts/ai.ts';
import type { GamejamRequest } from '../../contracts/gamejam-request.ts';
import { approvalEditable } from '../../gamejam-approval.ts';
import { queueTaskView } from '../../ai-task-queue.ts';
import { ApiError } from './errors.ts';

export type ApprovalPlan = {
  files: Snapshot;
  taskPath: string;
  reviewToken: string;
  outputs: string[];
};
export type ApprovalPlanner = (
  project: Project,
  request: GamejamRequest,
  providerId: AiProviderId,
  modelId: string,
  reasoningEffort: AiReasoningEffort | null,
) => ApprovalPlan;
/** Pure approval preparation over current queued state. Does not grant or persist a lease. */
export function prepareApprovalExecution(
  ports: {
    plan: ApprovalPlanner;
    envelope: (project: Project, member: Member) => CollaborationEnvelope;
  },
  project: Project,
  member: Member,
  input: Record<string, unknown>,
  providerId: AiProviderId,
  reasoningEffort: AiReasoningEffort | null,
) {
  const approval = project.approvals?.[String(input.id)];
  if (!approval) throw new ApiError('요청을 찾을 수 없습니다.', 404);
  if (!/^[a-f0-9-]{36}$/.test(String(input.commandId)))
    throw new ApiError('요청 작업 ID가 올바르지 않습니다.', 400);
  const reserved = project.aiQueue?.find(
    (t) => t.taskPath === approval!.taskPath,
  );
  if (
    input.queueVersion === 1 &&
    approval.approvalCommandId === input.commandId &&
    reserved
  ) {
    if (
      approval.approvedRevision !== input.requestRevision ||
      approval.approvedReviewToken !== input.reviewToken ||
      approval.providerId !== providerId ||
      approval.modelId !== (input.modelId ?? null) ||
      (approval.reasoningEffort ?? null) !== reasoningEffort
    )
      throw new ApiError('같은 작업 ID로 실행 내용을 변경할 수 없습니다.');
    return {
      replay: {
        ...ports.envelope(project, member),
        queuedTask: queueTaskView(reserved),
      },
    };
  }
  if (
    approval.approvalCommandId === input.commandId &&
    project.job?.requestId === approval.id &&
    project.job.memberId === member.id
  ) {
    if (
      approval.approvedRevision !== input.requestRevision ||
      approval.approvedReviewToken !== input.reviewToken ||
      approval.providerId !== providerId ||
      approval.modelId !== (input.modelId ?? null) ||
      (approval.reasoningEffort ?? null) !== reasoningEffort
    )
      throw new ApiError('같은 작업 ID로 실행 내용을 변경할 수 없습니다.');
    return {
      replay: {
        ...ports.envelope(project, member),
        lease: project.job.id,
        taskPath: project.job.taskPath,
      },
    };
  }
  if (
    !approvalEditable(approval.status) ||
    approval.revision !== input.requestRevision
  )
    throw new ApiError(
      '요청 상태나 내용이 변경되었습니다. 최신 내용을 다시 확인해주세요.',
    );
  const plan = ports.plan(
    project,
    approval.request,
    providerId,
    typeof input.modelId === 'string' ? input.modelId : '',
    reasoningEffort,
  );
  if (!input.reviewToken || plan.reviewToken !== input.reviewToken)
    throw new ApiError(
      '요청의 입력 자료나 출력 대상이 변경되었습니다. 최신 내용을 다시 확인해주세요.',
    );
  return { approval, files: plan.files, taskPath: plan.taskPath };
}
