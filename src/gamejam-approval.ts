import type { GamejamRequest } from './gamejam-request.ts';
import type { AiProviderId, CollaborationRole } from './shared.ts';
import { readSavedRequest } from './gamejam-history.ts';
import { gamejamIssues } from './gamejam-validation.ts';

export type ApprovalStatus =
  | 'pending'
  | 'feedback'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stopped';
export const APPROVAL_STATUS_NAMES: Record<ApprovalStatus, string> = {
  pending: '요청 대기',
  feedback: '보완 요청',
  running: '구현 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소',
  stopped: '중지',
};
export const approvalEditable = (status: ApprovalStatus) =>
  status === 'pending' || status === 'feedback';
export type ApprovalChange = {
  at: number;
  actorId: string;
  actorName: string;
  action: string;
  revision: number;
  request?: GamejamRequest;
  message?: string;
};
export type GamejamApproval = {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  status: ApprovalStatus;
  request: GamejamRequest;
  feedback?: string;
  copiedFrom?: string;
  approvedBy?: string;
  approvedName?: string;
  approvedAt?: number;
  approvedRevision?: number;
  executionRequest?: GamejamRequest;
  approvalCommandId?: string;
  runId?: string;
  taskPath?: string;
  approvedReviewToken?: string;
  providerId?: AiProviderId;
  modelId?: string | null;
  outputs?: string[];
  error?: string;
  changes: ApprovalChange[];
};
export type ApprovalDetail = {
  item: GamejamApproval;
  reviewToken: string | null;
  reviewError?: string;
  outputs: string[];
};
export type ApprovalMutation = {
  commandId: string;
  id?: string;
  revision?: number;
  request?: GamejamRequest;
  message?: string;
  copiedFrom?: string;
};
export type ApprovalStart = {
  id: string;
  revision: number;
  reviewToken: string;
  commandId: string;
};
export type ApprovalList = { items: GamejamApproval[]; version: number };
export const canSubmitApproval = (role?: CollaborationRole) =>
  role === 'admin' || role === 'editor';

type OperationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const operationKey = (scope: string) => `gamejam-approval-operation:${scope}`;
/** Preserve create identity across an acknowledgement lost before renderer restart. */
export function approvalOperationId(
  storage: OperationStorage,
  scope: string,
  signature: string,
  makeId = () => crypto.randomUUID(),
): string {
  let previous: { signature?: string; id?: string } | null = null;
  try {
    previous = JSON.parse(storage.getItem(operationKey(scope)) ?? 'null');
  } catch {
    /* Replace malformed storage. */
  }
  if (
    previous?.signature === signature &&
    typeof previous.id === 'string' &&
    /^[a-f0-9-]{36}$/.test(previous.id)
  )
    return previous.id;
  const id = makeId();
  try {
    storage.setItem(operationKey(scope), JSON.stringify({ signature, id }));
  } catch {
    throw new Error(
      '요청 전송 정보를 보관하지 못했습니다. 저장 공간을 확인한 뒤 다시 요청해주세요.',
    );
  }
  return id;
}
export function clearApprovalOperation(
  storage: OperationStorage,
  scope: string,
) {
  try {
    storage.removeItem(operationKey(scope));
  } catch {
    /* A later different request gets a different identity. */
  }
}

/** Shared requests contain no executor credentials or local AI configuration. */
export function parseApprovalRequest(value: unknown): GamejamRequest {
  const saved = readSavedRequest({
    version: 1,
    request: value,
    providerId: 'codex-cli',
    modelId: '',
  });
  if (
    !saved ||
    !Number.isFinite(saved.request.x) ||
    !Number.isFinite(saved.request.y) ||
    saved.request.inputPaths.length > 500 ||
    saved.request.inputPaths.some((p) => p.length > 1024) ||
    JSON.stringify(saved.request).length > 256_000
  )
    throw new Error('요청 내용이 올바르지 않습니다.');
  const issues = gamejamIssues(saved.request, {
    intent: 'content',
    collaboration: { active: false, connected: false, members: [], locks: [] },
    provider: 'codex-cli',
    model: '',
    connection: null,
    checkingConnection: false,
    aiBusy: false,
    locked: false,
    updateRestarting: false,
  });
  if (issues.length) throw new Error(issues[0].message);
  // Pick the contract explicitly: arbitrary client fields never enter shared metadata.
  const r = saved.request;
  return structuredClone({
    organize: r.organize,
    implement: r.implement,
    inputPaths: r.inputPaths,
    x: r.x,
    y: r.y,
    canvasId: r.canvasId,
    sourceMode: r.sourceMode,
    htmlResult: r.htmlResult,
    documentResult: r.documentResult,
    multiplayer: r.multiplayer,
    instructions: r.instructions,
    resultName: r.resultName,
  });
}
