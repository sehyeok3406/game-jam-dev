import type { Snapshot } from '../../contracts/project.ts';
import { hasGameBuilds } from '../../core/projects/game-build.ts';
import { ApiError } from './errors.ts';

export function assertGameBuildStorageSupport(
  files: Snapshot,
  input: { gameBuildStorageVersion?: unknown },
) {
  if (hasGameBuilds(files) && input.gameBuildStorageVersion !== 1) {
    const error = new ApiError(
      '게임 제작 원본이 있는 프로젝트입니다. 앱을 업데이트해주세요.',
      409,
    );
    error.code = 'GAME_BUILD_STORAGE_UNSUPPORTED';
    throw error;
  }
}
