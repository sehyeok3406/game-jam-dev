import type { Project } from '../project-state.ts';
import { isQueuePending } from '../../ai-task-queue.ts';
/** Finalize queue/approval metadata on the persistence candidate, before commit. */
export function synchronizeAiState(project: Project, now: () => number) {
  for (const task of project.aiQueue ?? []) {
    const event =
      project.job?.queueTaskId === task.taskId
        ? project.job.event
        : project.lastRun?.runId === task.runId
          ? project.lastRun
          : null;
    if (event && isQueuePending(task)) {
      task.status = event.status;
      task.message = event.message;
      task.updatedAt = event.timestamp;
    }
    if (!isQueuePending(task)) task.baseline = {};
  }
  if (
    !project.job &&
    project.lastRun &&
    ['completed', 'failed', 'cancelled'].includes(project.lastRun.status)
  ) {
    const item = Object.values(project.approvals ?? {}).find(
      (r) =>
        (r.status === 'running' || r.status === 'queued') &&
        r.taskPath === project.lastRun!.taskPath,
    );
    if (item) {
      item.status =
        project.lastRun.status === 'cancelled'
          ? 'stopped'
          : (project.lastRun.status as 'completed' | 'failed');
      item.error =
        project.lastRun.failure?.message ??
        (item.status === 'completed' ? undefined : project.lastRun.message);
      item.updatedAt = now();
      item.revision++;
      item.changes.push({
        at: item.updatedAt,
        actorId: item.approvedBy!,
        actorName: item.approvedName!,
        action: item.status,
        revision: item.revision,
        message: item.error,
      });
      project.requestsVersion = (project.requestsVersion ?? 0) + 1;
    }
  }
}
