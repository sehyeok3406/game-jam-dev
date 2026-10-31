import {
  registeredSharedWorkspace,
  sharedWorkspaceLocations,
} from '../projects/workspace-locations.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CollaborationClient,
  noCollaboration,
  type CollaborationCredentials,
} from '../../collaboration-client.ts';
import { readClientCache } from '../../client-cache.ts';
import { captureProject } from '../../project-store.ts';
import { localProjectName } from '../../project-metadata.ts';
import type { CollaborationState } from '../../contracts/collaboration.ts';
import type { PlayLobbyEvent } from '../../multiplayer/types.ts';
import type {
  CollaborationSessionPort,
  ConnectionOffer,
  ActiveCollaboration,
} from '../../application/ports/collaboration-session.ts';
import type { DesktopProjectSessions } from '../project-session.ts';
import type { ProjectLibrary } from '../../project-library.ts';
import type { DesktopLifecycle } from '../lifecycle.ts';
import type { CollaborationCacheQueue } from './cache-queue.ts';
import type { CollaborationSessionStore } from './session-store.ts';

type Options = {
  sessions: DesktopProjectSessions<CollaborationClient>;
  library(): ProjectLibrary;
  hasTrash(id: string): boolean;
  hasSharedTrash?(projectId: string): boolean;
  userData(): string;
  store(): CollaborationSessionStore;
  cache: CollaborationCacheQueue;
  lifecycle: DesktopLifecycle;
  busy(): boolean;
  resetClipboard(): void;
  clearState(): void;
  changed(state: CollaborationState, changed: boolean): void;
  notify(): void;
  lobby(event: PlayLobbyEvent, projectId: string): void;
  startWatcher(): Promise<void>;
  creation(input: {
    serverUrl: string;
    serverKey: string;
  }): Promise<{ key: string; internal: boolean }>;
  prepareLock(path: string): Promise<void>;
  client?: typeof CollaborationClient;
  safeCreate?(
    input: Parameters<CollaborationSessionPort['create']>[0],
    source: {
      name: string;
      files: import('../../contracts/project.ts').Snapshot;
    },
    root: string | null,
  ): Promise<ConnectionOffer>;
  toLocal?(
    input: import('../../contracts/project-mode.ts').LocalConversionInput,
  ): Promise<void>;
  handover?(
    action: 'prepare' | 'accept' | 'cancel',
    successorId?: string,
  ): Promise<void>;
};
/** Credentials, paths, cache format and Electron lifecycle remain in the desktop boundary. */
export class DesktopCollaborationSessions implements CollaborationSessionPort {
  private options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  private get sessions() {
    return this.options.sessions;
  }
  busy() {
    return this.options.busy();
  }
  assertSecure() {
    this.options.library().assertSecureSession();
  }
  state() {
    return this.sessions.client?.state ?? noCollaboration();
  }
  scope() {
    const ref = this.sessions.ref;
    return {
      root: this.sessions.root,
      shared: !!this.sessions.client,
      localRoot: this.sessions.localRootBeforeShare,
      assertCurrent: () => this.sessions.assertCurrent(ref),
    };
  }
  async source(root: string, assertCurrent: () => void) {
    assertCurrent();
    const name = await localProjectName(root);
    assertCurrent();
    const files = await captureProject(root);
    assertCurrent();
    return { name, files };
  }
  private offer(
    credentials: CollaborationCredentials,
    state: CollaborationState,
  ): ConnectionOffer {
    return {
      activate: async (localRoot) => {
        await this.options
          .library()
          .rememberShared(
            credentials,
            state.projectName ?? '공동 프로젝트',
            state.role,
            localRoot,
          );
        return this.attach(credentials, localRoot);
      },
      retain: (localRoot) =>
        this.options
          .library()
          .rememberShared(
            credentials,
            state.projectName ?? '공동 프로젝트',
            state.role,
            localRoot,
          ),
    };
  }
  async create(
    input: Parameters<CollaborationSessionPort['create']>[0],
    source: Parameters<CollaborationSessionPort['create']>[1],
  ) {
    if (this.options.safeCreate)
      return this.options.safeCreate(input, source, this.sessions.root);
    const creation = await this.options.creation(input);
    const created = await (this.options.client ?? CollaborationClient).create(
      input.serverUrl,
      creation.key,
      input.nickname,
      source.name,
      source.files,
    );
    return this.offer(
      { ...created.credentials, internalServer: creation.internal },
      created.result.state,
    );
  }
  async join(input: Parameters<CollaborationSessionPort['join']>[0]) {
    const api = this.options.client ?? CollaborationClient;
    const inspection = await api.inspectJoin(input.serverUrl, input.code);
    let known;
    try {
      known = this.options
        .library()
        .findShared(inspection.projectId, input.serverUrl);
    } catch {
      /* This is a new registration. */
    }
    this.options.library().assertNameAvailable(inspection.name, known?.id);
    if (known?.credentials) {
      try {
        const result = (await api.fetch(
          input.serverUrl,
          `/projects/${inspection.projectId}/state`,
          {},
          known.credentials.token,
        )) as { state: CollaborationState };
        return this.offer(known.credentials, result.state);
      } catch (error) {
        if (![401, 403].includes(Number((error as { status?: number }).status)))
          throw error;
      }
    }
    return this.options
      .library()
      .withName(inspection.name, known?.id, async () => {
        const identity = await this.options.store().prepareJoin(input);
        const joined = await api.join(
          input.serverUrl,
          input.code,
          input.nickname,
          { inspection, identity },
        );
        await this.options
          .library()
          .rememberShared(
            joined.credentials,
            joined.result.state.projectName ?? inspection.name,
            joined.result.state.role,
            this.sessions.localRootBeforeShare,
          );
        await this.options.store().finishJoin(input);
        return this.offer(joined.credentials, joined.result.state);
      });
  }
  async recover(input: Parameters<CollaborationSessionPort['recover']>[0]) {
    const api = this.options.client ?? CollaborationClient;
    const inspection = await api.inspectRecovery(
      input.serverUrl,
      input.projectId,
      input.recoveryKey,
    );
    const library = this.options.library();
    const known = library
      .list()
      .some(
        (entry) =>
          entry.kind === 'shared' && entry.projectId === inspection.projectId,
      )
      ? library.findShared(inspection.projectId, input.serverUrl)
      : undefined;
    return library.withName(inspection.name, known?.id, async () => {
      const recovered = await api.recover(
        input.serverUrl,
        input.projectId,
        input.recoveryKey,
        inspection,
      );
      await library.rememberShared(
        recovered.credentials,
        recovered.result.state.projectName ?? inspection.name,
        recovered.result.state.role,
        this.sessions.localRootBeforeShare,
      );
      return this.offer(recovered.credentials, recovered.result.state);
    });
  }
  private persist(
    client = this.sessions.client,
    localRoot = this.sessions.localRootBeforeShare,
  ) {
    return this.options
      .store()
      .save({ credentials: client?.credentials ?? null, localRoot });
  }
  async attach(
    credentials: CollaborationCredentials,
    localRoot = this.sessions.localRootBeforeShare,
  ) {
    const o = this.options,
      scope = this.scope();
    o.resetClipboard();
    if (
      o.hasSharedTrash
        ? o.hasSharedTrash(credentials.projectId)
        : o.hasTrash(`shared:${credentials.projectId}`)
    )
      throw Error('이 PC의 사본이 휴지통에 있습니다. 먼저 복원해주세요.');
    if (!/^[a-f0-9-]{36}$/.test(credentials.projectId))
      throw Error('공동 프로젝트 ID가 올바르지 않습니다.');
    await o.lifecycle.preserve('switch-project');
    scope.assertCurrent();
    await this.sessions.watcher?.close();
    scope.assertCurrent();
    this.sessions.setWatcher(null);
    let registered;
    try {
      registered = o
        .library()
        .findShared(credentials.projectId, credentials.serverUrl);
    } catch {
      const legacy = registeredSharedWorkspace(
        o.userData(),
        o.library(),
        credentials.projectId,
        credentials.serverUrl,
      );
      // This lookup supplies only a display name. The full guarded cache validation below still rejects damaged bytes.
      const cached = await readClientCache(
        path.join(legacy, 'server-cache.json'),
      ).catch(() => null);
      const result =
        cached ??
        ((await (o.client ?? CollaborationClient).fetch(
          credentials.serverUrl,
          `/projects/${credentials.projectId}/state`,
          { metadataOnly: true },
          credentials.token,
        )) as { state: CollaborationState });
      await o
        .library()
        .rememberShared(
          credentials,
          result.state.projectName ?? '공동 프로젝트',
          result.state.role,
          localRoot,
        );
      registered = o
        .library()
        .findShared(credentials.projectId, credentials.serverUrl);
    }
    const cacheRoot = await sharedWorkspaceLocations(
      o.userData(),
      o.library(),
    ).ensure(registered.id);
    await fs.mkdir(cacheRoot, { recursive: true });
    scope.assertCurrent();
    let activeRef = this.sessions.ref;
    const current = () =>
      this.sessions.client === client && this.sessions.matches(activeRef);
    const client = new (o.client ?? CollaborationClient)(
      credentials,
      (state, changed) => {
        if (current()) o.changed(state, changed);
      },
      async () => {
        await o.cache.save(client, cacheRoot);
      },
      (event) => {
        if (current()) o.lobby(event, credentials.projectId);
      },
    );
    this.sessions.localRootBeforeShare = localRoot;
    await this.sessions.activate(cacheRoot, client);
    activeRef = this.sessions.ref;
    const assertCurrent = () => {
      this.sessions.assertCurrent(activeRef);
      if (this.sessions.client !== client)
        throw Error('공동 프로젝트 세션이 변경되었습니다.');
    };
    try {
      const cached = await readClientCache(
        path.join(cacheRoot, 'server-cache.json'),
      );
      assertCurrent();
      client.seedCache(cached);
    } catch (error) {
      assertCurrent();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await this.sessions.activate(null);
        o.changed(noCollaboration(), true);
        throw Error(
          '이 PC의 공동 프로젝트 사본을 읽지 못했습니다. 미동기화 작업 보호를 위해 덮어쓰지 않았습니다. 캐시를 백업하고 복구해주세요.',
        );
      }
    }
    try {
      await client.refresh();
    } catch {
      /* Retain reconnectable read-only/offline session. */
    }
    assertCurrent();
    client.start();
    await this.persist(client, localRoot);
    assertCurrent();
    await o
      .library()
      .rememberShared(
        credentials,
        client.state.projectName ?? '공동 프로젝트',
        client.state.role,
        localRoot,
      );
    credentials.libraryId = o
      .library()
      .findShared(credentials.projectId, credentials.serverUrl).id;
    await this.persist(client, localRoot);
    assertCurrent();
    o.notify();
    return client.state;
  }
  async suspend() {
    const o = this.options,
      scope = this.scope(),
      client = this.sessions.client;
    if (o.busy()) throw Error('AI 작업을 먼저 종료해주세요.');
    o.resetClipboard();
    await o.lifecycle.preserve('home');
    scope.assertCurrent();
    if (client) {
      await o
        .library()
        .rememberShared(
          client.credentials,
          client.state.projectName ?? '공동 프로젝트',
          client.state.role,
          scope.localRoot,
        );
      scope.assertCurrent();
      for (const relative of client.heldLocks.keys()) {
        await client.unlock(relative).catch(() => undefined);
        scope.assertCurrent();
      }
    }
    await this.sessions.watcher?.close();
    scope.assertCurrent();
    this.sessions.setWatcher(null);
    await this.sessions.activate(null);
    this.sessions.localRootBeforeShare = null;
    o.clearState();
    o.changed(noCollaboration(), true);
  }
  resolveCreation(input: { serverUrl: string; serverKey: string }) {
    return this.options.creation(input);
  }
  async toLocal(
    input: import('../../contracts/project-mode.ts').LocalConversionInput,
  ) {
    if (!this.options.toLocal)
      throw Error('프로젝트 전환을 지원하지 않습니다.');
    await this.options.toLocal(input);
  }
  async handover(
    action: 'prepare' | 'accept' | 'cancel',
    successorId?: string,
  ) {
    if (!this.options.handover) throw Error('소유권 인계를 지원하지 않습니다.');
    await this.options.handover(action, successorId);
  }
  async leave() {
    const o = this.options,
      scope = this.scope(),
      client = this.sessions.client;
    if (client?.offline || client?.outgoing)
      throw Error(
        '미동기화 작업을 먼저 반영하거나 충돌을 해결해주세요. 홈으로 돌아가기는 작업과 세션을 보관합니다.',
      );
    if (o.busy()) throw Error('AI 작업을 먼저 중지해주세요.');
    await client?.leave();
    scope.assertCurrent();
    o.resetClipboard();
    if (client) await o.library().forgetSession(client.credentials.projectId);
    scope.assertCurrent();
    this.sessions.release('client');
    await this.sessions.activate(scope.localRoot);
    const localScope = this.scope();
    this.sessions.localRootBeforeShare = null;
    o.clearState();
    await this.persist(null, null);
    localScope.assertCurrent();
    if (this.sessions.root) await o.startWatcher();
    localScope.assertCurrent();
    o.changed(noCollaboration(), true);
  }
  active(): ActiveCollaboration | null {
    const client = this.sessions.client,
      scope = this.scope();
    if (!client) return null;
    const assertCurrent = () => {
      scope.assertCurrent();
      if (this.sessions.client !== client)
        throw Error('공동 프로젝트 세션이 변경되었습니다.');
    };
    const guarded = <T>(operation: () => Promise<T>) => {
      assertCurrent();
      return operation();
    };
    return {
      assertCurrent,
      backupOffline: () =>
        guarded(() =>
          this.options
            .store()
            .backupOffline(scope.root!, client.offline, assertCurrent),
        ),
      resolve: (id, choice) =>
        guarded(() => client.resolveConflict(id, choice)),
      resume: () => guarded(() => client.resumeAfterRestore()),
      invite: () => guarded(() => client.rotateInvite()),
      persist: () => guarded(() => this.persist(client, scope.localRoot)),
      role: (id, role) => guarded(() => client.setRole(id, role)),
      lock: (relative) => guarded(() => client.lock(relative)),
      unlock: (relative) => guarded(() => client.unlock(relative)),
    };
  }
  prepareLock(relative: string) {
    return this.options.prepareLock(relative);
  }
}
