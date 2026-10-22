import type { Project, Member } from '../project-state.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type { CodexRunEvent, HistoryEntry } from '../../shared.ts';
import type { GamejamApproval } from '../../contracts/gamejam-approval.ts';
import {
  createQueuedTask,
  nextQueuedTasks,
  queueTaskView,
  validateQueuedInputs,
  isQueuePending,
} from '../../ai-task-queue.ts';
import { isAiProvider, reasoningError } from '../../core/ai/catalog.ts';
import { CanvasError } from '../../app-errors.ts';
import { collaborationPath } from '../../collaboration-model.ts';
import { canvasId } from '../../canvas-sheets.ts';
import matter from '../../markdown.ts';
import { expectedArtifacts } from '../../ai-artifacts.ts';
import { taskDocumentFormat } from '../../document-format.ts';
import { documentBundleContract } from '../../document-bundle.ts';
import {
  taskFileLock,
  assertAiFilesUnlocked,
  aiLockedSnapshot,
} from '../../ai-file-lock.ts';
import { validateHtmlAnalysis } from '../../html-source.ts';
import { workflowStages, newOutputsAlreadyExist } from '../../task-plan.ts';
import { ApiError } from './errors.ts';
import {
  prepareApprovalExecution,
  type ApprovalPlanner,
} from './approval-execution.ts';

type Ports = {
  admin: (member: Member) => void;
  clone: (project: Project) => Project;
  persist: (project: Project) => Promise<void>;
  envelope: (project: Project, member: Member) => CollaborationEnvelope;
  plan: ApprovalPlanner;
  locks: (id: string) => ReadonlyMap<string, unknown>;
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
  id: () => string;
  secret: () => string;
  digest: (value: string) => string;
};
/** Start/reserve/claim workflow, called inside the existing authenticated project queue.
 * Process execution and running-job lifecycle stay outside this service.
 */
