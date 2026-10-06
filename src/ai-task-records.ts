import type { AiTaskRecord, CanvasDocument, HistoryEntry } from './shared';

export const isAiTaskPath = (path: string) =>
  /^\.ai\/tasks\/[^/\\]+\.md$/.test(path) && !path.split('/').includes('..');

export const isCanvasDocument = (doc: CanvasDocument) =>
  doc.type !== 'ai-task' && !isAiTaskPath(doc.relativePath) && !doc.htmlSource;

export function historyTaskPath(entry: HistoryEntry): string | undefined {
  return entry.taskPath && isAiTaskPath(entry.taskPath)
    ? entry.taskPath
    : entry.files.find((file) => isAiTaskPath(file.relativePath))?.relativePath;
}

/** Old servers can still supply their task documents through listDocuments. */
export function legacyTaskRecord(doc: CanvasDocument): AiTaskRecord {
  const paths = (heading: string) => {
    const section =
      doc.body.split(`## ${heading}\n`)[1]?.split(/\n## /)[0] ?? '';
    return [...section.matchAll(/^- `([^`\n]+)`\s*$/gm)].map(
      (match) => match[1],
    );
  };
  return {
    title: doc.title,
    specification: doc.body,
    inputs: paths('입력 문서'),
    outputs: paths('출력'),
    origin: 'legacy',
  };
}

export function entryTaskRecord(entry: HistoryEntry, tasks: CanvasDocument[]) {
  if (entry.aiTask) return entry.aiTask;
  const doc = tasks.find((doc) => doc.relativePath === historyTaskPath(entry));
  return doc ? legacyTaskRecord(doc) : undefined;
}

export function relatedAiEntries(
  entries: HistoryEntry[],
  path: string,
  tasks: CanvasDocument[] = [],
) {
  // Inputs are not results. Task creation is not an actual AI execution either.
  return entries.filter(
    (entry) =>
      entry.kind === 'ai' &&
      (entry.files.some((file) => file.relativePath === path) ||
        entryTaskRecord(entry, tasks)?.outputs.includes(path)),
  );
}
