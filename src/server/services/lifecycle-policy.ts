import type { Project } from '../project-state.ts';
import { ApiError } from './errors.ts';
export const projectLifecycle = (project: Project) => ({
  projectId: project.id,
  name: project.name,
  status: project.lifecycle?.status ?? 'active',
  version: project.lifecycle?.version ?? 0,
  expiresAt: project.lifecycle?.expiresAt,
  error: project.lifecycle?.error,
});
export const assertProjectActive = (project: Project) => {
  if (!project.lifecycle || project.lifecycle.status === 'active') return;
  const error = new ApiError(
    '관리자가 공동 프로젝트를 삭제했습니다. 이 PC의 작업은 보관됩니다.',
    410,
  );
  error.code = 'PROJECT_TRASHED';
  error.lifecycle = projectLifecycle(project);
  throw error;
};
export const unavailableProject = (
  id: string,
  tombstone: number | undefined,
  marker?: { status: string; version: number },
): never => {
  const removed = tombstone || marker?.status === 'purged';
  const error = new ApiError(
    '프로젝트를 찾을 수 없습니다.',
    removed ? 410 : 404,
  );
  if (removed) {
    error.code = 'PROJECT_PURGED';
    error.lifecycle = {
      projectId: id,
      status: 'purged',
      version: tombstone ?? marker?.version,
    };
  }
  throw error;
};
