import matter from './markdown.ts';
import type { AiTaskRecord, HistoryEntry } from './shared';
import { historyTaskPath } from './ai-task-records.ts';
import { resolveTaskArtifacts } from './document-bundle.ts';

/** Store a small read-only execution specification, not another canvas object. */
export function taskHistoryRecord(
  raw: string | undefined,
  origin: AiTaskRecord['origin'] = 'snapshot',
): AiTaskRecord | undefined {
  if (!raw) return undefined;
  try {
    const { data, content } = matter(raw);
    if (data.type !== 'ai-task') return undefined;
    const paths = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((path): path is string => typeof path === 'string')
        : [];
    return {
      title: typeof data.title === 'string' ? data.title : 'AI 작업',
      specification: content,
      inputs: paths(data.inputs),
      outputs: paths(data.expected_outputs),
      origin,
    };
  } catch {
    // A malformed old task must not make all project history inaccessible.
    return undefined;
  }
}

export function withTaskHistory(
  entry: HistoryEntry,
  before: Record<string, string>,
  after: Record<string, string>,
): HistoryEntry {
  if (entry.aiTask) return entry;
  const taskPath = historyTaskPath(entry);
  const aiTask = taskPath
    ? taskHistoryRecord(after[taskPath] ?? before[taskPath])
    : undefined;
  if (aiTask && taskPath) {
    try {
      aiTask.outputs = resolveTaskArtifacts(
        after[taskPath] ?? before[taskPath],
        { ...before, ...after },
      );
    } catch {
      /* Incomplete/failed runs retain the frozen required outputs. */
    }
  }
  return aiTask ? { ...entry, aiTask } : entry;
}
