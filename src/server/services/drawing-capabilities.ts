import type { Snapshot } from '../../contracts/project.ts';
import { isDrawingPath } from '../../drawing-model.ts';
import { ApiError } from './errors.ts';
/** Older clients cannot safely display or mutate partially erased strokes. */
export function assertEraseSupport(
  files: Snapshot,
  input: { drawingEraseVersion?: unknown; drawingTextVersion?: unknown },
) {
  if (
    input.drawingTextVersion !== 1 &&
    Object.entries(files).some(
      ([p, raw]) => isDrawingPath(p) && JSON.parse(raw).version === 3,
    )
  )
    throw new ApiError(
      '텍스트가 있는 프로젝트입니다. 앱을 업데이트해주세요.',
      409,
    );
  if (input.drawingEraseVersion === 1) return;
  if (
    Object.entries(files).some(
      ([p, raw]) => isDrawingPath(p) && JSON.parse(raw).version >= 2,
    )
  )
    throw new ApiError(
      '부분 지우기가 있는 프로젝트입니다. 앱을 업데이트해주세요.',
      409,
    );
}
