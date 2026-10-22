import type {
  AiRunInput,
  AiRunStatus,
  AiFileLock,
} from '../../contracts/ai.ts';
import type { AiQueueTask } from '../../contracts/ai-task-queue.ts';
import type { Snapshot } from '../../contracts/project.ts';
import {
  createQueuedTask,
  nextQueuedTasks,
  validateQueuedInputs,
  type StoredAiQueueTask,
} from '../../ai-task-queue.ts';
import matter from '../../markdown.ts';

export interface AiQueueRepository {
  tasks: StoredAiQueueTask[];
  save(): Promise<unknown>;
}
export type ActiveAiReservation = Pick<
  AiQueueTask,
  'taskPath' | 'providerId' | 'modelId' | 'reasoningEffort' | 'runId'
> & { baseline: Snapshot };

/** Durable local reservations. Scheduling never starts a process before persistence. */
export class AiQueueService {
  private store: AiQueueRepository;
  private capture: () => Promise<Snapshot>;
  private id: () => string;
  private now: () => number;
  constructor(
    store: AiQueueRepository,
    capture: () => Promise<Snapshot>,
    id: () => string,
    now = Date.now,
  ) {
    this.store = store;
    this.capture = capture;
    this.id = id;
    this.now = now;
  }
  next() {
    return nextQueuedTasks(this.store.tasks)[0];
  }
  async reserve(input: AiRunInput, active: ActiveAiReservation[] = []) {
    const previous = this.store.tasks.find(
      (t) => t.taskPath === input.taskPath,
    );
    if (previous) {
      if (
        previous.providerId !== input.providerId ||
        previous.modelId !== input.modelId ||
        (previous.reasoningEffort ?? null) !== (input.reasoningEffort ?? null)
      )
        throw new Error('이미 등록한 작업의 실행 설정을 변경할 수 없습니다.');
      return previous;
    }
    const files = await this.capture();
    const task = createQueuedTask(
      files,
      {
        ...input,
        title: String(
          matter(files[input.taskPath] ?? '').data.title ?? input.taskPath,
        ),
      },
      this.id(),
      this.store.tasks,
    );
    for (const run of active) {
      if (this.store.tasks.some((t) => t.runId === run.runId)) continue;
      const legacy = createQueuedTask(run.baseline, run, run.runId, []);
      legacy.status = 'running';
      createQueuedTask(files, task, task.taskId, [legacy]);
    }
    this.store.tasks.push(task);
    try {
      await this.store.save();
    } catch (error) {
      this.store.tasks.splice(this.store.tasks.indexOf(task), 1);
      throw error;
    }
    return task;
  }
  async wait(task: AiQueueTask, message: string) {
    if (task.message === message) return false;
    task.message = message;
    await this.store.save();
    return true;
  }
  async start(taskId: string) {
    const task = this.store.tasks.find((t) => t.taskId === taskId);
    if (!task || task.status !== 'queued') return null;
    validateQueuedInputs(task, await this.capture());
    const previous = { status: task.status, updatedAt: task.updatedAt };
    task.status = 'starting';
    task.updatedAt = this.now();
    try {
      await this.store.save();
    } catch (error) {
      Object.assign(task, previous);
      throw error;
    }
    return task;
  }
  async finish(
    task: AiQueueTask,
    status: Extract<AiRunStatus, 'failed' | 'cancelled'>,
    message: string,
  ) {
    const previous = { ...task };
    Object.assign(task, { status, message, updatedAt: this.now() });
    try {
      await this.store.save();
    } catch (error) {
      Object.assign(task, previous);
      throw error;
    }
  }
}

export interface SharedAiClaimPort {
  state: {
    aiRun?: { runId: string; taskPath: string; fileLock?: AiFileLock } | null;
  };
  claimAi(
    taskId: string,
  ): Promise<{ files: Snapshot; lease: string | null; runId?: string }>;
  beginAi(
    taskPath: string,
    modelId: AiRunInput['modelId'],
    providerId: AiRunInput['providerId'],
    approval: AiRunInput['approval'],
    reasoningEffort: AiRunInput['reasoningEffort'],
  ): Promise<Snapshot>;
}

/** A lost claim is a no-op, never an unleased local run. The server owns authorization. */
export async function claimSharedAiRun(
  port: SharedAiClaimPort,
  input: AiRunInput,
  queuedTask?: AiQueueTask,
) {
  const claimed = queuedTask ? await port.claimAi(queuedTask.taskId) : null;
  if (queuedTask && !claimed?.lease) return null;
  const files =
    claimed?.files ??
    (await port.beginAi(
      input.taskPath,
      input.modelId,
      input.providerId,
      input.approval,
      input.reasoningEffort,
    ));
  return {
    files,
    runId: claimed?.runId ?? port.state.aiRun?.runId ?? null,
    taskPath: input.approval ? port.state.aiRun!.taskPath : input.taskPath,
    fileLock: input.approval ? (port.state.aiRun?.fileLock ?? null) : null,
  };
}
