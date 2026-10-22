import { ServerLimits } from '../../contracts/server-limits.ts';
import type { Snapshot } from '../../contracts/project.ts';
import { CANVAS_SHEETS_PATH } from '../../canvas-sheets.ts';
import { collaborationPath, checkSnapshot } from '../../collaboration-model.ts';
import { workflowOnlyChange } from '../../sync-properties.ts';
import { ApiError } from './errors.ts';

/** Prepare a snapshot without changing input files or publishing a partial batch. */
export function planOfflineChanges(
  files: Snapshot,
  input: Record<string, unknown>,
): Snapshot {
  if (
    !input.changes ||
    typeof input.changes !== 'object' ||
    Array.isArray(input.changes)
  )
    throw new ApiError('동기화 내용이 올바르지 않습니다.', 400);
  const nextFiles = { ...files };
  const changes = Object.entries(input.changes);
  if (!changes.length || changes.length > ServerLimits.files)
    throw new ApiError('동기화 파일 수가 올바르지 않습니다.', 400);
  for (const [key, value] of changes) {
    const relative = collaborationPath(key);
    if (
      relative === CANVAS_SHEETS_PATH ||
      relative.startsWith('.ai/tasks/') ||
      relative.startsWith('output/') ||
      (relative.startsWith('docs/html-sources/') &&
        !(
          typeof value === 'string' &&
          workflowOnlyChange(relative, files[relative], value)
        ))
    )
      throw new ApiError(
        'AI 실행 및 HTML 결과는 온라인에서만 변경할 수 있습니다.',
        403,
      );
    if (value === null) {
      delete nextFiles[relative];
    } else if (typeof value === 'string') nextFiles[relative] = value;
    else throw new ApiError('동기화 파일 내용이 올바르지 않습니다.', 400);
  }
  checkSnapshot(nextFiles);
  return nextFiles;
}
