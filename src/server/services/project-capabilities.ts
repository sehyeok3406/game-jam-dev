import type { Project, Member } from '../project-state.ts';
import { DOCUMENT_STATUSES_PATH } from '../../document-statuses.ts';
import { KANBAN_VIEW_PATH } from '../../features/kanban/view.ts';
import { workflowDocuments } from '../../document-statuses-storage.ts';
import { isGameUiPath } from '../../game-ui-model.ts';
import { isDrawingPath } from '../../drawing-model.ts';
import { ApiError } from './errors.ts';
export function assertLifecycleVersion(
  project: Project,
  action: string,
  input: Record<string, unknown>,
) {
  if (
    action !== 'state' &&
    (project.lifecycle?.version ?? 0) > 0 &&
    input.lifecycleVersion !== project.lifecycle!.version
  ) {
    const error = new ApiError(
      '프로젝트가 복원되었습니다. 최신 상태를 확인한 뒤 작업을 재개해주세요.',
    );
    error.code = 'PROJECT_LIFECYCLE_CHANGED';
    throw error;
  }
}
export function assertProjectCapabilities(
  project: Project,
  member: Member,
  action: string,
  input: Record<string, unknown>,
  admin: (m: Member) => void,
) {
  if (
    Object.keys(project.files).some(isGameUiPath) &&
    ![
      'state',
      'leave',
      'history',
      'history-read',
      'lock',
      'unlock',
      'ai-heartbeat',
      'ai-event',
      'ai-cancel',
    ].includes(action) &&
    input.gameUiVersion !== 2
  )
    throw new ApiError(
      '게임 UI가 있는 프로젝트입니다. 앱을 업데이트해주세요.',
      409,
    );
  if (['rename', 'role', 'invite', 'restore'].includes(action)) admin(member);
  if (
    Object.keys(project.files).some(isDrawingPath) &&
    ![
      'state',
      'leave',
      'history',
      'history-read',
      'lock',
      'unlock',
      'ai-heartbeat',
      'ai-event',
      'ai-cancel',
    ].includes(action) &&
    input.drawingsVersion !== 1
  )
    throw new ApiError(
      '그림이 있는 프로젝트입니다. 앱을 업데이트해주세요.',
      409,
    );
  if (
    project.propertySync &&
    ![
      'state',
      'leave',
      'history',
      'history-read',
      'lock',
      'unlock',
      'ai-heartbeat',
      'ai-event',
      'ai-finish',
      'ai-cancel',
    ].includes(action) &&
    input.propertySyncVersion !== 1 &&
    input.syncClientVersion !== 1
  )
    throw new ApiError(
      '속성별 동기화를 사용하는 프로젝트입니다. 앱을 v0.12.0 이상으로 업데이트해주세요.',
    );
  if (
    project.files[DOCUMENT_STATUSES_PATH] &&
    ![
      'state',
      'leave',
      'history',
      'history-read',
      'unlock',
      'ai-heartbeat',
      'ai-event',
      'ai-cancel',
    ].includes(action) &&
    input.documentStatusesVersion !== 1
  )
    throw new ApiError(
      '문서 상태가 있는 프로젝트입니다. 앱을 업데이트해주세요.',
      409,
    );
  if (
    (project.files[KANBAN_VIEW_PATH] ||
      workflowDocuments(project.files).some(
        (d) => d.statusPropertyEnabled !== undefined,
      )) &&
    ![
      'state',
      'leave',
      'history',
      'history-read',
      'unlock',
      'ai-heartbeat',
      'ai-event',
      'ai-cancel',
    ].includes(action) &&
    input.filePropertiesVersion !== 1
  )
    throw new ApiError(
      '파일 속성이 있는 프로젝트입니다. 앱을 업데이트해주세요.',
      409,
    );
}
