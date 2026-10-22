import {
  approvalEditable,
  parseApprovalRequest,
  type GamejamApproval,
  type ApprovalDetail,
} from '../../gamejam-approval.ts';
import type { GamejamRequest } from '../../contracts/gamejam-request.ts';
import type { Project, Member } from '../project-state.ts';
import { ApiError } from './errors.ts';

type Ports = {
  admin: (member: Member) => void;
  clone: (project: Project) => Project;
  persist: (project: Project) => Promise<void>;
  now: () => number;
  digest: (value: string) => string;
  plan: (
    project: Project,
    request: GamejamRequest,
  ) => { reviewToken: string; outputs: string[] };
};
/** Called inside the project queue with current state and its authenticated actor.
 * Execution approval/start remains in the AI coordinator path.
 */
export function createApprovalService(ports: Ports) {
  async function execute(
    project: Project,
    member: Member,
    action: string,
    input: Record<string, unknown>,
  ) {
    const items = project.approvals ?? {};
    if (action === 'requests-list')
      return {
        items: Object.values(items).sort((a, b) => b.updatedAt - a.updatedAt),
        version: project.requestsVersion ?? 0,
      };
    if (action === 'requests-read') {
      const item = items[String(input.id)];
      if (!item) throw new ApiError('요청을 찾을 수 없습니다.', 404);
      const detail: ApprovalDetail = {
        item,
        reviewToken: null,
        outputs: item.outputs ?? [],
      };
      if (approvalEditable(item.status)) {
        try {
          const plan = ports.plan(project, item.request);
          detail.reviewToken = plan.reviewToken;
          detail.outputs = plan.outputs;
        } catch (error) {
          detail.reviewError =
            error instanceof Error
              ? error.message
              : '입력 자료를 확인해주세요.';
        }
      }
      return detail;
    }
    if (member.role === 'viewer')
      throw new ApiError('뷰어는 요청을 변경할 수 없습니다.', 403);
    if (action === 'requests-feedback') ports.admin(member);
    const commandId = String(input.commandId ?? '');
    if (!/^[a-f0-9-]{36}$/.test(commandId))
      throw new ApiError('요청 작업 ID가 올바르지 않습니다.', 400);
    const fingerprint = ports.digest(
      JSON.stringify({
        action,
        id: input.id,
        revision: input.revision,
        request: input.request,
        message: input.message,
        copiedFrom: input.copiedFrom,
      }),
    );
    const receipt = project.approvalReceipts?.[commandId];
    if (receipt) {
      if (receipt.memberId !== member.id || receipt.fingerprint !== fingerprint)
        throw new ApiError('이미 사용한 작업 ID입니다.');
      return items[receipt.requestId];
    }
    const next = ports.clone(project);
    const at = ports.now();
    let item: GamejamApproval;
    if (action === 'requests-create') {
      if (items[commandId])
        throw new ApiError('이미 등록된 요청입니다. 최신 요청을 확인해주세요.');
      if (Object.keys(items).length >= 1000)
        throw new ApiError('프로젝트 요청 보관 한도에 도달했습니다.');
      const request = parseApprovalRequest(input.request);
      ports.plan(project, request);
      item = {
        id: commandId,
        projectId: project.id,
        authorId: member.id,
        authorName: member.nickname,
        createdAt: at,
        updatedAt: at,
        revision: 1,
        status: 'pending',
        request,
        changes: [],
      };
      if (typeof input.copiedFrom === 'string' && items[input.copiedFrom])
        item.copiedFrom = input.copiedFrom;
      next.approvals![item.id] = item;
    } else {
      item = next.approvals![String(input.id)];
      if (!item) throw new ApiError('요청을 찾을 수 없습니다.', 404);
      if (action !== 'requests-feedback' && item.authorId !== member.id)
        throw new ApiError('본인 요청만 변경할 수 있습니다.', 403);
      if (!approvalEditable(item.status))
        throw new ApiError(
          '이미 구현이 시작되었거나 종료된 요청입니다. 작성 내용은 새 요청으로 등록해주세요.',
        );
      if (input.revision !== item.revision)
        throw new ApiError(
          '요청 내용이 변경되었습니다. 최신 내용을 다시 확인해주세요.',
        );
      if (action === 'requests-update') {
        const request = parseApprovalRequest(input.request);
        ports.plan(project, request);
        item.request = request;
        item.status = 'pending';
      } else if (action === 'requests-cancel') item.status = 'cancelled';
      else if (action === 'requests-feedback') {
        if (
          typeof input.message !== 'string' ||
          !input.message.trim() ||
          input.message.length > 4000
        )
          throw new ApiError('보완 의견을 1~4000자로 작성해주세요.', 400);
        item.feedback = input.message.trim();
        item.status = 'feedback';
      } else throw new ApiError('지원하지 않는 요청 작업입니다.', 404);
      item.revision++;
      item.updatedAt = at;
    }
    item.changes.push({
      at,
      actorId: member.id,
      actorName: member.nickname,
      action,
      revision: item.revision,
      ...(action === 'requests-create' || action === 'requests-update'
        ? { request: structuredClone(item.request) }
        : {}),
      ...(action === 'requests-feedback' ? { message: item.feedback } : {}),
    });
    next.requestsVersion = (next.requestsVersion ?? 0) + 1;
    next.approvalReceipts![commandId] = {
      memberId: member.id,
      fingerprint,
      requestId: item.id,
    };
    const keys = Object.keys(next.approvalReceipts!);
    for (const key of keys.slice(0, Math.max(0, keys.length - 2000)))
      delete next.approvalReceipts![key];
    await ports.persist(next);
    return item;
  }
  return { execute };
}
