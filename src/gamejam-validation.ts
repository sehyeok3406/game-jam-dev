import type { GamejamRequest } from './gamejam-request';
import { multiplayerSettings } from './multiplayer/contract.ts';
import { isTextMaterial } from './canvas-text-materials.ts';
import type {
  AiProviderId,
  CollaborationState,
  CodexConnectionStatus,
} from './shared';
import { resultName } from './result-name.ts';
import { taskInstructions } from './task-instructions.ts';
import { documentTemplates } from './document-format.ts';
import { reasoningError, supportsSharedAiProvider } from './core/ai/catalog.ts';

export type GamejamField =
  | 'steps'
  | 'multiplayer'
  | 'name'
  | 'organize'
  | 'implement'
  | 'html-result'
  | 'document-format'
  | 'connection'
  | 'model'
  | 'reasoning'
  | 'status';
export type GamejamIssue = { field: GamejamField; message: string };
export type GamejamValidationContext = {
  intent?: 'run' | 'request' | 'content';
  collaboration: CollaborationState;
  provider: AiProviderId;
  model: string;
  reasoningEffort?: import('./shared').AiReasoningEffort | null;
  connection: CodexConnectionStatus | null;
  checkingConnection: boolean;
  aiBusy: boolean;
  queueSupported?: boolean;
  locked: boolean;
  updateRestarting: boolean;
  availableInputs?: string[];
  multiplayerChoiceRequired?: boolean;
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
  if (
    request.implement &&
    context.multiplayerChoiceRequired &&
    request.multiplayer === undefined
  )
    add(
      'multiplayer',
      '멀티 게임을 통합할 때는 온라인 모듈 추가 또는 개인 게임을 선택해주세요.',
    );
  try {
    multiplayerSettings(request.multiplayer);
  } catch (error) {
    add('multiplayer', (error as Error).message);
  }
  if (
    request.implement &&
    request.multiplayer !== undefined &&
    context.collaboration.active &&
    context.collaboration.multiplayerVersion !== 1
  )
    add(
      'multiplayer',
      '온라인 멀티 모듈을 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
    );
  if (!request.inputPaths.length)
    add('steps', '입력 자료를 하나 이상 선택해주세요.');
  if (
    context.collaboration.active &&
    request.inputPaths.some(isTextMaterial) &&
    context.collaboration.gamejamTextMaterialsVersion !== 1
  )
    add(
      'connection',
      '텍스트 재료를 사용하려면 협업 서버를 v0.35.4 이상으로 업데이트하고 다시 시작해주세요.',
    );
  if (context.availableInputs) {
    const missing = request.inputPaths.filter(
      (path) => !context.availableInputs!.includes(path),
    );
    if (missing.length)
      add(
        'steps',
        `이전 입력 자료를 찾을 수 없습니다. 입력 자료를 다시 선택해주세요: ${missing.join(', ')}`,
      );
  }
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
  if (request.organize && request.documentResult?.structure === 'custom') {
    try {
      documentTemplates(request.documentResult.documents);
    } catch (error) {
      add(
        'document-format',
        error instanceof Error
          ? error.message
          : '문서 출력 구성을 확인해주세요.',
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
  if (context.intent === 'content') return issues;
  if (context.intent === 'request') {
    const shared = context.collaboration;
    if (context.updateRestarting)
      add('status', '앱 재시작을 준비하고 있습니다.');
    if (!shared.connected)
      add('connection', '서버에 다시 연결한 뒤 요청을 저장해주세요.');
    if (shared.accessDenied || !['admin', 'editor'].includes(shared.role ?? ''))
      add('connection', '요청 작성에는 편집자 권한이 필요합니다.');
    if (shared.requestApprovalVersion !== 1)
      add(
        'connection',
        '요청 기능을 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
      );
    return issues;
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
  const invalidReasoning = reasoningError(
    context.provider,
    context.model,
    context.reasoningEffort,
  );
  if (invalidReasoning) add('reasoning', invalidReasoning);
  if (
    context.reasoningEffort &&
    context.connection?.supportsReasoningEffort === false
  )
    add('reasoning', '추론 수준을 지정하려면 Claude Code를 업데이트해주세요.');
  if (
    context.reasoningEffort &&
    shared.active &&
    shared.aiReasoningVersion !== 1
  )
    add(
      'reasoning',
      '추론 수준을 지정하려면 앱과 협업 서버를 함께 업데이트해주세요.',
    );
  if (context.updateRestarting)
    add('status', '앱 업데이트를 위한 재시작을 준비하고 있습니다.');
  if (context.aiBusy && !context.queueSupported)
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
    else if (shared.role !== 'admin') {
      add(
        'connection',
        shared.role === 'editor'
          ? '팀원은 요청하기로 등록해주세요. 관리자만 AI를 실행할 수 있습니다.'
          : '현재 역할은 AI 작업을 실행할 수 없습니다. 관리자 또는 AI 실행 권한이 있는 편집자로 참여해주세요.',
      );
    }
    if (request.implement && !shared.htmlResultFolders)
      add('connection', 'HTML 구현에는 협업 서버 v0.8.1 이상이 필요합니다.');
    if (
      request.organize &&
      request.documentResult?.structure === 'custom' &&
      !shared.documentOutputFormats
    )
      add(
        'connection',
        '문서 출력 구성을 편집하려면 앱과 협업 서버를 함께 업데이트해주세요.',
      );
    if (
      request.organize &&
      request.documentResult?.structure === 'systems' &&
      !shared.documentBundles
    )
      add(
        'connection',
        '시스템별 문서 생성을 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
      );
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
    if (!supportsSharedAiProvider(shared, context.provider))
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
    multiplayer: 'ai-multiplayer',
    name: 'ai-result-name',
    organize: 'ai-task-instructions-organize',
    implement: 'ai-task-instructions-implement',
    'html-result': 'ai-html-result',
    'document-format': 'ai-document-format',
    connection: 'ai-request-connection',
    model: 'ai-model-custom',
    reasoning: 'ai-reasoning-effort',
    status: 'ai-request-status',
  })[field];
export const gamejamErrorId = (field: GamejamField) => `ai-validation-${field}`;
