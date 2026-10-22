import {
  approvalEditable,
  approvalDeletable,
  parseApprovalRequest,
  type GamejamApproval,
  type ApprovalDetail,
} from '../../gamejam-approval.ts';
import { captureApprovalDocuments } from '../../discord-review-documents.ts';
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
    if (action === 'requests-documents') {
      ports.admin(member);
      const item = items[String(input.id)];
      if (
        !item ||
        !approvalEditable(item.status) ||
        item.revision !== input.revision
      )
        throw new ApiError(
          '요청 상태나 내용이 변경되었습니다. 다시 검토해주세요.',
          409,
        );
      const plan = ports.plan(project, item.request);
      if (
        typeof input.reviewToken !== 'string' ||
        input.reviewToken !== plan.reviewToken
      )
        throw new ApiError(
          '입력 문서가 변경되었습니다. 다시 검토해주세요.',
          409,
        );
      return captureApprovalDocuments(item, project.files, plan.reviewToken);
    }
    const visible = (item: GamejamApproval): GamejamApproval =>
      item.status === 'deleted' && input.requestDeletionVersion !== 1
        ? {
            ...item,
            status: 'cancelled',
            feedback: `관리자가 삭제한 요청입니다. 삭제 이유: ${item.deletion?.reason ?? ''}`,
          }
        : item;
    if (action === 'requests-list')
      return {
        items: Object.values(items)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(visible),
        version: project.requestsVersion ?? 0,
      };
    if (action === 'requests-read') {
      const item = items[String(input.id)];
      if (!item) throw new ApiError('요청을 찾을 수 없습니다.', 404);
      const detail: ApprovalDetail = {
        item: visible(item),
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
    if (action === 'requests-feedback' || action === 'requests-delete')
      ports.admin(member);
    if (action === 'requests-delete' && input.requestDeletionVersion !== 1)
      throw new ApiError('요청 삭제를 사용하려면 앱을 업데이트해주세요.', 409);
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
      return visible(items[receipt.requestId]);
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
      if (
        !['requests-feedback', 'requests-delete'].includes(action) &&
        item.authorId !== member.id
      )
        throw new ApiError('본인 요청만 변경할 수 있습니다.', 403);
      if (
        action === 'requests-delete'
          ? !approvalDeletable(item.status)
          : !approvalEditable(item.status)
      )
        throw new ApiError(
          action === 'requests-delete'
            ? '예약·구현 중인 요청은 먼저 취소·중지해주세요. 이미 삭제된 요청은 다시 삭제할 수 없습니다.'
            : '이미 구현이 시작되었거나 종료된 요청입니다. 작성 내용은 새 요청으로 등록해주세요.',
        );
      if (input.revision !== item.revision)
        throw new ApiError(
          '요청 내용이 변경되었습니다. 최신 내용을 다시 확인해주세요.',
        );
      if (action === 'requests-delete') {
        if (
          typeof input.message !== 'string' ||
          !input.message.trim() ||
          input.message.trim().length > 1000
        )
          throw new ApiError('삭제 이유를 1~1000자로 작성해주세요.', 400);
        item.deletion = {
          reason: input.message.trim(),
          actorId: member.id,
          actorName: member.nickname,
          at,
          previousStatus: item.status as Exclude<
            GamejamApproval['status'],
            'deleted'
          >,
        };
        item.status = 'deleted';
      } else if (action === 'requests-update') {
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
      ...(action === 'requests-feedback'
        ? { message: item.feedback }
        : action === 'requests-delete'
          ? { message: item.deletion!.reason }
          : {}),
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
    return visible(item);
  }
  return { execute };
}
