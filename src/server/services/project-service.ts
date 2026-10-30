import { createHash } from 'node:crypto';
import { projectDirectoryName } from '../../core/projects/project-name.ts';
import { assertEraseSupport } from './drawing-capabilities.ts';
import { ServerLimits } from '../../contracts/server-limits.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { Project, Member } from '../project-state.ts';
import { ApiError } from './errors.ts';
import { checkSnapshot } from '../../collaboration-model.ts';
import { homeName } from '../../home-organization.ts';
import { planProjectLayout } from '../../application/projects/layout-migration.ts';
import { layoutMarkdownCodec } from '../../adapters/markdown/layout-snapshot.ts';
import { remapLayoutMarkdown } from '../../adapters/markdown/layout-links.ts';
import { readProjectLayout } from '../../core/projects/project-layout.ts';

type Input = Record<string, unknown>;
type Identity = {
  now: () => number;
  id: () => string;
  secret: () => string;
  invite: () => string;
  digest: (value: string) => string;
  matches: (value: string, hash: string) => boolean;
};
type Ports = {
  locked?: (id: string) => boolean;
  projects: {
    count: () => number;
    all: () => Iterable<Project>;
    get: (id: string) => Project | undefined;
  };
  queue: <T>(id: string, operation: () => Promise<T>) => Promise<T>;
  identity: Identity;
  persist: (project: Project) => Promise<void>;
  authenticate: (project: Project, token: string) => Member;
  assertActive: (project: Project) => void;
  lifecycle: (project: Project) => {
    projectId: string;
    name: string;
    status: string;
    version: number;
    expiresAt?: number;
    error?: string;
  };
  envelope: (project: Project, member: Member) => CollaborationEnvelope;
  admin: (member: Member) => void;
  editable: (project: Project, member: Member) => void;
  clone: (project: Project) => Project;
  recordChanges: (
    project: Project,
    member: Member,
    files: Snapshot,
    label: string,
  ) => void;
};
const nickname = (value: unknown) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 40 ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    throw new ApiError('닉네임은 1~40자로 입력해주세요.', 400);
  return value.trim();
};
/** Public creation/join/recovery own their existing queue boundaries; rename is already queued. */
export function createProjectService(ports: Ports) {
  async function createOnce(input: Input) {
    const identity = input.creation as
      | import('../../contracts/project-mode.ts').CreationIdentity
      | undefined;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([input.name, input.nickname, input.files]))
      .digest('hex');
    if (identity) {
      if (
        input.projectModeVersion !== 1 ||
        !/^[a-f0-9-]{36}$/.test(identity.id) ||
        ![identity.token, identity.recoveryKey].every(
          (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v),
        ) ||
        typeof identity.inviteCode !== 'string' ||
        !/^[a-f0-9]{20}$/.test(identity.inviteCode)
      )
        throw new ApiError('프로젝트 생성 인증 정보가 올바르지 않습니다.', 400);
      const prior = Array.from(ports.projects.all()).find(
        (p) => p.creation?.id === identity.id,
      );
      if (prior) {
        if (
          !ports.identity.matches(identity.token, prior.creation!.tokenHash) ||
          fingerprint !== prior.creation!.fingerprint
        )
          throw new ApiError('같은 생성 작업의 정보가 바뀌었습니다.', 409);
        ports.assertActive(prior);
        const actor = ports.authenticate(prior, identity.token);
        return {
          ...ports.envelope(prior, actor),
          token: identity.token,
          code: identity.inviteCode.toUpperCase(),
          recoveryKey: identity.recoveryKey,
        };
      }
    }
    if (ports.projects.count() >= ServerLimits.projects)
      throw new ApiError('초기 서버는 프로젝트를 20개까지 지원합니다.', 413);
    checkSnapshot(input.files);
    assertEraseSupport(input.files, input);
    const code = identity?.inviteCode.toUpperCase() ?? ports.identity.invite(),
      token = identity?.token ?? ports.identity.secret(),
      recoveryKey = identity?.recoveryKey ?? ports.identity.secret(),
      name =
        input.projectModeVersion === 1
          ? projectDirectoryName(input.name)
          : nickname(input.name);
    const member: Member = {
      id: ports.identity.id(),
      nickname: nickname(input.nickname),
      role: 'admin',
      owner: true,
      tokenHash: ports.identity.digest(token),
    };
    const project: Project = {
      id: ports.identity.id(),
      ...(identity
        ? {
            creation: {
              id: identity.id,
              tokenHash: ports.identity.digest(identity.token),
              fingerprint,
            },
          }
        : {}),
      name,
      createdAt: ports.identity.now(),
      modifiedAt: ports.identity.now(),
      files: input.files,
      revision: 1,
      revisions: Object.fromEntries(
        Object.keys(input.files).map((key) => [key, 1]),
      ),
      members: [member],
      inviteHash: ports.identity.digest(code),
      inviteExpiresAt: ports.identity.now() + 24 * 60 * 60000,
      recoveryHash: ports.identity.digest(recoveryKey),
      history: [],
      applied: [],
      job: null,
      lastRun: null,
      authorship: {},
    };
    await ports.persist(project);
    ports.authenticate(project, token);
    return {
      ...ports.envelope(project, member),
      token,
      code,
      recoveryKey,
    };
  }
  async function join(input: Input) {
    const code = String(input.code ?? '')
      .replace(/[\s-]/g, '')
      .toUpperCase();
    const found = Array.from(ports.projects.all()).find(
      (project) =>
        project.inviteExpiresAt > ports.identity.now() &&
        (!project.lifecycle || project.lifecycle.status === 'active') &&
        ports.identity.matches(code, project.inviteHash),
    );
    if (!found) throw new ApiError('초대 코드가 없거나 만료되었습니다.', 403);
    return ports.queue(found.id, async () => {
      const project = structuredClone(ports.projects.get(found.id)!);
      ports.assertActive(project);
      assertEraseSupport(project.files, input);
      if (
        project.inviteExpiresAt < ports.identity.now() ||
        !ports.identity.matches(code, project.inviteHash)
      )
        throw new ApiError('초대 코드가 만료되거나 변경되었습니다.', 403);
      if (
        project.members.filter((member) => !member.removed).length >=
        ServerLimits.members
      )
        throw new ApiError(
          '초기 프로젝트는 최대 20명이 참여할 수 있습니다.',
          413,
        );
      const token = ports.identity.secret(),
        member: Member = {
          id: ports.identity.id(),
          nickname: nickname(input.nickname),
          role: 'editor',
          owner: false,
          tokenHash: ports.identity.digest(token),
        };
      project.members.push(member);
      await ports.persist(project);
      ports.authenticate(project, token);
      return { ...ports.envelope(project, member), token };
    });
  }
  async function recover(input: Input) {
    const id = String(input.projectId ?? '');
    return ports.queue(id, async () => {
      const source = ports.projects.get(id);
      if (
        !source ||
        !ports.identity.matches(
          String(input.recoveryKey ?? ''),
          source.recoveryHash,
        )
      )
        throw new ApiError('복구 정보가 올바르지 않습니다.', 403);
      assertEraseSupport(source.files, input);
      const project = structuredClone(source),
        owner = project.members.find((member) => member.owner)!;
      const token = ports.identity.secret(),
        recoveryKey = ports.identity.secret();
      owner.tokenHash = ports.identity.digest(token);
      owner.removed = false;
      owner.role = 'admin';
      project.recoveryHash = ports.identity.digest(recoveryKey);
      delete project.handover;
      await ports.persist(project);
      if (project.lifecycle && project.lifecycle.status !== 'active')
        return {
          lifecycle: ports.lifecycle(project),
          files: {},
          revisions: {},
          state: {
            ...ports.envelope(project, owner).state,
            connected: false,
            accessDenied: true,
            projectDeleted: true,
          },
          token,
          recoveryKey,
        };
      return { ...ports.envelope(project, owner), token, recoveryKey };
    });
  }
  async function rename(project: Project, member: Member, input: Input) {
    ports.admin(member);
    ports.editable(project, member);
    if (project.job)
      throw new ApiError('AI 작업이 끝난 뒤 프로젝트 이름을 변경해주세요.');
    let name: string;
    try {
      name = homeName(input.name as string);
    } catch (error) {
      throw new ApiError((error as Error).message, 400);
    }
    if (typeof input.expectedName !== 'string')
      throw new ApiError('기존 프로젝트 이름을 확인해주세요.', 400);
    if (name === project.name) return ports.envelope(project, member);
    if (input.expectedName !== project.name)
      throw new ApiError(
        '프로젝트 이름이 바뀌었습니다. 목록을 새로고침하고 다시 확인해주세요.',
        409,
      );
    const next = ports.clone(project);
    next.name = name;
    ports.recordChanges(
      next,
      member,
      next.files,
      `프로젝트 이름 변경 · ${project.name} → ${name}`,
    );
    await ports.persist(next);
    return ports.envelope(next, member);
  }
  async function upgradeLayout(project: Project, member: Member, input: Input) {
    ports.admin(member);
    ports.editable(project, member);
    if (readProjectLayout(project.files))
      return ports.envelope(project, member);
    if (input.projectLayoutVersion !== 2)
      throw new ApiError('앱을 업데이트해주세요.', 409);
    if (input.revision !== project.revision)
      throw new ApiError(
        '프로젝트가 변경되었습니다. 새로고침한 뒤 다시 정리해주세요.',
        409,
      );
    if (
      project.job ||
      ports.locked?.(project.id) ||
      project.aiQueue?.some(
        (t) =>
          !['completed', 'failed', 'cancelled', 'stopped'].includes(t.status),
      ) ||
      Object.values(project.approvals ?? {}).some((r) =>
        ['pending', 'feedback', 'queued', 'running'].includes(r.status),
      )
    )
      throw new ApiError(
        '문서 편집과 AI 실행·예약·요청을 마친 뒤 파일 구조를 정리해주세요.',
        409,
      );
    const next = ports.clone(project);
    const files = planProjectLayout(
      project.files,
      layoutMarkdownCodec,
      remapLayoutMarkdown,
    );
    checkSnapshot(files);
    // The old records remain immutable. Their paths are resolved through the stored aliases.
    ports.recordChanges(next, member, files, '프로젝트 파일 구조 정리');
    await ports.persist(next);
    return ports.envelope(next, member);
  }
  const create = (input: Input) =>
    ports.queue('project-creation', () => createOnce(input));
  return { create, join, recover, rename, upgradeLayout };
}
