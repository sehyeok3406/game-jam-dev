import { assertProjectNameAvailable } from '../core/projects/project-name.ts';
import { acquireWriter } from './operations/writer-lock.ts';
import { assertServiceMode, type ServiceMode } from './config.ts';
import { createPeerIdentity } from './http/peer.ts';
import {
  createTelemetry,
  writeOperationsStatus,
} from './operations/telemetry.ts';
import { MaintenanceGate } from './operations/maintenance.ts';
import { BackupService } from './operations/backup.ts';
import type { ScheduledBackup } from './operations/backup-config.ts';
import { createProjectHistoryWriter } from './services/project-history-writer.ts';
import type { CollaborationCommand } from '../contracts/collaboration.ts';
import {
  cloneProject,
  protectedFiles,
  digest,
  planApproval,
  secret,
  same,
  activeEvent,
  taskState,
} from './project-operations.ts';
import { createServerContext } from './context.ts';
import { createRateLimit } from './services/rate-limit.ts';
import { startServerLifetime } from './lifetime.ts';
import { multiplayerRoute } from './http/routes/multiplayer.ts';
import { aiRoute } from './http/routes/ai.ts';
import { approvalsRoute } from './http/routes/approvals.ts';
import { historyRoute } from './http/routes/history.ts';
import { commandsRoute } from './http/routes/commands.ts';
import { membersRoute } from './http/routes/members.ts';
import { projectsRoute, projectsActionRoute } from './http/routes/projects.ts';
import { projectActionRoute } from './http/routes/project-actions.ts';
import { createProjectRequest } from './services/project-request.ts';
import { createProjectActions } from './services/project-actions.ts';
import { applyExternalCommand } from '../application/editing/command-service.ts';
export type { CollaborationCommand } from '../contracts/collaboration.ts';
export type { CollaborationEnvelope } from '../contracts/collaboration.ts';
import { SqliteProjectRepository } from '../adapters/sqlite/project-repository.ts';
import { createCheckpointStore } from './persistence/checkpoint-store.ts';
import { createLifecycleStore } from './persistence/lifecycle-store.ts';
import { createProjectPersistence } from './persistence/project-persistence.ts';
import { attachMultiplayerServer } from '../multiplayer/server.ts';
import { PlayDiagnostics } from '../multiplayer/diagnostics.ts';
import packageInfo from '../../package.json' with { type: 'json' };
import { TRASH_RETENTION } from '../trash-files.ts';
import http from 'node:http';
import { ApiError } from './services/errors.ts';
import { createAccessPolicy } from './services/access-policy.ts';
import { createCommandService } from './services/command-service.ts';
import { createOfflineSyncService } from './services/offline-sync-service.ts';
import { createHistoryService } from './services/history-service.ts';
import { projectEnvelope } from './services/project-envelope.ts';
import { createStateService } from './services/state-service.ts';
import { createLifecycleService } from './services/lifecycle-service.ts';
import {
  projectLifecycle,
  assertProjectActive,
  unavailableProject,
} from './services/lifecycle-policy.ts';
import { createProjectRetention } from './services/project-retention.ts';
import { createProjectModeService } from './services/project-mode-service.ts';
import { createProjectService } from './services/project-service.ts';
import { createMemberService } from './services/member-service.ts';
import { createApprovalService } from './services/approval-service.ts';
import { createAiCoordinator } from './services/ai-coordinator.ts';
import { createAiRunService } from './services/ai-run-service.ts';
import { synchronizeAiState } from './services/ai-state.ts';
import type { Project, Member } from './project-state.ts';
import { createHttpHandler } from './http/router.ts';
import { healthRoute, readyRoute } from './http/routes/health.ts';
import { eventsRoute } from './http/routes/events.ts';
import { ProjectEvents } from './services/project-events.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkSnapshot } from '../collaboration-model.ts';
import { assertAiFilesUnlocked, assertAiMutation } from '../ai-file-lock.ts';
import { type Snapshot } from '../project-store.ts';
import { rebuildAuthorship } from '../file-authorship.ts';
type Options = {
  dataDirectory: string;
  host?: string;
  port?: number;
  creationKey?: string;
  /** Required even on loopback when the server is published through a tunnel. */
  publicAccess?: boolean;
  serviceMode?: ServiceMode;
  trustedProxies?: string[];
  shutdownMs?: number;
  requestLog?: (entry: object) => void;
  backup?: ScheduledBackup;
  /** Only used by the local staged-migration verification tool. */
  migrationCheckId?: string;
};
/** Durable transactions are independent of recovery checkpoint export. */
export async function createCollaborationServer(options: Options) {
  assertServiceMode(options.serviceMode ?? 'self-host', options.creationKey);
  const peer = createPeerIdentity(options.trustedProxies);
  let accepting = false;
  const host = options.host ?? '127.0.0.1';
  if (
    (options.publicAccess ||
      !['127.0.0.1', '::1', 'localhost'].includes(host)) &&
    (options.creationKey?.length ?? 0) < 32
  )
    throw new Error('외부 연결 서버에는 32자 이상의 creationKey가 필요합니다.');
  const root = path.resolve(options.dataDirectory);
  await fs.mkdir(root, { recursive: true });
  const writer = await acquireWriter(root);
  const telemetry = createTelemetry(options.requestLog);
  try {
    if (
      await fs
        .stat(path.join(root, '.restore-in-progress.json'))
        .catch(() => null)
    )
      throw new Error(
        '복원이 완료되지 않은 폴더입니다. 원본과 복원 기록을 보존해주세요.',
      );
    const migrationFile = await fs
      .readFile(path.join(root, '.host-migration.json'), 'utf8')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (migrationFile) {
      const migration = JSON.parse(migrationFile);
      if (
        migration.state !== 'active' &&
        !(
          migration.state === 'staged' &&
          migration.migrationId === options.migrationCheckId &&
          ['127.0.0.1', '::1', 'localhost'].includes(host) &&
          !options.publicAccess
        )
      )
        throw new Error(
          '이전 준비/전환으로 중지된 데이터 폴더입니다. 이전 절차를 확인해주세요.',
        );
    }
    const gate = new MaintenanceGate();
    const playDiagnostics = new PlayDiagnostics(
      path.join(root, '.multiplayer-diagnostics.json'),
      packageInfo.version,
    );
    const { projects, locks, online, projectQueue, projectLocks } =
      createServerContext();
    let multiplayer: ReturnType<typeof attachMultiplayerServer> | undefined;
    const lifecycleStore = await createLifecycleStore(root);
    const store = new SqliteProjectRepository<Project>(
      path.join(root, 'sync.sqlite'),
    );
    try {
      const tombstones = new Map(await store.tombstones());
      const checkpoints = createCheckpointStore(root);
      const events = new ProjectEvents({
        summary: (id) => ({
          revision: projects.get(id)?.revision,
          lifecycle: projects.get(id)?.lifecycle,
        }),
        memberActive: (id, memberId) => {
          const member = projects
            .get(id)
            ?.members.find((item) => item.id === memberId);
          return !!member && !member.removed;
        },
      });
      const announcePlayLobby = (id: string) => events.announcePlayLobby(id);
      const queue = <T>(id: string, operation: () => Promise<T>): Promise<T> =>
        projectQueue.run(id, operation);
      const announce = (id: string) => events.announce(id);
      const persistence = createProjectPersistence({
        repository: store,
        projects,
        checkpoints,
        lifecycle: lifecycleStore,
        committed: (id) => {
          multiplayer?.recheck();
          announce(id);
        },
        recoveryError: telemetry.recoveryError,
      });
      const saveLifecycleMarker = async (
        id: string,
        status: string,
        version: number,
      ) => {
        try {
          await lifecycleStore.save(id, status, version);
        } catch {
          telemetry.recoveryError(id, 'lifecycle');
        }
      };
      const exportCheckpoint = async (project: Project) => {
        try {
          await persistence.exportCheckpoint(project);
        } catch {
          telemetry.recoveryError(project.id, 'checkpoint');
        }
      };
      const persist = async (project: Project) => {
        const usesName = (p: Project | undefined) =>
          !!p &&
          (!p.lifecycle ||
            ['active', 'trashing', 'restoring'].includes(p.lifecycle.status));
        const save = async () => {
          synchronizeAiState(project, Date.now);
          await telemetry.save(() => persistence.persist(project));
        };
        const previous = projects.get(project.id);
        if (
          usesName(project) &&
          (!usesName(previous) || project.name !== previous?.name)
        )
          return queue('project-names', async () => {
            try {
              assertProjectNameAvailable(
                projects.values(),
                project.name,
                project.id,
              );
            } catch (error) {
              throw new ApiError((error as Error).message, 409);
            }
            await save();
          });
        await save();
      };
      try {
        for (const project of await store.loadAll()) {
          checkSnapshot(project.files);
          project.authorship ??= rebuildAuthorship(project.history);
          if (project.job) project.job.expiresAt = 0;
          projects.set(project.id, project);
          persistence.track(project);
        }
      } catch (error) {
        await store.close();
        throw error;
      }
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (
          !entry.isDirectory() ||
          !/^[a-f0-9-]{36}$/.test(entry.name) ||
          projects.has(entry.name) ||
          tombstones.has(entry.name) ||
          (lifecycleStore.get(entry.name) &&
            lifecycleStore.get(entry.name)!.status !== 'active')
        )
          continue;
        try {
          const project = await checkpoints.recover(entry.name);
          checkSnapshot(project.files);
          project.authorship ??= rebuildAuthorship(project.history);
          if (project.job) {
            project.job.expiresAt = 0;
          }
          await store.commit(project);
          projects.set(project.id, project);
        } catch (error) {
          await store.close();
          throw new Error(`협업 프로젝트 복구 실패: ${entry.name}`, {
            cause: error,
          });
        }
      }
      const { authenticate, admin, editable, assertBases } = createAccessPolicy(
        {
          matches: same,
          now: Date.now,
          seen: (projectId, memberId, at) => {
            let map = online.get(projectId);
            if (!map) online.set(projectId, (map = new Map()));
            map.set(memberId, at);
          },
          locks: projectLocks,
        },
      );
      const envelope = (project: Project, member: Member) =>
        projectEnvelope(project, member, {
          version: packageInfo.version,
          now: Date.now,
          online: (id, memberId) => online.get(id)?.get(memberId),
          locks: projectLocks,
        });
      const recordChanges = createProjectHistoryWriter({
        now: Date.now,
        id: randomUUID,
      });
      const aiRun = createAiRunService({
        clone: cloneProject,
        admin,
        persist,
        envelope,
        taskState,
        recordChanges,
        now: Date.now,
        digest,
      });
      const limit = createRateLimit();
      const lifecycle = projectLifecycle;
      const assertActive = assertProjectActive;
      const unavailable = (id: string): never =>
        unavailableProject(id, tombstones.get(id), lifecycleStore.get(id));
      const projectLifecycleService = createLifecycleService({
        projects: {
          all: () => projects.values(),
          get: (id) => projects.get(id),
        },
        queue,
        admin,
        files: createProjectRetention(root),
        checkpoint: async (id) => {
          await persistence.wait(id);
        },
        persist,
        purgeStored: async (id, version) => {
          await store.purge(id, version);
          tombstones.set(id, version);
        },
        marker: saveLifecycleMarker,
        releaseAccess: (id) => {
          locks.delete(id);
          online.delete(id);
        },
        remove: (id) => {
          projects.delete(id);
          persistence.forget(id);
          events.purge(id);
        },
        activeRun: (event) => Boolean(activeEvent(event)),
        now: Date.now,
        id: randomUUID,
        retention: TRASH_RETENTION,
      });
      await projectLifecycleService.maintain();
      const identity = {
        now: Date.now,
        id: randomUUID,
        secret,
        invite: () => randomBytes(10).toString('hex').toUpperCase(),
        digest,
        matches: same,
      };
      const projectService = createProjectService({
        locked: (id) => projectLocks(id).size > 0,
        projects: {
          count: () => projects.size,
          all: () => projects.values(),
          get: (id) => projects.get(id),
        },
        queue,
        identity,
        persist,
        authenticate,
        assertActive,
        lifecycle,
        envelope,
        admin,
        editable,
        clone: cloneProject,
        recordChanges,
      });
      const members = createMemberService({
        identity,
        admin,
        clone: cloneProject,
        recordChanges,
        persist,
        envelope,
        releaseLocks: (id, memberId) => {
          for (const [relative, lock] of projectLocks(id))
            if (lock.memberId === memberId) projectLocks(id).delete(relative);
        },
        forgetPresence: (id, memberId) => {
          online.get(id)?.delete(memberId);
        },
      });
      const approvals = createApprovalService({
        admin,
        clone: cloneProject,
        persist,
        now: Date.now,
        digest,
        plan: planApproval,
      });
      const ai = createAiCoordinator({
        admin,
        clone: cloneProject,
        persist,
        envelope,
        plan: planApproval,
        locks: projectLocks,
        taskState,
        recordChanges,
        now: Date.now,
        id: randomUUID,
        secret,
        digest,
      });
      const commands = createCommandService({
        admin,
        editable,
        locks: projectLocks,
        reduce: applyExternalCommand,
        assertAiMutation: (
          project: Project,
          after: Snapshot,
          command: CollaborationCommand,
        ) =>
          assertAiMutation(
            protectedFiles(project),
            project.files,
            after,
            command.channel,
            command.input as Record<string, unknown>,
          ),
        assertBases,
        clone: cloneProject,
        recordChanges,
        persist,
        envelope,
      });
      const offline = createOfflineSyncService({
        editable,
        assertAiMutation: (project, after) =>
          assertAiMutation(protectedFiles(project), project.files, after),
        assertBases,
        clone: cloneProject,
        recordChanges,
        persist,
        envelope,
      });
      const history = createHistoryService({
        admin,
        editable,
        locks: projectLocks,
        assertAiMutation: (project, files) =>
          assertAiMutation(protectedFiles(project), project.files, files),
        clone: cloneProject,
        recordChanges,
        persist,
        checkpoint: exportCheckpoint,
        envelope,
      });
      const stateService = createStateService({
        admin,
        editable,
        locks: projectLocks,
        assertUnlocked: (project, relative) =>
          assertAiFilesUnlocked(protectedFiles(project), [relative]),
        envelope,
        secret,
        now: Date.now,
        announce,
      });
      const modeExecute = createProjectModeService({
        persist,
        envelope,
        id: randomUUID,
        record: (p, m, label) => recordChanges(p, m, p.files, label),
        cleanup: (id, memberId) => {
          online.get(id)?.delete(memberId);
          for (const [relative, lock] of projectLocks(id))
            if (lock.memberId === memberId) projectLocks(id).delete(relative);
        },
      });
      const dispatch = createProjectActions({
        modes: { execute: modeExecute },
        stateService,
        members,
        approvals,
        offline,
        commands,
        projectService,
        history,
        aiRun,
        ai,
      });
      const dispatchRequest = createProjectRequest({
        get: (id) => projects.get(id),
        unavailable,
        authenticate,
        queue,
        assertActive,
        admin,
        expire: aiRun.expire,
        lifecycle: projectLifecycleService.execute,
        dispatch,
      });
      const run: typeof dispatchRequest = (...args) =>
        gate.run(() => dispatchRequest(...args));
      const actionHttp = {
        peer,
        get: (id: string) => projects.get(id),
        unavailable,
        authenticate,
        limit,
        run,
      };
      const server = http.createServer(
        createHttpHandler(
          [
            healthRoute(packageInfo.version),
            readyRoute(() => accepting && !gate.blocked),
            eventsRoute(
              {
                authenticate: (id, token) => {
                  const project = projects.get(id);
                  if (!project) return unavailable(id);
                  const member = authenticate(project, token);
                  assertActive(project);
                  return member;
                },
                limit,
              },
              events,
            ),
            multiplayerRoute({
              get: (id) => projects.get(id),
              authenticate,
              assertActive,
              limit,
              control: (id, token, input) =>
                multiplayer!.control(id, token, input),
              record: (...args) => playDiagnostics.record(...args),
            }),
            projectsRoute({
              peer,
              limit,
              validKey: (key) =>
                !options.creationKey || same(key, digest(options.creationKey)),
              create: (input) => gate.run(() => projectService.create(input)),
              join: (input) => gate.run(() => projectService.join(input)),
              inspectJoin: (input) =>
                gate.run(() => projectService.inspectJoin(input)),
              recover: (input) => gate.run(() => projectService.recover(input)),
            }),
            projectsActionRoute(actionHttp),
            commandsRoute(actionHttp),
            membersRoute(actionHttp),
            historyRoute(actionHttp),
            approvalsRoute(actionHttp),
            aiRoute(actionHttp),
            projectActionRoute(() => true, actionHttp),
          ],
          async (request) => {
            if (request.method !== 'POST')
              throw new ApiError('지원하지 않는 요청입니다.', 404);
            limit(peer(request), 'unknown-route', 30);
            throw new ApiError('경로를 찾을 수 없습니다.', 404);
          },
          { accepting: () => accepting, observe: telemetry.observe },
        ),
      );
      multiplayer = attachMultiplayerServer(
        server,
        (id, token) => {
          if (!accepting) throw new ApiError('서버가 종료 중입니다.', 503);
          const project = projects.get(id);
          if (!project) throw new ApiError('프로젝트를 찾을 수 없습니다.', 404);
          assertActive(project);
          const member = authenticate(project, token);
          return {
            id: member.id,
            nickname: member.nickname,
            role: member.role,
            files: project.files,
          };
        },
        playDiagnostics,
        announcePlayLobby,
      );
      const backup = options.backup
        ? new BackupService({
            ...options.backup,
            dataDirectory: root,
            database: store,
            gate,
            quiesce: async () => {
              await projectQueue.drain();
              await persistence.quiesce();
            },
          })
        : undefined;
      let backupTimer: ReturnType<typeof setInterval> | undefined;
      let statusWork = Promise.resolve();
      const writeStatus = () => {
        statusWork = statusWork
          .then(() =>
            writeOperationsStatus(
              root,
              telemetry.snapshot(),
              backup?.current(),
              accepting && !gate.blocked,
            ),
          )
          .catch(() => {
            console.warn('운영 상태 파일 기록 실패');
          });
        return statusWork;
      };
      let statusTimer: ReturnType<typeof setInterval> | undefined;
      const running = await startServerLifetime(
        server,
        host,
        options.port ?? 4317,
        {
          shutdownMs: options.shutdownMs,
          beginDrain: () => {
            accepting = false;
            gate.stop();
          },
          drainAccepted: () => gate.drain(),
          maintain: () => gate.run(projectLifecycleService.maintain),
          exportDirty: () => {
            if (!gate.blocked) persistence.exportDirty();
          },
          closeMultiplayer: () => multiplayer?.close(),
          closeEvents: () => events.close(),
          flushDiagnostics: () => playDiagnostics.flush(),
          drain: () => projectQueue.drain(),
          waitCheckpoints: () => persistence.waitAll(),
          checkpointDirty: () => persistence.flush(),
          stopOperations: async () => {
            clearInterval(backupTimer);
            clearInterval(statusTimer);
            await backup?.close();
          },
          closeStore: async () => {
            try {
              await writeStatus();
              telemetry.close();
              await store.close();
            } finally {
              writer.release();
            }
          },
        },
      );
      accepting = true;
      statusTimer = setInterval(() => void writeStatus(), 30000);
      statusTimer.unref();
      await writeStatus();
      if (backup) {
        const interval = options.backup!.intervalMs ?? 86400000;
        if (
          !Number.isFinite(interval) ||
          interval < 100 ||
          interval > 2147483647
        ) {
          await running.close();
          throw new Error('백업 간격이 올바르지 않습니다.');
        }
        backupTimer = setInterval(() => {
          void backup
            .run()
            .catch(() =>
              console.warn(
                '예약 백업 실패. backup-status.json을 확인해주세요.',
              ),
            );
        }, interval);
        backupTimer.unref();
      }
      return {
        ...running,
        metrics: () => telemetry.snapshot(),
        ...(backup
          ? {
              backup: {
                run: () => backup.run(),
                status: () => backup.current(),
              },
            }
          : {}),
      };
    } catch (error) {
      await store.close();
      throw error;
    }
  } catch (error) {
    telemetry.close();
    writer.release();
    throw error;
  }
}
export { activeEvent };
