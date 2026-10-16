import {
  aiScopesOverlap,
  aiLockedSnapshot,
  changedAiFile,
  mergeAiFileLocks,
  taskFileScopes,
} from './ai-file-lock.ts';
import type { Snapshot } from './project-store.ts';
import type { AiFileLock, AiProviderId, CodexRunStatus } from './shared.ts';

export type AiQueueTask = {
  taskId: string;
  runId: string;
  taskPath: string;
  title: string;
  providerId: AiProviderId;
  modelId: string | null;
  status: CodexRunStatus;
  createdAt: number;
  updatedAt: number;
  actorId?: string;
  message?: string;
  fileLock: AiFileLock;
  readScope: AiFileLock;
  writeScope: AiFileLock;
};
export type StoredAiQueueTask = AiQueueTask & { baseline: Snapshot };
export const isQueuePending = (task: Pick<AiQueueTask, 'status'>) =>
  ['queued', 'starting', 'running', 'validating'].includes(task.status);
export const queueTaskView = ({
  baseline: _baseline,
  ...task
}: StoredAiQueueTask): AiQueueTask => task;
export const queueFileLock = (tasks: AiQueueTask[]) =>
  mergeAiFileLocks(tasks.filter(isQueuePending).map((t) => t.fileLock));
export const queueTasksConflict = (a: AiQueueTask, b: AiQueueTask) =>
  aiScopesOverlap(a.writeScope, b.fileLock) ||
  aiScopesOverlap(b.writeScope, a.fileLock);

export function createQueuedTask(
  files: Snapshot,
  input: Pick<AiQueueTask, 'taskPath' | 'providerId' | 'modelId'> & {
    title?: string;
    actorId?: string;
  },
  id: string,
  existing: AiQueueTask[],
  suppliedScopes?: ReturnType<typeof taskFileScopes>,
): StoredAiQueueTask {
  const scopes = suppliedScopes ?? taskFileScopes(files, input.taskPath);
  const task: StoredAiQueueTask = {
    ...input,
    title: input.title ?? input.taskPath.split('/').at(-1)!,
    taskId: id,
    runId: id,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fileLock: scopes.protectedScope,
    readScope: scopes.read,
    writeScope: scopes.write,
    baseline: aiLockedSnapshot(files, scopes.protectedScope),
    message: '예약됨 · 순서대로 실행합니다.',
  };
  const conflict = existing.find(
    (other) => isQueuePending(other) && queueTasksConflict(task, other),
  );
  if (conflict)
    throw new Error(
      `'${conflict.title}' 작업의 재료 또는 결과와 갱신 대상이 겹칩니다. 새 버전이나 다른 결과를 선택해주세요.`,
    );
  return task;
}

/** Pure scheduling policy; executors and storage do not assume a single slot. */
export function nextQueuedTasks(
  tasks: AiQueueTask[],
  maxConcurrentRuns = 1,
): AiQueueTask[] {
  const running = tasks.filter(
    (t) => isQueuePending(t) && t.status !== 'queued',
  );
  const selected: AiQueueTask[] = [];
  for (const task of tasks) {
    if (running.length + selected.length >= maxConcurrentRuns) break;
    if (task.status !== 'queued') continue;
    if (
      [...running, ...selected].some((other) => queueTasksConflict(task, other))
    )
      break;
    selected.push(task);
  }
  return selected;
}

export function validateQueuedInputs(task: StoredAiQueueTask, files: Snapshot) {
  const changed = changedAiFile(task.baseline, files, task.fileLock);
  if (changed)
    throw new Error(
      `예약 후 재료 또는 출력 대상이 변경되었습니다. 다시 요청해주세요: ${changed}`,
    );
}

export function materialUsage(tasks: AiQueueTask[], path: string) {
  const matches = tasks.filter(
    (task) =>
      isQueuePending(task) &&
      aiScopesOverlap(task.fileLock, { paths: [path], folders: [] }),
  );
  const queued = matches.filter((task) => task.status === 'queued').length;
  const running = matches.length - queued;
  return matches.length
    ? `${running ? `작업 중 ${running}` : ''}${running && queued ? ' · ' : ''}${queued ? `예약 ${queued}` : ''} · 편집 잠김`
    : '';
}
