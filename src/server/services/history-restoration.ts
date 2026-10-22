import type { Snapshot } from '../../contracts/project.ts';
import type { StoredHistory } from '../project-state.ts';
import { collaborationPath, checkSnapshot } from '../../collaboration-model.ts';
import { isAssetPath } from '../../file-assets.ts';
import { isImportedPreviewPath } from '../../preview-output.ts';
import { remapResultChanges } from '../../result-structure.ts';
import { ApiError } from './errors.ts';
/** Prepare a complete valid restoration without mutating current files. */
export function planHistoryRestoration(
  current: Snapshot,
  record: StoredHistory,
  input: Record<string, unknown>,
): Snapshot {
  const single = input.relativePath
    ? collaborationPath(input.relativePath)
    : null;
  if (
    single &&
    record.entry.files.some((file) => file.relativePath.startsWith('sections/'))
  )
    throw new ApiError('섹션 소속이 변경된 기록은 함께 복원해주세요.');
  if (
    single &&
    record.entry.files.some((file) => isAssetPath(file.relativePath))
  )
    throw new ApiError('이미지와 설명 문서는 전체 기록으로 함께 복원해주세요.');
  const version = input.version === 'after' ? 'after' : 'before';
  if (
    single &&
    record.entry.files.some((file) => isImportedPreviewPath(file.relativePath))
  )
    throw new ApiError(
      '불러온 HTML과 관리 문서는 전체 기록으로 함께 복원해주세요.',
    );
  const files = { ...current };
  const restoration: Record<string, string | null> = {};
  for (const file of record.entry.files.filter(
    (file) => !single || file.relativePath === single,
  )) {
    const value = record[version][file.relativePath];
    restoration[file.relativePath] = value ?? null;
  }
  for (const [key, value] of Object.entries(
    remapResultChanges(current, restoration),
  )) {
    if (value === null) delete files[key];
    else files[key] = value;
  }
  checkSnapshot(files);
  return files;
}
