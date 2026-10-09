import type { GamejamRequest } from './gamejam-request';
import type {
  AiProviderId,
  CollaborationState,
  CodexConnectionStatus,
} from './shared';
import { resultName } from './result-name.ts';
import { taskInstructions } from './task-instructions.ts';

export type GamejamField =
  | 'steps'
  | 'name'
  | 'organize'
  | 'implement'
  | 'html-result'
  | 'connection'
  | 'model'
  | 'status';
export type GamejamIssue = { field: GamejamField; message: string };
export type GamejamValidationContext = {
  collaboration: CollaborationState;
  provider: AiProviderId;
  model: string;
  connection: CodexConnectionStatus | null;
  checkingConnection: boolean;
  aiBusy: boolean;
  locked: boolean;
  updateRestarting: boolean;
};

/** The execution guard and visible feedback use the same conditions. */
export function gamejamIssues(
  request: GamejamRequest,
  context: GamejamValidationContext,
): GamejamIssue[] {
  const issues: GamejamIssue[] = [];
  const add = (field: GamejamField, message: string) =>
    issues.push({ field, message });
  if (!request.organize && !request.implement)
    add('steps', '문서 정리 또는 HTML 구현을 하나 이상 선택해주세요.');
  try {
    resultName(request.resultName);
  } catch (error) {
    add(
      'name',
      error instanceof Error ? error.message : '결과 이름을 확인해주세요.',
    );
  }
  for (const kind of ['organize', 'implement'] as const) {
    if (!request[kind]) continue;
    try {
      taskInstructions(kind, request.instructions[kind]);
    } catch (error) {
      add(
        kind,
        error instanceof Error ? error.message : '작업 지시를 확인해주세요.',
      );
    }
  }
  if (
    request.sourceMode &&
    request.implement &&
    request.htmlResult?.mode === 'update' &&
    request.inputPaths.includes(
      request.htmlResult.basePath ?? 'output/index.html',
    )
  ) {
    add(
      'html-result',
      '재료로 선택한 원본 HTML은 덮어쓸 수 없습니다. 새 버전을 선택하거나 다른 결과를 업데이트해주세요.',
    );
  }
  if (
    context.model.trim() &&
    (context.model.trim().length > 128 ||
      !/^[a-zA-Z0-9._:/-]+$/.test(context.model.trim()))
  ) {
    add(
      'model',
      '모델 ID는 128자 이하의 영문·숫자·점·밑줄·콜론·슬래시·하이픈으로 입력해주세요. 비우면 기본 모델을 사용합니다.',
    );
  }
  const shared = context.collaboration;
  if (context.updateRestarting)
    add('status', '앱 업데이트를 위한 재시작을 준비하고 있습니다.');
  if (context.aiBusy)
    add(
      'status',
      '이 프로젝트에서 AI 작업이 진행 중입니다. 완료하거나 중지한 뒤 실행해주세요.',
    );
  if (shared.active) {
    if (!shared.connected)
      add(
        'connection',
        '협업 서버에 연결되어 있지 않습니다. 재연결한 뒤 실행해주세요.',
      );
    if (shared.pendingChanges)
      add(
        'connection',
        '아직 서버에 반영하지 못한 변경이 있습니다. 동기화가 끝난 뒤 실행해주세요.',
      );
    if (shared.accessDenied)
      add(
        'connection',
        '프로젝트 접근 권한이 없습니다. 관리자에게 참여 권한을 확인해주세요.',
      );
    else if (
      shared.role !== 'admin' &&
      !(shared.role === 'editor' && shared.editorAi)
    ) {
      add(
        'connection',
        shared.role === 'editor'
          ? '편집자의 AI 실행 권한이 꺼져 있습니다. 관리자에게 AI 실행 권한을 요청해주세요.'
          : '현재 역할은 AI 작업을 실행할 수 없습니다. 관리자 또는 AI 실행 권한이 있는 편집자로 참여해주세요.',
      );
    }
    if (request.implement && !shared.htmlResultFolders)
      add('connection', 'HTML 구현에는 협업 서버 v0.8.1 이상이 필요합니다.');
    if (
      (request.sourceMode === 'html-compose' ||
        (request.sourceMode === 'html' && request.implement)) &&
      !shared.htmlComposition
    ) {
      add(
        'connection',
        'HTML을 구현 재료로 사용하려면 협업 서버 v0.10.9 이상으로 업데이트해주세요.',
      );
    }
    if (request.sourceMode === 'html' && !shared.htmlImportAnalysis)
      add('connection', 'HTML 분석에는 협업 서버 v0.7.10 이상이 필요합니다.');
    if (request.organize && request.implement && !shared.gamejamWorkflow)
      add(
        'connection',
        '문서 정리와 HTML 구현의 연속 실행에는 협업 서버 v0.7.9 이상이 필요합니다. 한 단계만 선택해도 됩니다.',
      );
    if (request.resultName.trim() && !shared.taskResultNaming)
      add(
        'name',
        '결과 이름을 사용하려면 협업 서버 v0.7.7 이상으로 업데이트하거나 이름을 비워주세요.',
      );
    if (!shared.taskInstructionsEditable)
      add(
        'connection',
        '작업 지시를 사용하려면 협업 서버 v0.7.5 이상으로 업데이트해주세요.',
      );
    if (context.provider !== 'codex-cli' && !shared.multiProviderAi)
      add(
        'connection',
        '선택한 AI 제공자를 지원하지 않는 협업 서버입니다. GPT · Codex를 선택하거나 서버를 업데이트해주세요.',
      );
  }
  if (
    context.locked &&
    !context.updateRestarting &&
    !context.aiBusy &&
    !issues.some((issue) => issue.field === 'connection')
  ) {
    add(
      'status',
      '현재 프로젝트가 잠겨 있어 실행할 수 없습니다. 편집 권한과 연결 상태를 확인해주세요.',
    );
  }
  if (context.checkingConnection)
    add(
      'connection',
      '선택한 AI의 연결을 확인하고 있습니다. 잠시 기다려주세요.',
    );
  else if (!context.connection?.available)
    add(
      'connection',
      context.connection?.message ||
        '선택한 AI CLI를 사용할 수 없습니다. AI 설정에서 설치와 연결 상태를 확인해주세요.',
    );
  else if (!context.connection.authenticated)
    add(
      'connection',
      context.connection.message ||
        '선택한 AI CLI에 로그인되어 있지 않습니다. 로그인한 뒤 연결을 다시 확인해주세요.',
    );
  return issues;
}

export const gamejamFieldId = (field: GamejamField) =>
  ({
    steps: 'ai-request-steps',
    name: 'ai-result-name',
    organize: 'ai-task-instructions-organize',
    implement: 'ai-task-instructions-implement',
    'html-result': 'ai-html-result',
    connection: 'ai-request-connection',
    model: 'ai-model-custom',
    status: 'ai-request-status',
  })[field];
export const gamejamErrorId = (field: GamejamField) => `ai-validation-${field}`;