export function createAiCoordinator(ports: Ports) {
  async function start(
    project: Project,
    member: Member,
    action: 'ai-start' | 'requests-start' | 'ai-claim',
    input: Record<string, unknown>,
  ) {
    ports.admin(member);
    let claimed: import('../../ai-task-queue.ts').StoredAiQueueTask | undefined;
    if (action === 'ai-claim') {
      if (!/^[a-f0-9-]{36}$/.test(String(input.claimId)))
        throw new ApiError('실행 요청 ID가 올바르지 않습니다.', 400);
      if (project.job) {
        const own =
          project.job.queueTaskId === input.taskId &&
          project.job.memberId === member.id &&
          project.job.claimId === input.claimId;
        return {
          ...ports.envelope(project, member),
          lease: own ? project.job.id : null,
          runId: own ? project.job.event.runId : undefined,
        };
      }
      claimed = nextQueuedTasks(project.aiQueue ?? [])[0] as typeof claimed;
      if (!claimed || claimed.taskId !== input.taskId)
        return { ...ports.envelope(project, member), lease: null };
      if (claimed.reasoningEffort && input.aiReasoningVersion !== 1)
        throw new ApiError(
          '지정한 추론 수준으로 실행하려면 관리자 앱을 업데이트해주세요.',
        );
      try {
        validateQueuedInputs(claimed, project.files);
      } catch (error) {
        const next = ports.clone(project);
        const task = next.aiQueue!.find((t) => t.taskId === claimed!.taskId)!;
        task.status = 'failed';
        task.updatedAt = ports.now();
        task.message = (error as Error).message;
        next.lastRun = {
          ...task,
          kind: 'error',
          timestamp: task.updatedAt,
          message: task.message,
        };
        ports.recordChanges(
          next,
          member,
          ports.taskState(next.files, task.taskPath, 'failed'),
          'AI 예약 검증 실패',
          'ai',
          {
            status: 'failed',
            taskPath: task.taskPath,
            providerId: task.providerId,
            modelId: task.modelId,
            reasoningEffort: task.reasoningEffort,
          },
        );
        await ports.persist(next);
        return { ...ports.envelope(next, member), lease: null };
      }
      input.taskPath = claimed.taskPath;
      input.providerId = claimed.providerId;
      input.modelId = claimed.modelId;
      input.reasoningEffort = claimed.reasoningEffort;
    }
    const providerId = input.providerId ?? 'codex-cli';
    if (!isAiProvider(providerId))
      throw new CanvasError('GC-AI-009', '지원하지 않는 AI 제공자입니다.');
    if (
      input.modelId !== undefined &&
      input.modelId !== null &&
      (typeof input.modelId !== 'string' ||
        input.modelId.length > 128 ||
        (input.modelId && !/^[a-zA-Z0-9._:/-]+$/.test(input.modelId)))
    )
      throw new ApiError('AI 모델 ID가 올바르지 않습니다.', 400);
    const invalidReasoning = reasoningError(
      providerId,
      input.modelId as string | null,
      input.reasoningEffort,
    );
    if (invalidReasoning) throw new ApiError(invalidReasoning, 400);
    const reasoningEffort = (input.reasoningEffort ?? null) as
      | import('../../shared').AiReasoningEffort
      | null;
    if (action === 'ai-start' && input.queueVersion === 1) {
      const previous = project.aiQueue?.find(
        (t) => t.taskPath === input.taskPath,
      );
      if (previous) {
        if (
          previous.providerId !== providerId ||
          previous.modelId !== (input.modelId ?? null) ||
          (previous.reasoningEffort ?? null) !== reasoningEffort
        )
          throw new ApiError(
            '이미 등록한 작업의 실행 설정을 변경할 수 없습니다.',
          );
        return {
          ...ports.envelope(project, member),
          queuedTask: queueTaskView(previous),
        };
      }
    }
    if (
      action === 'ai-start' &&
      Object.values(project.approvals ?? {}).some(
        (r) => r.taskPath === input.taskPath,
      )
    )
      throw new ApiError(
        '이미 승인한 작업입니다. 새 요청으로 복사해 다시 시작해주세요.',
      );
    let approval: GamejamApproval | undefined;
    let workingFiles = project.files;
    if (action === 'requests-start') {
      const prepared = prepareApprovalExecution(
        { plan: ports.plan, envelope: ports.envelope },
        project,
        member,
        input,
        providerId,
        reasoningEffort,
      );
      if ('replay' in prepared) return prepared.replay;
      approval = prepared.approval;
      workingFiles = prepared.files;
      input.taskPath = prepared.taskPath;
    }
    if (project.job && input.queueVersion !== 1)
      throw new ApiError('이미 AI 작업이 진행 중입니다.');
    if (action === 'ai-start' && input.revision !== project.revision)
      throw new ApiError(
        'AI 실행 직전 문서가 변경되었습니다. 최신 내용을 확인하고 다시 실행해주세요.',
      );
    const taskPath = collaborationPath(input.taskPath);
    if (!taskPath.startsWith('.ai/tasks/') || !workingFiles[taskPath])
      throw new ApiError('AI 작업 명세를 찾을 수 없습니다.');
    if (
      canvasId(matter(workingFiles[taskPath]).data.canvas_id) !== 'default' &&
      input.canvasSheetsVersion !== 1
    )
      throw new ApiError(
        '여러 캔버스의 AI 작업에는 앱 v0.11.0 이상이 필요합니다.',
      );
    const outputs = expectedArtifacts(workingFiles[taskPath]);
    if (
      matter(workingFiles[taskPath]).data.multiplayer !== undefined &&
      input.multiplayerVersion !== 1
    )
      throw new ApiError(
        '[GC-MP-001] 멀티플레이 실행을 지원하는 앱으로 업데이트해주세요.',
      );
    if (
      taskDocumentFormat(workingFiles[taskPath]) &&
      input.documentOutputFormatVersion !== 1
    )
      throw new CanvasError(
        'GC-AI-004',
        '문서 출력 구성 실행을 지원하는 앱으로 업데이트해주세요.',
      );
    if (
      documentBundleContract(workingFiles[taskPath]) &&
      input.documentBundleVersion !== 1
    )
      throw new CanvasError(
        'GC-AI-004',
        '시스템별 문서 생성 실행을 지원하는 앱으로 업데이트해주세요.',
      );
    const fileLock = taskFileLock(workingFiles, taskPath);
    try {
      assertAiFilesUnlocked(fileLock, [...ports.locks(project.id).keys()]);
    } catch {
      throw new ApiError(
        'AI 작업 관련 문서를 편집 중입니다. 해당 문서를 저장하고 편집을 종료한 뒤 실행해주세요.',
      );
    }
    validateHtmlAnalysis(workingFiles[taskPath], workingFiles);
    if (
      matter(workingFiles[taskPath]).data.html_inputs_version !== undefined &&
      input.htmlInputVersion !== 1
    )
      throw new CanvasError(
        'GC-AI-007',
        'HTML 재료 통합 실행에는 앱 v0.10.9 이상이 필요합니다.',
      );
    if (
      matter(workingFiles[taskPath]).data.source_mode === 'html' &&
      input.htmlAnalysisVersion !== 1
    )
      throw new CanvasError(
        'GC-AI-007',
        'HTML 분석 실행에는 관리자 앱 v0.7.10 이상이 필요합니다.',
      );
    if (
      workflowStages(workingFiles[taskPath]).length &&
      input.gamejamVersion !== 1
    )
      throw new ApiError(
        '이 연속 작업은 관리자 앱 v0.7.9 이상에서 실행해주세요.',
      );
    if (newOutputsAlreadyExist(workingFiles[taskPath], workingFiles))
      throw new ApiError('이미 생성된 새 버전입니다. 새 작업을 만들어주세요.');
    if (input.queueVersion === 1 && action !== 'ai-claim') {
      const existing = project.aiQueue?.find((t) => t.taskPath === taskPath);
      if (existing) {
        if (
          existing.providerId !== providerId ||
          existing.modelId !== (input.modelId ?? null) ||
          (existing.reasoningEffort ?? null) !== reasoningEffort
        )
          throw new ApiError(
            '이미 등록한 작업의 실행 설정을 변경할 수 없습니다.',
          );
        return {
          ...ports.envelope(project, member),
          queuedTask: queueTaskView(existing),
        };
      }
      const next = ports.clone(project);
      const queuedFiles = ports.taskState(workingFiles, taskPath, 'queued');
      const task = createQueuedTask(
        queuedFiles,
        {
          taskPath,
          providerId,
          modelId: (input.modelId as string) || null,
          reasoningEffort,
          actorId: member.id,
          title: String(matter(workingFiles[taskPath]).data.title ?? taskPath),
        },
        ports.id(),
        next.aiQueue ?? [],
      );
      if (
        project.job &&
        !(project.aiQueue ?? []).some(
          (t) => t.runId === project.job!.event.runId,
        )
      ) {
        const active = createQueuedTask(
          project.files,
          {
            taskPath: project.job.taskPath,
            providerId: project.job.providerId ?? 'codex-cli',
            modelId: project.job.modelId ?? null,
            reasoningEffort: project.job.reasoningEffort,
          },
          project.job.event.runId,
          [],
        );
        createQueuedTask(queuedFiles, task, task.taskId, [active]);
      }
      ports.recordChanges(next, member, queuedFiles, 'AI 작업 예약', 'ai', {
        status: 'queued',
        taskPath,
        providerId,
        modelId: task.modelId,
        reasoningEffort: task.reasoningEffort,
      });
      (next.aiQueue ??= []).push(task);
      if (approval) {
        const item = next.approvals![approval.id];
        Object.assign(item, {
          status: 'queued',
          approvedRevision: item.revision,
          approvedBy: member.id,
          approvedName: member.nickname,
          approvedAt: ports.now(),
          updatedAt: ports.now(),
          executionRequest: structuredClone(item.request),
          approvalCommandId: String(input.commandId),
          approvedReviewToken: String(input.reviewToken),
          runId: task.runId,
          taskPath,
          providerId,
          modelId: task.modelId,
          reasoningEffort: task.reasoningEffort,
          outputs,
        });
        item.revision++;
        item.changes.push({
          at: item.updatedAt,
          actorId: member.id,
          actorName: member.nickname,
          action: 'approved',
          revision: item.revision,
        });
        next.requestsVersion = (next.requestsVersion ?? 0) + 1;
      }
      await ports.persist(next);
      return {
        ...ports.envelope(next, member),
        queuedTask: queueTaskView(task),
      };
    }
    if (!claimed && (project.aiQueue ?? []).some(isQueuePending))
      throw new ApiError(
        '예약된 AI 작업이 있습니다. 예약 실행을 지원하는 앱을 사용해주세요.',
      );
    const next = ports.clone(project),
      runId = claimed?.runId ?? ports.id();
    ports.recordChanges(
      next,
      member,
      ports.taskState(workingFiles, taskPath, 'running'),
      'AI 작업 시작',
      'ai',
      {
        status: 'starting',
        providerId,
        reasoningEffort,
        taskPath,
        modelId:
          typeof input.modelId === 'string'
            ? input.modelId.slice(0, 128)
            : null,
      },
    );
    const event: CodexRunEvent = {
      providerId,
      reasoningEffort,
      modelId:
        typeof input.modelId === 'string' ? input.modelId.slice(0, 128) : null,
      actorId: member.id,
      runId,
      taskPath,
      status: 'starting',
      kind: 'status',
      message: `${member.nickname}님이 AI 작업을 시작했습니다. 작업 관련 파일만 보호합니다.`,
      fileLock,
      timestamp: ports.now(),
    };
    next.job = {
      claimId: claimed ? String(input.claimId) : undefined,
      queueTaskId: claimed?.taskId,
      requestId: approval?.id,
      fileLock,
      providerId,
      reasoningEffort,
      startedAt: ports.now(),
      modelId:
        typeof input.modelId === 'string' ? input.modelId.slice(0, 128) : null,
      id: ports.secret(),
      memberId: member.id,
      taskPath,
      outputs,
      revision: project.revision,
      baselineHash: ports.digest(
        JSON.stringify(aiLockedSnapshot(next.files, fileLock)),
      ),
      expiresAt: ports.now() + 30000,
      event,
    };
    if (approval) {
      const item = next.approvals![approval.id];
      item.status = 'running';
      item.approvedRevision = item.revision;
      item.approvedBy = member.id;
      item.approvedName = member.nickname;
      item.approvedAt = ports.now();
      item.updatedAt = item.approvedAt;
      item.executionRequest = structuredClone(item.request);
      item.approvalCommandId = String(input.commandId);
      item.approvedReviewToken = String(input.reviewToken);
      item.runId = runId;
      item.taskPath = taskPath;
      item.providerId = providerId;
      item.modelId = next.job.modelId;
      item.reasoningEffort = next.job.reasoningEffort;
      item.outputs = outputs;
      item.revision++;
      item.changes.push({
        at: item.updatedAt,
        actorId: member.id,
        actorName: member.nickname,
        action: 'approved',
        revision: item.revision,
      });
      next.requestsVersion = (next.requestsVersion ?? 0) + 1;
    }
    if (claimed) {
      const item = Object.values(next.approvals ?? {}).find(
        (a) => a.taskPath === taskPath && a.status === 'queued',
      );
      if (item) {
        item.status = 'running';
        item.revision++;
        next.requestsVersion = (next.requestsVersion ?? 0) + 1;
      }
    }
    await ports.persist(next);
    return {
      ...ports.envelope(next, member),
      lease: next.job.id,
      taskPath,
      runId,
    };
  }
  return { start };
}
