import { ServerLimits } from '../../contracts/server-limits.ts';
import type { CollaborationEnvelope } from '../../contracts/collaboration.ts';
import type { Snapshot } from '../../contracts/project.ts';
import type { Project, Member } from '../project-state.ts';
import { ApiError } from './errors.ts';
import { checkSnapshot } from '../../collaboration-model.ts';
import { homeName } from '../../home-organization.ts';

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
  async function create(input: Input) {
    if (ports.projects.count() >= ServerLimits.projects)
      throw new ApiError('초기 서버는 프로젝트를 20개까지 지원합니다.', 413);
    checkSnapshot(input.files);
    const code = ports.identity.invite(),
      token = ports.identity.secret(),
      recoveryKey = ports.identity.secret(),
      name = nickname(input.name);
    const member: Member = {
      id: ports.identity.id(),
      nickname: nickname(input.nickname),
      role: 'admin',
      owner: true,
      tokenHash: ports.identity.digest(token),
    };
    const project: Project = {
      id: ports.identity.id(),
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
      const project = structuredClone(source),
        owner = project.members.find((member) => member.owner)!;
      const token = ports.identity.secret(),
        recoveryKey = ports.identity.secret();
      owner.tokenHash = ports.identity.digest(token);
      owner.removed = false;
      owner.role = 'admin';
      project.recoveryHash = ports.identity.digest(recoveryKey);
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
  return { create, join, recover, rename };
}
