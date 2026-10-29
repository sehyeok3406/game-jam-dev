import { createHash, timingSafeEqual } from 'node:crypto';
import type { Project, Member } from '../project-state.ts';
import { ApiError } from './errors.ts';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const secret = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new ApiError('전환 작업의 인증 정보가 올바르지 않습니다.', 400);
  return value;
};
const operation = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
    throw new ApiError('전환 작업 ID가 올바르지 않습니다.', 400);
  return value;
};
export const projectModeStamp = (p: Project) =>
  hash([p.revision, p.name, p.lifecycle, p.members, p.handover]);
export function assertRemainingAdmin(p: Project) {
  if (!p.members.some((m) => !m.removed && m.role === 'admin'))
    throw new ApiError(
      '공동 프로젝트에는 관리자가 최소 1명 있어야 합니다. 다른 참여자에게 관리자 권한을 넘겨주세요.',
      409,
    );
}
export function detachStatus(p: Project, input: Record<string, unknown>) {
  const id = operation(input.id),
    proof = hash(secret(input.proof));
  const receipt = p.detachReceipts?.[id];
  if (!receipt) return { committed: false };
  if (!timingSafeEqual(Buffer.from(proof), Buffer.from(receipt.proofHash)))
    throw new ApiError('전환 작업을 확인할 권한이 없습니다.', 403);
  return { committed: true };
}
type Ports = {
  persist(p: Project): Promise<void>;
  record(p: Project, m: Member, label: string): void;
  envelope(p: Project, m: Member): unknown;
  cleanup(projectId: string, memberId: string): void;
  id(): string;
};
export function createProjectModeService(ports: Ports) {
  return async (
    p: Project,
    m: Member,
    action: string,
    input: Record<string, unknown>,
  ) => {
    if (action === 'mode-snapshot')
      return {
        name: p.name,
        files: p.files,
        authorship: p.authorship,
        stamp: projectModeStamp(p),
      };
    const next = structuredClone(p);
    if (action === 'handover-prepare') {
      if (!m.owner)
        throw new ApiError('현재 소유자만 소유권을 인계할 수 있습니다.', 403);
      const target = next.members.find(
        (v) => !v.removed && v.id === input.successorId && v.id !== m.id,
      );
      if (!target)
        throw new ApiError('인계할 다른 참여자를 선택해주세요.', 400);
      next.handover = {
        id: ports.id(),
        from: m.id,
        to: target.id,
        accepted: false,
      };
    } else if (action === 'handover-accept') {
      if (
        !next.handover ||
        next.handover.to !== m.id ||
        next.handover.id !== input.id
      )
        throw new ApiError(
          '소유권 인계 요청이 바뀌었습니다. 다시 확인해주세요.',
          409,
        );
      next.handover.recoveryHash = createHash('sha256')
        .update(secret(input.recoveryKey))
        .digest('hex');
      next.handover.accepted = true;
    } else if (action === 'handover-cancel') {
      if (!m.owner)
        throw new ApiError('현재 소유자만 인계를 취소할 수 있습니다.', 403);
      delete next.handover;
    } else if (action === 'detach') {
      const id = operation(input.id);
      secret(input.proof);
      if (input.stamp !== projectModeStamp(p))
        throw new ApiError(
          '공동 자료나 참여자 상태가 바뀌었습니다. 최신 내용을 확인한 뒤 다시 전환해주세요.',
          409,
        );
      if (
        p.job?.memberId === m.id ||
        p.aiQueue?.some(
          (job) =>
            job.actorId === m.id &&
            ['queued', 'starting', 'running', 'validating'].includes(
              job.status,
            ),
        )
      )
        throw new ApiError(
          '내 AI 작업을 완료하거나 취소한 뒤 전환해주세요.',
          409,
        );
      const self = next.members.find((v) => v.id === m.id)!;
      const target = next.members.find(
        (v) => !v.removed && v.id === input.successorId && v.id !== m.id,
      );
      if (m.owner) {
        if (
          !target ||
          !next.handover?.accepted ||
          next.handover.from !== m.id ||
          next.handover.to !== target.id ||
          !next.handover.recoveryHash
        )
          throw new ApiError(
            '후임에게 소유권 인계를 요청하고 새 복구 정보의 보관 확인을 받아주세요.',
            409,
          );
        target.owner = true;
        target.role = 'admin';
        self.owner = false;
        next.recoveryHash = next.handover.recoveryHash;
        delete next.handover;
      } else if (
        m.role === 'admin' &&
        !next.members.some(
          (v) => v.id !== m.id && !v.removed && v.role === 'admin',
        )
      ) {
        if (!target)
          throw new ApiError(
            '마지막 관리자는 다른 참여자에게 관리자 권한을 넘겨야 합니다.',
            409,
          );
        target.role = 'admin';
      }
      self.removed = true;
      assertRemainingAdmin(next);
      next.detachReceipts ??= {};
      next.detachReceipts[id] = {
        proofHash: hash(input.proof),
        memberId: m.id,
      };
      ports.record(next, m, '로컬로 전환 · 공동 참여 종료');
      await ports.persist(next);
      ports.cleanup(p.id, m.id);
      return { committed: true };
    } else throw new ApiError('지원하지 않는 프로젝트 전환입니다.', 404);
    ports.record(next, m, '프로젝트 소유권 인계');
    await ports.persist(next);
    return ports.envelope(next, m);
  };
}
