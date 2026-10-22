import type { Project, Member } from '../project-state.ts';
import type { CodexRunEvent } from '../../shared.ts';
import { ApiError } from './errors.ts';
import { projectLifecycle } from './lifecycle-policy.ts';
type Ports = {
  projects: {
    all: () => Iterable<Project>;
    get: (id: string) => Project | undefined;
  };
  queue: <T>(id: string, work: () => Promise<T>) => Promise<T>;
  admin: (member: Member) => void;
  files: {
    identity: (id: string) => Promise<string | null>;
    retain: (p: Project) => Promise<void>;
    restore: (p: Project) => Promise<void>;
    purge: (p: Project) => Promise<void>;
  };
  checkpoint: (id: string) => Promise<void>;
  persist: (p: Project) => Promise<void>;
  purgeStored: (id: string, version: number) => void | Promise<void>;
  marker: (id: string, status: string, version: number) => Promise<void>;
  releaseAccess: (id: string) => void;
  remove: (id: string) => void;
  activeRun: (event: CodexRunEvent | null) => boolean;
  now: () => number;
  id: () => string;
  retention: number;
};
/** Durable resumable phases; filesystem/repository operations remain injected. */
export function createLifecycleService(ports: Ports) {
  const finishTrash = async (project: Project) => {
    await ports.checkpoint(project.id);
    await ports.files.retain(project);
    project = structuredClone(project);
    project.lifecycle = {
      ...project.lifecycle!,
      status: 'trashed',
      trashedAt: ports.now(),
      expiresAt: ports.now() + ports.retention,
      error: undefined,
    };
    await ports.persist(project);
    return projectLifecycle(project);
  };
  const purgeProject = async (project: Project) => {
    project = structuredClone(project);
    project.lifecycle!.status = 'purging';
    await ports.persist(project);
    await ports.checkpoint(project.id);
    await ports.files.purge(project);
    await ports.purgeStored(project.id, project.lifecycle!.version + 1);
    await ports.marker(project.id, 'purged', project.lifecycle!.version + 1);
    ports.remove(project.id);
    return { projectId: project.id, status: 'purged' };
  };
  const restoreProject = async (project: Project) => {
    if (
      !project.lifecycle ||
      project.lifecycle.status === 'active' ||
      project.lifecycle.status === 'purging'
    )
      throw new ApiError('복원 가능한 휴지통 항목을 선택해주세요.');
    if (
      project.lifecycle!.status !== 'restoring' &&
      (project.lifecycle!.expiresAt ?? 0) <= ports.now()
    )
      throw new ApiError('보관 기간이 만료되었습니다.', 410);
    project = structuredClone(project);
    project.lifecycle!.status = 'restoring';
    await ports.persist(project);
    await ports.files.restore(project);
    project = structuredClone(project);
    project.lifecycle = {
      ...project.lifecycle!,
      status: 'active',
      version: project.lifecycle!.version + 1,
      error: undefined,
    };
    project.inviteExpiresAt = 0;
    project.revision++;
    await ports.persist(project);
    return projectLifecycle(project);
  };
  const maintainTrash = async () => {
    for (const candidate of Array.from(ports.projects.all())) {
      if (!candidate.lifecycle || candidate.lifecycle.status === 'active')
        continue;
      await ports.queue(candidate.id, async () => {
        const project = ports.projects.get(candidate.id);
        if (!project?.lifecycle || project.lifecycle.status === 'active')
          return;
        try {
          if (project.lifecycle!.status === 'trashing')
            await finishTrash(project);
          else if (project.lifecycle!.status === 'restoring')
            await restoreProject(project);
          else if (
            project.lifecycle!.status === 'purging' ||
            (project.lifecycle!.expiresAt ?? Infinity) <= ports.now()
          )
            await purgeProject(project);
        } catch (error) {
          const current = ports.projects.get(candidate.id);
          if (!current) return;
          const failed = structuredClone(current);
          failed.lifecycle!.error =
            error instanceof Error ? error.message : String(error);
          await ports.persist(failed);
        }
      });
    }
  };

  async function execute(
    project: Project,
    member: Member,
    action: string,
    input: Record<string, unknown>,
  ) {
    if (action === 'lifecycle') return projectLifecycle(project);
    if (action.startsWith('trash')) {
      ports.admin(member);
      if (action === 'trash-status') return projectLifecycle(project);
      if (action === 'trash-restore') return restoreProject(project);
      if (input.typedName !== project.name)
        throw new ApiError('프로젝트 이름을 정확히 입력해주세요.', 400);
      if (action === 'trash-purge') {
        if (!project.lifecycle || project.lifecycle.status === 'active')
          throw new ApiError('휴지통 항목을 선택해주세요.', 409);
        if (project.lifecycle.status === 'trashing') await finishTrash(project);
        if (project.lifecycle.status === 'restoring')
          throw new ApiError('복원을 먼저 완료해주세요.');
        return purgeProject(project);
      }
      if (action === 'trash') {
        if (project.lifecycle && project.lifecycle.status !== 'active')
          return projectLifecycle(project);
        if (input.expectedVersion !== (project.lifecycle?.version ?? 0))
          throw new ApiError(
            '프로젝트 상태가 바뀌었습니다. 다시 확인해주세요.',
          );
        if (input.confirmTeam !== true)
          throw new ApiError('팀 전체 접근 중단을 확인해주세요.', 400);
        if (project.job || ports.activeRun(project.lastRun))
          throw new ApiError('AI 작업을 먼저 중지해주세요.');
        project = structuredClone(project);
        project.lifecycle = {
          status: 'trashing',
          version: (project.lifecycle?.version ?? 0) + 1,
          trashId: ports.id(),
          identity: await ports.files.identity(project.id),
        };
        await ports.persist(project);
        ports.releaseAccess(project.id);
        return finishTrash(project);
      }
      throw new ApiError('지원하지 않는 휴지통 작업입니다.', 404);
    }
    throw new ApiError('지원하지 않는 프로젝트 수명 작업입니다.', 404);
  }
  return { execute, maintain: maintainTrash };
}
