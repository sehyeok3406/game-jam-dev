import type { Project, Member } from '../project-state.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type { CodexRunEvent, HistoryEntry } from '../../shared.ts';
import { ApiError } from './errors.ts';
import { planAiResult } from './ai-result.ts';

type Ports = {
  clone: (project: Project) => Project;
  admin: (member: Member) => void;
  persist: (project: Project) => Promise<void>;
  envelope: (project: Project, member: Member) => CollaborationEnvelope;
  taskState: (files: Snapshot, relative: string, status: string) => Snapshot;
  recordChanges: (
    project: Project,
    member: Member,
    files: Snapshot,
    label: string,
    kind: HistoryEntry['kind'],
    extra: Partial<HistoryEntry>,
  ) => void;
  now: () => number;
  digest: (value: string) => string;
};
/** Existing project queue/actor/lifecycle gates remain at the caller. No process or HTTP ownership. */
export function createAiRunService(ports: Ports) {
  async function expire(project: Project) {
    if (!project.job || project.job.expiresAt > ports.now()) return project;
    const next = ports.clone(project),
      job = next.job!;
    const member = next.members.find((member) => member.id === job.memberId)!;
    next.lastRun = {
      ...job.event,
      status: 'failed',
      kind: 'error',
      message: 'AI 실행기 연결이 종료되어 결과를 반영하지 않았습니다.',
      timestamp: ports.now(),
    };
    ports.recordChanges(
      next,
      member,
      ports.taskState(next.files, job.taskPath, 'failed'),
      'AI 실행기 연결 종료',
      'ai',
      {
        status: 'failed',
        taskPath: job.taskPath,
        error: next.lastRun.message,
        modelId: job.modelId,
        reasoningEffort: job.reasoningEffort,
        providerId: job.providerId ?? 'codex-cli',
        createdAt: job.startedAt ?? job.event.timestamp,
      },
    );
    next.job = null;
    await ports.persist(next);
    return next;
  }

  async function cancelQueued(
    project: Project,
    member: Member,
    input: Record<string, unknown>,
  ) {
    ports.admin(member);
    const next = ports.clone(project);
    const task = next.aiQueue?.find((t) => t.taskId === input.taskId);
    if (!task) throw new ApiError('예약을 찾을 수 없습니다.', 404);
    if (task.status === 'cancelled') return ports.envelope(project, member);
    if (task.status !== 'queued')
      throw new ApiError('실행 중인 작업은 작업 중지를 사용해주세요.');
    task.status = 'cancelled';
    task.message = '예약을 취소했습니다.';
    task.updatedAt = ports.now();
    const approval = Object.values(next.approvals ?? {}).find(
      (a) => a.taskPath === task.taskPath && a.status === 'queued',
    );
    if (approval) {
      approval.status = 'stopped';
      approval.updatedAt = ports.now();
      approval.revision++;
      next.requestsVersion = (next.requestsVersion ?? 0) + 1;
    }
    next.lastRun = {
      ...task,
      kind: 'status',
      timestamp: task.updatedAt,
      message: task.message,
    };
    ports.recordChanges(
      next,
      member,
      ports.taskState(next.files, task.taskPath, 'cancelled'),
      'AI 예약 취소',
      'ai',
      {
        status: 'cancelled',
        taskPath: task.taskPath,
        providerId: task.providerId,
        modelId: task.modelId,
        reasoningEffort: task.reasoningEffort,
      },
    );
    await ports.persist(next);
    return ports.envelope(next, member);
  }
  async function update(
    project: Project,
    member: Member,
    action: string,
    input: Record<string, unknown>,
  ) {
    if (member.role === 'viewer')
      throw new ApiError('뷰어는 AI를 실행하거나 중지할 수 없습니다.', 403);
    const job = project.job;
    if (!job)
      throw new ApiError('AI 작업이 끝났거나 실행 권한이 만료되었습니다.');
    if (action === 'ai-cancel') {
      if (job.queueTaskId && input.runId !== job.event.runId)
        throw new ApiError('중지할 작업 ID를 지정해주세요.');
      if (member.role !== 'admin' && job.memberId !== member.id)
        throw new ApiError(
          '본인이 실행한 작업만 중지할 수 있습니다. 다른 작업은 관리자에게 요청해주세요.',
          403,
        );
      const next = ports.clone(project);
      next.lastRun = {
        ...job.event,
        status: 'cancelled',
        kind: 'status',
        message: `${member.nickname}님이 작업을 중지했습니다. 기존 결과를 유지합니다.`,
        timestamp: ports.now(),
      };
      ports.recordChanges(
        next,
        member,
        ports.taskState(next.files, job.taskPath, 'cancelled'),
        'AI 작업 중지',
        'ai',
        {
          status: 'cancelled',
          taskPath: job.taskPath,
          modelId: job.modelId,
          reasoningEffort: job.reasoningEffort,
          providerId: job.providerId ?? 'codex-cli',
          createdAt: job.startedAt ?? job.event.timestamp,
        },
      );
      next.job = null;
      await ports.persist(next);
      return ports.envelope(next, member);
    }
    if (job.memberId !== member.id || job.id !== input.lease)
      throw new ApiError('AI 실행 권한이 올바르지 않습니다.', 403);
    if (action === 'ai-heartbeat') {
      project.job!.expiresAt = ports.now() + 30000;
      return {};
    }
    if (action === 'ai-progress') {
      const status = input.status;
      if (!['starting', 'running', 'validating'].includes(String(status)))
        throw new ApiError('작업 상태가 올바르지 않습니다.');
      const next = ports.clone(project);
      next.job!.event = {
        ...job.event,
        status: status as CodexRunEvent['status'],
        message: `${member.nickname}님 · ${status === 'validating' ? '결과 검증 중' : 'AI 실행 중'}`,
        timestamp: ports.now(),
      };
      await ports.persist(next);
      return ports.envelope(next, member);
    }
    if (action === 'ai-finish') {
      const next = ports.clone(project);
      const { files, status, success, failure } = planAiResult(
        project,
        job,
        input,
        ports.now,
        ports.digest,
      );
      ports.recordChanges(
        next,
        member,
        files,
        success ? 'AI 결과 반영' : 'AI 작업 종료',
        'ai',
        {
          status,
          taskPath: job.taskPath,
          failure,
          createdAt: job.startedAt ?? job.event.timestamp,
          modelId: job.modelId,
          reasoningEffort: job.reasoningEffort,
          providerId: job.providerId ?? 'codex-cli',
        },
      );
      next.lastRun = {
        ...job.event,
        status,
        kind: success ? 'result' : 'status',
        message: success
          ? 'AI 결과를 공동 프로젝트에 반영했습니다.'
          : 'AI 작업이 종료되었습니다. 기존 결과를 유지합니다.',
        timestamp: ports.now(),
        failure,
      };
      next.job = null;
      await ports.persist(next);
      return ports.envelope(next, member);
    }
    throw new ApiError('지원하지 않는 AI 작업입니다.', 404);
  }
  return { expire, cancelQueued, update };
}
