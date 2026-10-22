import type { Project } from '../project-state.ts';
import { withTaskHistory, taskHistoryRecord } from '../../ai-task-history.ts';
import { historyTaskPath } from '../../ai-task-records.ts';
import { collaborationPath } from '../../collaboration-model.ts';
import { ApiError } from './errors.ts';
export function listProjectHistory(project: Project) {
  return project.history
    .map((record) => {
      const entry = withTaskHistory(record.entry, record.before, record.after);
      const taskPath = historyTaskPath(entry);
      if (taskPath && !entry.aiTask?.requestSnapshot) {
        const frozen = project.history.find((item) => item.after[taskPath])
          ?.after[taskPath];
        const aiTask = taskHistoryRecord(
          frozen ?? project.files[taskPath],
          frozen ? 'snapshot' : 'legacy',
        );
        if (aiTask)
          return {
            ...entry,
            aiTask: entry.aiTask
              ? {
                  ...entry.aiTask,
                  requestSnapshot: aiTask.requestSnapshot,
                }
              : aiTask,
          };
      }
      return entry;
    })
    .reverse();
}
export function readProjectHistory(
  project: Project,
  input: Record<string, unknown>,
) {
  const item = project.history.find((record) => record.entry.id === input.id);
  if (!item || !['before', 'after'].includes(String(input.version)))
    throw new ApiError('기록을 찾을 수 없습니다.');
  return (
    item[input.version as 'before' | 'after'][
      collaborationPath(input.relativePath)
    ] ?? null
  );
}
