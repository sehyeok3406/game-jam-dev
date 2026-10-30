import { collaborationTransport } from './adapters/http/collaboration-transport.ts';
import { remapPendingLayout } from './adapters/markdown/layout-snapshot.ts';
import { PROJECT_LAYOUT_PATH } from './contracts/project-layout.ts';
import { requireProjectLayoutSupport } from './adapters/http/project-layout-support.ts';
import { supportsSharedAiProvider } from './core/ai/catalog.ts';
import {
  objectId,
  workflowOnlyChange,
  type PropertyVersions,
} from './sync-properties.ts';
import { randomUUID } from 'node:crypto';
import type {
  CollaborationState,
  CreateTaskInput,
  CodexRunEvent,
  HistoryEntry,
  FileAuthorshipMap,
} from './shared.ts';
import type { Snapshot } from './contracts/project.ts';
import { ProjectEventDecoder, readPlayLobbyEvent } from './project-events.ts';
import type { PlayLobbyEvent } from './multiplayer/types.ts';
import { checkSnapshot, reduceCollaboration } from './collaboration-model.ts';
import { applyDrawingDelta } from './drawing-model.ts';
import { textDocumentHasAlignment } from './text-document.ts';
import {
  changedPaths,
  planOfflineMerge,
  snapshotChanges,
} from './offline-sync.ts';
import { CanvasError, errorText, failureInfo } from './app-errors.ts';
import { documentBundleContract } from './document-bundle.ts';
import { taskDocumentFormat } from './document-format.ts';
import type {
  CollaborationCommand,
  CollaborationEnvelope,
} from './contracts/collaboration.ts';

export type CollaborationCredentials = {
  serverUrl: string;
  projectId: string;
  token: string;
  inviteCode?: string;
  recoveryKey?: string;
  internalServer?: boolean;
  libraryId?: string;
  localFingerprint?: string;
  pendingHandoverId?: string;
};
export type OfflineDraft = {
  base: Snapshot;
  local: Snapshot;
  transaction?: {
    id: string;
    changes: Record<string, string | null>;
    revisions: Record<string, number>;
    submitted?: Snapshot;
  };
};
export type OnlineAttempt = {
  command: CollaborationCommand;
  base: Snapshot;
  local?: Snapshot;
};
export const noCollaboration = (): CollaborationState => ({
  active: false,
  connected: false,
  members: [],
  locks: [],
});
const retryableTransport = (error: unknown) =>
  error instanceof TypeError ||
  (error as { name?: string })?.name === 'TimeoutError' ||
  (error instanceof CanvasError &&
    (['GC-NET-001', 'GC-NET-002'].includes(error.code) ||
      (error.code === 'GC-NET-003' && Number(error.details.status) >= 500)));

export function serverAddress(value: string) {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('서버 주소는 http(s)://호스트:포트 형식으로 입력해주세요.');
  const local =
    /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      url.hostname,
    ) || url.hostname.endsWith('.local');
  if (url.protocol === 'http:' && !local)
    throw new Error(
      '인터넷 서버 연결에는 HTTPS가 필요합니다. HTTP는 로컬/내부망 주소만 지원합니다.',
    );
  return url.origin;
}

export class CollaborationClient {
  lastCommandHistoryId: string | null = null;
  files: Snapshot = {};
  revisions: Record<string, number> = {};
  properties: PropertyVersions = {};
  private sessionId = randomUUID();
  private sequence = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatBusy = false;
  private stream: AbortController | null = null;
  private streamConnected = false;
  private streamRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  authorship: FileAuthorshipMap = {};
  state = noCollaboration();
  readonly heldLocks = new Map<string, string>();
  lease: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private polling = false;
  private stopped = false;
  private busy = 0;
  private failures = 0;
  private nextPollAt = 0;
  offline: OfflineDraft | null = null;
  outgoing: OnlineAttempt | null = null;
  private readonly persist: () => Promise<void>;
  private readonly onPlayLobby: (event: PlayLobbyEvent) => void;
  readonly credentials: CollaborationCredentials;
  private readonly onUpdate: (
    state: CollaborationState,
    changed: boolean,
  ) => void;
  constructor(
    credentials: CollaborationCredentials,
    onUpdate: (state: CollaborationState, changed: boolean) => void,
    persist: () => Promise<void> = async () => {},
    onPlayLobby: (event: PlayLobbyEvent) => void = () => {},
  ) {
    serverAddress(credentials.serverUrl);
    if (!/^[a-f0-9-]{36}$/.test(credentials.projectId))
      throw new Error('서버가 반환한 프로젝트 ID가 올바르지 않습니다.');
    this.credentials = credentials;
    this.onUpdate = onUpdate;
    this.persist = persist;
    this.onPlayLobby = onPlayLobby;
    this.state = {
      ...noCollaboration(),
      active: true,
      serverUrl: credentials.serverUrl,
      projectId: credentials.projectId,
    };
  }
  static async create(
    serverUrl: string,
    serverKey: string,
    nickname: string,
    name: string,
    files: Snapshot,
  ) {
    if (files[PROJECT_LAYOUT_PATH])
      await requireProjectLayoutSupport(serverAddress(serverUrl));
    const result = (await this.fetch(
      serverAddress(serverUrl),
      '/projects',
      {
        nickname,
        name,
        files,
        drawingTextVersion: 1,
        drawingTextAlignmentVersion: 1,
        drawingEraseVersion: 1,
      },
      '',
      serverKey,
    )) as CollaborationEnvelope & {
      token: string;
      code: string;
      recoveryKey: string;
    };
    return {
      result,
      credentials: {
        serverUrl: serverAddress(serverUrl),
        projectId: result.state.projectId!,
        token: result.token,
        inviteCode: result.code,
        recoveryKey: result.recoveryKey,
      },
    };
  }
  static async join(serverUrl: string, code: string, nickname: string) {
    const result = (await this.fetch(serverAddress(serverUrl), '/join', {
      code,
      nickname,
      drawingTextVersion: 1,
      drawingTextAlignmentVersion: 1,
      drawingEraseVersion: 1,
    })) as CollaborationEnvelope & { token: string };
    return {
      result,
      credentials: {
        serverUrl: serverAddress(serverUrl),
        projectId: result.state.projectId!,
        token: result.token,
      },
    };
  }
  static async fetch(
    serverUrl: string,
    endpoint: string,
    input: unknown,
    token = '',
    key = '',
  ): Promise<unknown> {
    return this.transport(
      serverUrl,
      endpoint,
      { projectLayoutVersion: 2, ...(input as object) },
      token,
      key,
    );
  }
  static async recover(
    serverUrl: string,
    projectId: string,
    recoveryKey: string,
  ) {
    const result = (await this.fetch(serverAddress(serverUrl), '/recover', {
      projectId,
      recoveryKey,
      drawingTextVersion: 1,
      drawingTextAlignmentVersion: 1,
      drawingEraseVersion: 1,
    })) as CollaborationEnvelope & { token: string; recoveryKey: string };
    return {
      result,
      credentials: {
        serverUrl: serverAddress(serverUrl),
        projectId: result.state.projectId!,
        token: result.token,
        recoveryKey: result.recoveryKey,
      },
    };
  }
  private static async transport(
    serverUrl: string,
    endpoint: string,
    input: unknown,
    token = '',
    key = '',
  ): Promise<unknown> {
    return collaborationTransport(serverUrl, endpoint, input, token, key);
  }
  accept(result: CollaborationEnvelope) {
    if (
      this.stopped ||
      (result.state.revision ?? 0) < (this.state.revision ?? 0)
    )
      return;
    if (
      result.state.revision === this.state.revision &&
      (result.state.requestsVersion ?? 0) < (this.state.requestsVersion ?? 0)
    )
      return;
    const changed = result.state.revision !== this.state.revision;
    if (result.delta) {
      if (result.delta.from > (this.state.revision ?? 0)) {
        this.nextPollAt = 0;
        return;
      }
      const files = { ...this.files };
      for (const [relative, value] of Object.entries(result.delta.changes)) {
        if (value === null) delete files[relative];
        else files[relative] = value;
      }
      for (const [relative, delta] of Object.entries(
        result.delta.drawings ?? {},
      ))
        applyDrawingDelta(files, relative, delta);
      checkSnapshot(files);
      this.files = this.offline?.local ?? files;
      this.revisions = { ...this.revisions, ...result.revisions };
      this.properties = { ...this.properties, ...result.properties };
      this.authorship = { ...this.authorship, ...result.authorship };
      for (const relative of Object.keys(result.delta.changes))
        if (!this.authorship[relative]) delete this.authorship[relative];
    }
    if (result.files) {
      checkSnapshot(result.files);
      this.files = this.offline?.local ?? result.files;
    }
    if (result.revisions && !result.delta) this.revisions = result.revisions;
    if (result.properties && !result.delta) this.properties = result.properties;
    if (result.authorship && !result.delta) this.authorship = result.authorship;
    else if (result.files) this.authorship = {};
    this.state = {
      ...result.state,
      ...(this.offline
        ? {
            conflicts: this.state.conflicts,
            syncMessage: this.state.syncMessage,
          }
        : {}),
      serverUrl: this.credentials.serverUrl,
      inviteCode:
        result.state.role === 'admin' ? this.credentials.inviteCode : undefined,
      recoveryKey: result.state.members.find(
        (member) => member.id === result.state.memberId,
      )?.owner
        ? this.credentials.recoveryKey
        : undefined,
    };
    this.decorateOffline();
    this.onUpdate(this.state, changed);
  }
  private decorateOffline() {
    this.state = {
      ...this.state,
      pendingChanges: this.offline
        ? changedPaths(this.offline.base, this.offline.local).length
        : this.outgoing
          ? 1
          : 0,
    };
  }
  private publishOffline() {
    this.decorateOffline();
    this.onUpdate(this.state, true);
  }
  private async finishOffline(ack: CollaborationEnvelope, draft: OfflineDraft) {
    const submitted = draft.transaction?.submitted ?? draft.local;
    if (changedPaths(submitted, draft.local).length) {
      this.offline = { base: submitted, local: draft.local };
      await this.persist();
      await this.syncOffline(ack);
    } else {
      this.offline = null;
      this.accept(ack);
      await this.persist();
    }
  }
  private async syncOffline(result: CollaborationEnvelope) {
    if (this.stopped) return;
    if (!this.offline || !result.files) {
      this.accept(result);
      return;
    }
    const draft = this.offline;
    if (result.files[PROJECT_LAYOUT_PATH] && !draft.base[PROJECT_LAYOUT_PATH]) {
      const mapped = remapPendingLayout(result.files, draft.base, draft.local);
      draft.base = mapped.base;
      draft.local = mapped.local;
      draft.transaction = undefined;
      await this.persist();
    }
    // The same persisted ID is retried before planning a new merge. This handles a lost acknowledgement.
    if (draft.transaction) {
      try {
        const ack = (await this.request(
          'offline-sync',
          draft.transaction,
        )) as CollaborationEnvelope;
        await this.finishOffline(ack, draft);
        return;
      } catch (error) {
        if (retryableTransport(error)) throw error;
        draft.transaction = undefined;
        await this.persist();
        // A revision or lock rejection keeps the entire draft for a fresh merge.
        this.state = {
          ...this.state,
          syncMessage: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const plan = planOfflineMerge(draft.base, draft.local, result.files);
    this.state = {
      ...this.state,
      ...result.state,
      serverUrl: this.credentials.serverUrl,
      inviteCode:
        result.state.role === 'admin' ? this.credentials.inviteCode : undefined,
      recoveryKey:
        result.state.role === 'admin'
          ? this.credentials.recoveryKey
          : undefined,
      conflicts: plan.conflicts,
      accessDenied: false,
      syncMessage: undefined,
    };
    this.revisions = result.revisions;
    // Keep the draft displayed until its transaction has been acknowledged.
    this.publishOffline();
    if (
      plan.conflicts.length ||
      result.state.role === 'viewer' ||
      !result.state.offlineSync
    ) {
      if (!result.state.offlineSync)
        this.state.syncMessage =
          '오프라인 작업 반영에는 갱신된 협업 서버가 필요합니다.';
      if (result.state.role === 'viewer')
        this.state.syncMessage =
          '뷰어로 변경되어 반영할 수 없습니다. 내 작업은 이 PC에 보관됩니다.';
      this.publishOffline();
      return;
    }
    const changes = snapshotChanges(result.files, plan.merged);
    if (!Object.keys(changes).length) {
      this.offline = null;
      this.accept(result);
      await this.persist();
      return;
    }
    draft.transaction = {
      id: randomUUID(),
      changes,
      revisions: { ...result.revisions },
      submitted: { ...draft.local },
    };
    await this.persist();
    try {
      const ack = (await this.request(
        'offline-sync',
        draft.transaction,
      )) as CollaborationEnvelope;
      await this.finishOffline(ack, draft);
    } catch (error) {
      if (retryableTransport(error)) throw error;
      draft.transaction = undefined;
      this.state.syncMessage =
        error instanceof Error ? error.message : String(error);
      await this.persist();
      this.publishOffline();
    }
  }
  async resolveConflict(id: string, choice: 'local' | 'server') {
    return this.serial(async () => {
      if (
        !['local', 'server'].includes(choice) ||
        !this.offline ||
        !this.state.connected
      )
        throw new Error('서버 연결 후 충돌 내용을 다시 확인해주세요.');
      const result = (await this.request('state')) as CollaborationEnvelope;
      const plan = planOfflineMerge(
        this.offline.base,
        this.offline.local,
        result.files,
      );
      const selected = plan.conflicts.find((item) => item.id === id);
      if (!selected) {
        await this.syncOffline(result);
        throw new Error(
          '서버 내용이 변경되었습니다. 최신 충돌 내용을 다시 확인해주세요.',
        );
      }
      const previous = structuredClone(this.offline);
      for (const path of selected.paths) {
        if (result.files[path] === undefined) delete this.offline.base[path];
        else this.offline.base[path] = result.files[path];
        if (choice === 'server') {
          if (result.files[path] === undefined) delete this.offline.local[path];
          else this.offline.local[path] = result.files[path];
        }
      }
      this.files = this.offline.local;
      try {
        await this.persist();
      } catch (error) {
        this.offline = previous;
        this.files = previous.local;
        throw error;
      }
      await this.syncOffline(result);
    });
  }
  async request(action: string, input: unknown = {}) {
    return CollaborationClient.fetch(
      this.credentials.serverUrl,
      `/projects/${this.credentials.projectId}/${action}`,
      {
        ...(input as object),
        syncClientVersion: 1,
        lifecycleVersion: this.state.lifecycleVersion ?? 0,
        drawingsVersion: 1,
        drawingTextVersion: 1,
        drawingTextAlignmentVersion: 1,
        drawingEraseVersion: 1,
        gameUiVersion: 2,
        documentStatusesVersion: 1,
        filePropertiesVersion: 1,
        requestDeletionVersion: 1,
        ...(action === 'offline-sync' ? { canvasSheetsVersion: 1 } : {}),
        ...(this.state.deltaSync &&
        action !== 'ai-start' &&
        action !== 'requests-start' &&
        !this.offline &&
        !this.outgoing
          ? { deltaVersion: 1, knownRevision: this.state.revision }
          : {}),
        ...(input as object),
      },
      this.credentials.token,
    );
  }
  async refresh() {
    return this.serial(async () => {
      if (this.stopped) return;
      const previousVersion = this.state.lifecycleVersion ?? 0;
      try {
        if (this.lease)
          await this.request('ai-heartbeat', { lease: this.lease }).catch(
            (error) => {
              if (retryableTransport(error)) throw error;
              this.lease = null;
            },
          );
        let result = (await this.request('state', {
          knownRevision:
            this.offline || this.outgoing ? undefined : this.state.revision,
          renewLocks: [...this.heldLocks].map(([relativePath, token]) => ({
            relativePath,
            token,
          })),
        })) as CollaborationEnvelope;
        if (
          (result.state.lifecycleVersion ?? 0) !== previousVersion &&
          (this.offline || this.outgoing)
        ) {
          this.state = {
            ...this.state,
            lifecycleVersion: result.state.lifecycleVersion,
            projectDeleted: false,
            awaitingResume: true,
            connected: false,
            accessDenied: true,
            message:
              '프로젝트가 복원되었습니다. 미반영 작업 재개를 선택해주세요.',
          };
          this.onUpdate(this.state, true);
          await this.persist();
          return;
        }
        if (this.state.awaitingResume) return;
        if (
          this.outgoing?.local &&
          result.files?.[PROJECT_LAYOUT_PATH] &&
          !this.outgoing.base[PROJECT_LAYOUT_PATH]
        ) {
          const attempted = this.outgoing;
          const pending = remapPendingLayout(
            result.files,
            attempted.base,
            attempted.local!,
          );
          this.offline = this.offline
            ? {
                ...remapPendingLayout(
                  result.files,
                  this.offline.base,
                  this.offline.local,
                ),
              }
            : pending;
          this.files = this.offline.local;
          this.outgoing = null;
          await this.persist();
        }
        if (this.outgoing) {
          const serverState = result;
          const attempted = this.outgoing;
          try {
            result = (await this.request(
              'command',
              this.outgoing.command,
            )) as CollaborationEnvelope;
            if (this.offline && result.delta && serverState.files) {
              const files = { ...serverState.files };
              for (const [relative, raw] of Object.entries(
                result.delta.changes,
              )) {
                if (raw === null) delete files[relative];
                else files[relative] = raw;
              }
              result = {
                ...result,
                delta: undefined,
                files,
                revisions: { ...serverState.revisions, ...result.revisions },
                properties: { ...serverState.properties, ...result.properties },
                authorship: { ...serverState.authorship, ...result.authorship },
              };
            }
            if (this.offline && this.outgoing.local)
              this.offline.base = this.outgoing.local;
            this.outgoing = null;
            await this.persist();
          } catch (error) {
            if (retryableTransport(error)) throw error;
            if ((error as { status?: number }).status !== 409) throw error;
            // A server rejection after the idempotency lookup proves this attempt was not applied.
            if (!this.offline && attempted.local) {
              this.offline = { base: attempted.base, local: attempted.local };
              this.files = this.offline.local;
            }
            this.outgoing = null;
            await this.persist();
          }
        }
        await this.syncOffline(result);
        this.failures = 0;
        this.nextPollAt = 0;
      } catch (error) {
        if (this.stopped) return;
        const code = (error as { code?: string }).code;
        if (code === 'PROJECT_TRASHED' || code === 'PROJECT_PURGED') {
          this.state = {
            ...this.state,
            projectDeleted: true,
            projectPurged: code === 'PROJECT_PURGED',
            accessDenied: true,
            connected: false,
            message:
              code === 'PROJECT_PURGED'
                ? '서버 프로젝트가 영구 삭제되었습니다. 내 사본과 미반영 작업은 보관됩니다.'
                : '관리자가 공동 프로젝트를 삭제했습니다. 내 사본과 미반영 작업은 보관됩니다.',
          };
          this.heldLocks.clear();
          this.onUpdate(this.state, true);
          await this.persist();
          throw error;
        }
        if ((error as { status?: number }).status === 403) this.stream?.abort();
        this.failures++;
        this.nextPollAt =
          Date.now() + Math.min(15_000, 900 * 2 ** Math.min(this.failures, 5));
        this.state = {
          ...this.state,
          connected: false,
          accessDenied:
            this.state.accessDenied ||
            (error as { status?: number }).status === 403,
          message: errorText(failureInfo(error, 'GC-COLLAB-001')),
        };
        this.onUpdate(this.state, false);
        throw error;
      }
    });
  }
  async resumeAfterRestore() {
    this.state = { ...this.state, awaitingResume: false, accessDenied: false };
    await this.refresh();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (
        this.polling ||
        this.busy ||
        this.stopped ||
        this.state.projectPurged ||
        Date.now() < this.nextPollAt
      )
        return;
      this.polling = true;
      void this.refresh()
        .catch(() => undefined)
        .finally(() => {
          this.polling = false;
          if (this.streamConnected && !this.offline && !this.outgoing)
            this.nextPollAt = Date.now() + 10_000;
        });
    }, 3000);
    this.timer.unref?.();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 5000);
    this.heartbeatTimer.unref?.();
    if (this.state.eventStream) void this.connectStream();
  }
  private async heartbeat() {
    if (this.stopped || this.heartbeatBusy) return;
    this.heartbeatBusy = true;
    try {
      const result = (await this.request('state', {
        metadataOnly: true,
        renewLocks: [...this.heldLocks].map(([relativePath, token]) => ({
          relativePath,
          token,
        })),
      })) as CollaborationEnvelope;
      // Metadata never advances the file cursor while a save is in flight.
      this.accept({
        ...result,
        state: { ...result.state, revision: this.state.revision },
      });
      if (this.lease) await this.request('ai-heartbeat', { lease: this.lease });
    } catch {
      /* Refresh handles connection loss and rights revocation. */
    } finally {
      this.heartbeatBusy = false;
    }
  }
  private async connectStream() {
    if (this.stopped || this.stream || !this.state.eventStream) return;
    const controller = new AbortController();
    this.stream = controller;
    try {
      const response = await fetch(
        `${this.credentials.serverUrl}/projects/${this.credentials.projectId}/events`,
        {
          headers: { Authorization: `Bearer ${this.credentials.token}` },
          redirect: 'error',
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) throw new Error('stream unavailable');
      this.streamConnected = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const events = new ProjectEventDecoder();
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of events.push(
          decoder.decode(value, { stream: true }),
        )) {
          if (event.type === 'play-lobby') {
            if (!this.stopped && !this.state.accessDenied)
              this.onPlayLobby(readPlayLobbyEvent(event.data));
          } else if (event.type === 'message' && !this.streamRefreshTimer) {
            this.streamRefreshTimer = setTimeout(() => {
              this.streamRefreshTimer = null;
              if (!this.stopped) void this.refresh().catch(() => undefined);
            }, 100);
          }
        }
      }
    } catch {
      /* Polling remains available if proxies close the stream. */
    } finally {
      this.streamConnected = false;
      this.stream = null;
      if (!this.stopped && !this.state.accessDenied) {
        const retry = setTimeout(() => void this.connectStream(), 5000);
        retry.unref?.();
      }
    }
  }
  stop() {
    this.stopped = true;
    this.stream?.abort();
    if (this.streamRefreshTimer) clearTimeout(this.streamRefreshTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  seedCache(
    result: CollaborationEnvelope & {
      offline?: OfflineDraft | null;
      outgoing?: OnlineAttempt | null;
    },
  ) {
    checkSnapshot(result.files);
    this.files = result.files;
    this.outgoing = result.outgoing ?? null;
    if (result.offline) {
      checkSnapshot(result.offline.base);
      checkSnapshot(result.offline.local);
      this.offline = result.offline;
      this.files = result.offline.local;
    }
    this.revisions = result.revisions;
    this.properties = result.properties ?? {};
    this.authorship = result.authorship ?? {};
    this.state = {
      ...result.state,
      active: true,
      connected: false,
      serverUrl: this.credentials.serverUrl,
      message: '서버 재연결 중입니다. 저장된 사본을 표시합니다.',
    };
    this.publishOffline();
  }
  async modeSnapshot(): Promise<
    import('./contracts/project-mode.ts').ModeSnapshot
  > {
    if (this.state.projectModeVersion !== 1)
      throw Error('프로젝트 전환을 지원하는 서버로 업데이트해주세요.');
    return (await this.request('mode-snapshot', {
      deltaVersion: 0,
    })) as import('./contracts/project-mode.ts').ModeSnapshot;
  }
  async handover(action: 'prepare' | 'accept' | 'cancel', input: object) {
    if (this.state.projectModeVersion !== 1)
      throw Error('프로젝트 전환을 지원하는 서버로 업데이트해주세요.');
    this.accept(
      (await this.request(
        'handover-' + action,
        input,
      )) as CollaborationEnvelope,
    );
  }
  async leave() {
    this.stop();
    await this.request('leave').catch(() => undefined);
  }
  serial<T>(operation: () => Promise<T>): Promise<T> {
    this.busy++;
    const next = this.chain.then(operation).finally(() => {
      this.busy--;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
  async command(channel: string, input: unknown) {
    if (this.state.projectDeleted || this.state.awaitingResume)
      throw Error(
        this.state.message ?? '삭제된 공동 프로젝트는 편집할 수 없습니다.',
      );
    return this.serial(async () => {
      if (channel === 'game-ui:apply' && this.state.gameUiVersion !== 2)
        throw new Error(
          '게임 UI 플러그인을 사용하려면 협업 서버를 업데이트해주세요.',
        );
      if (
        channel === 'projects:import-copy' &&
        (this.state.projectCopyVersion !== 1 ||
          !this.state.connected ||
          this.offline ||
          this.outgoing)
      )
        throw Error(
          '프로젝트 간 복사에는 최신 협업 서버와 온라인 동기화 완료가 필요합니다.',
        );
      if (
        channel === 'tasks:create' &&
        this.state.gamejamTextMaterialsVersion !== 1 &&
        (input as CreateTaskInput).inputPaths?.some((path) =>
          path.startsWith('canvas-text:'),
        )
      )
        throw Error(
          '텍스트 재료를 사용하려면 협업 서버를 v0.35.4 이상으로 업데이트하고 다시 시작해주세요.',
        );
      if (
        channel === 'game-ui:apply' &&
        ['move', 'delete', 'describe'].includes(
          (input as { action: string }).action,
        ) &&
        (this.offline || !this.state.connected || this.state.pendingChanges)
      )
        throw new Error(
          '게임 화면 이동·삭제와 설명 문서 생성은 온라인 동기화 완료 후 진행해주세요.',
        );

      if (
        (channel === 'files:set-status-property' ||
          channel.startsWith('kanban:')) &&
        this.state.filePropertiesVersion !== 1
      )
        throw Error('파일 속성을 편집하려면 협업 서버를 업데이트해주세요.');
      if (
        (channel === 'documents:set-workflow' ||
          channel === 'document-statuses:save') &&
        this.state.documentStatusesVersion !== 1
      )
        throw Error('문서 상태를 사용하려면 협업 서버를 업데이트해주세요.');
      if (
        (channel.startsWith('kanban:') ||
          channel === 'document-statuses:save' ||
          (channel === 'documents:set-workflow' &&
            ((input as { beforeId?: string; afterId?: string }).beforeId ||
              (input as { afterId?: string }).afterId))) &&
        (this.offline || !this.state.connected || this.state.pendingChanges)
      )
        throw Error(
          '상태 설정과 순서 변경은 온라인 동기화 완료 후 진행해주세요.',
        );
      if (
        (channel === 'drawings:apply' || channel === 'canvas:batch') &&
        this.state.drawingsVersion !== 1
      )
        throw new Error(
          '도형 · 그림 편집을 사용하려면 협업 서버를 업데이트해주세요.',
        );
      if (
        channel === 'drawings:apply' &&
        this.state.drawingTextVersion !== 1 &&
        ((input as { objects?: { kind: string }[] }).objects?.some(
          (o) => o.kind === 'text',
        ) ||
          (
            input as { patches?: { geometry?: { document?: string } }[] }
          ).patches?.some((p) => p.geometry?.document !== undefined))
      )
        throw Error('텍스트를 사용하려면 협업 서버를 업데이트해주세요.');
      if (
        channel === 'drawings:apply' &&
        this.state.drawingTextAlignmentVersion !== 1
      ) {
        const drawing = input as {
          objects?: { geometry?: { document?: string } }[];
          patches?: { geometry?: { document?: string } }[];
        };
        if (
          [...(drawing.objects ?? []), ...(drawing.patches ?? [])].some(
            (o) =>
              o.geometry?.document !== undefined &&
              textDocumentHasAlignment(o.geometry.document),
          )
        )
          throw Error(
            '줄별 텍스트 정렬을 사용하려면 협업 서버를 업데이트해주세요.',
          );
      }
      if (
        channel === 'drawings:apply' &&
        (input as { action?: string }).action === 'erase' &&
        this.state.drawingEraseVersion !== 1
      )
        throw Error('부분 지우개를 사용하려면 협업 서버를 업데이트해주세요.');
      if (
        channel === 'drawings:apply' &&
        (input as { action?: string }).action === 'move' &&
        (this.offline || !this.state.connected || this.state.pendingChanges)
      )
        throw new Error(
          '그림의 캔버스 이동은 온라인에서 동기화 완료 후 진행해주세요.',
        );
      if (
        (channel === 'canvases:change' ||
          (channel === 'canvas:batch' &&
            (
              input as {
                commands?: { channel: string; input: { action?: string } }[];
              }
            ).commands?.some(
              (c) =>
                c.channel === 'canvases:change' ||
                (c.channel === 'drawings:apply' && c.input.action === 'move'),
            ))) &&
        (this.offline || !this.state.connected || this.state.pendingChanges)
      )
        throw new Error(
          '캔버스 구성 변경은 동기화 완료 후 온라인에서 진행해주세요.',
        );
      if (this.outgoing && !this.offline)
        throw new Error(
          '이전 저장 요청의 응답을 확인 중입니다. 서버 재연결 후 다시 시도해주세요. 초안은 보관됩니다.',
        );
      if (this.offline || !this.state.connected) {
        if (
          !this.state.offlineSync ||
          this.state.accessDenied ||
          !['admin', 'editor'].includes(this.state.role ?? '')
        )
          throw new Error(
            '오프라인 편집 권한이 없거나 서버 업데이트가 필요합니다.',
          );
        if (channel === 'canvases:change')
          throw new Error(
            '캔버스 구성 변경은 동기화 완료 후 온라인에서 진행해주세요.',
          );
        if (channel === 'tasks:create')
          throw new Error('AI 작업은 동기화 완료 후 온라인에서 실행해주세요.');
        const before = this.files;
        const reduced = reduceCollaboration(before, channel, input);
        if (
          changedPaths(before, reduced.files).some(
            (path) =>
              path.startsWith('.ai/') ||
              path.startsWith('output/') ||
              (path.startsWith('docs/html-sources/') &&
                !(
                  channel === 'files:set-status-property' &&
                  workflowOnlyChange(path, before[path], reduced.files[path])
                )),
          )
        )
          throw new Error(
            'AI·HTML 결과 변경은 온라인에서 동기화 완료 후 진행해주세요.',
          );
        const previous = this.offline;
        const candidate: OfflineDraft = {
          base: previous?.base ?? { ...before },
          local: reduced.files,
          transaction: previous?.transaction,
        };
        this.offline = candidate;
        this.files = reduced.files;
        try {
          await this.persist();
        } catch (error) {
          this.offline = previous;
          this.files = before;
          throw error;
        }
        this.lastCommandHistoryId = null;
        this.state = { ...this.state, conflicts: [], syncMessage: undefined };
        this.publishOffline();
        return reduced.result;
      }
      if (
        channel === 'tasks:create' &&
        ((input as CreateTaskInput).multiplayer !== undefined ||
          (input as CreateTaskInput).thenImplement?.multiplayer !==
            undefined) &&
        this.state.multiplayerVersion !== 1
      )
        throw new Error(
          '[GC-MP-001] 멀티플레이 생성에는 앱과 협업 서버 업데이트가 필요합니다.',
        );
      if (
        channel === 'tasks:create' &&
        ((input as CreateTaskInput)?.kind === 'implement' ||
          (input as CreateTaskInput)?.thenImplement) &&
        !this.state.htmlResultFolders
      )
        throw new CanvasError(
          'GC-AI-004',
          'HTML 결과 폴더를 사용하려면 협업 서버를 v0.8.1 이상으로 업데이트하고 다시 시작해주세요.',
        );
      if (
        (channel === 'results:move' || channel === 'results:organize') &&
        !this.state.structuredResults
      )
        throw new CanvasError(
          'GC-COLLAB-001',
          '결과물 폴더 구조를 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
        );
      if (channel === 'tasks:create' && this.state.role !== 'admin')
        throw new CanvasError(
          'GC-AI-010',
          '관리자만 AI를 직접 실행할 수 있습니다. 팀원은 요청하기로 등록해주세요.',
        );
      if (
        channel === 'tasks:create' &&
        (input as CreateTaskInput)?.documentResult?.structure === 'custom' &&
        !this.state.documentOutputFormats
      )
        throw new CanvasError(
          'GC-AI-004',
          '문서 출력 구성을 편집하려면 앱과 협업 서버를 함께 업데이트해주세요.',
        );
      if (
        channel === 'tasks:create' &&
        (input as CreateTaskInput)?.documentResult?.structure === 'systems' &&
        !this.state.documentBundles
      )
        throw new CanvasError(
          'GC-AI-004',
          '시스템별 문서 생성을 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
        );
      if (
        channel === 'tasks:create' &&
        (input as { thenImplement?: unknown })?.thenImplement !== undefined &&
        !this.state.gamejamWorkflow
      )
        throw new CanvasError(
          'GC-AI-001',
          '연속 실행을 사용하려면 협업 서버를 v0.7.9 이상으로 업데이트해주세요. 개별 단계 실행은 기존 서버에서도 가능합니다.',
        );
      if (
        channel === 'tasks:create' &&
        (input as { resultName?: string })?.resultName &&
        !this.state.taskResultNaming
      )
        throw new CanvasError(
          'GC-AI-001',
          '협업 서버가 결과 이름을 지원하지 않습니다. 서버를 v0.7.7 이상으로 업데이트해주세요.',
        );
      if (
        channel === 'tasks:create' &&
        (input as { instructions?: unknown })?.instructions !== undefined &&
        !this.state.taskInstructionsEditable
      )
        throw new CanvasError(
          'GC-AI-001',
          '협업 서버가 작업 지시 편집을 지원하지 않습니다. 서버를 v0.7.5 이상으로 업데이트해주세요.',
        );
      if (
        ((channel === 'tasks:create' &&
          (input as { sourceMode?: string })?.sourceMode === 'html') ||
          (channel === 'files:import-batch' &&
            (input as { files?: { name: string }[] })?.files?.some((file) =>
              /\.html?$/i.test(file.name),
            ))) &&
        !this.state.htmlImportAnalysis
      )
        throw new CanvasError(
          'GC-AI-007',
          'HTML 불러오기·분석에는 협업 서버 v0.7.10 이상이 필요합니다. 서버를 업데이트해주세요.',
        );
      if (
        channel === 'tasks:create' &&
        !this.state.htmlComposition &&
        ((input as CreateTaskInput)?.sourceMode === 'html-compose' ||
          ((input as CreateTaskInput)?.sourceMode === 'html' &&
            ((input as CreateTaskInput)?.thenImplement ||
              (input as CreateTaskInput)?.kind === 'implement')))
      )
        throw new CanvasError(
          'GC-AI-007',
          'HTML을 구현 재료로 사용하려면 앱과 협업 서버를 함께 v0.10.9 이상으로 업데이트해주세요.',
        );
      if (!this.state.connected)
        throw new Error(
          '서버에 연결되어 있지 않습니다. 초안을 보관하고 재연결을 기다려주세요.',
        );
      if (
        !this.state.structuredResults &&
        ((channel === 'tasks:create' &&
          ((input as CreateTaskInput)?.kind === 'implement' ||
            (input as CreateTaskInput)?.thenImplement)) ||
          (channel === 'files:import-batch' &&
            (input as { files?: { name: string }[] })?.files?.some((file) =>
              /\.html?$/i.test(file.name),
            )))
      )
        throw new CanvasError(
          'GC-COLLAB-001',
          '새 결과물 폴더 구조를 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
        );
      if (
        (channel === 'canvases:change' ||
          (input as { canvasId?: string })?.canvasId) &&
        !this.state.canvasSheets
      )
        throw new Error(
          '여러 캔버스를 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
        );
      const relative = (input as { relativePath?: string })?.relativePath;
      const command: CollaborationCommand = {
        id:
          channel === 'drawings:apply' ||
          channel === 'game-ui:apply' ||
          channel === 'projects:import-copy'
            ? ((input as { requestId?: string }).requestId ?? randomUUID())
            : randomUUID(),
        ...(this.state.propertySync
          ? {
              propertySyncVersion: 1,
              sessionId: this.sessionId,
              sequence: ++this.sequence,
              objects: Object.fromEntries(
                Object.entries(this.files)
                  .filter(([key]) => key.endsWith('.md'))
                  .map(([key, raw]) => [key, objectId(raw) || key]),
              ),
              properties: structuredClone(this.properties),
              deltaVersion: 1,
              knownRevision: this.state.revision,
            }
          : {}),
        canvasSheetsVersion: 1,
        documentStatusesVersion: 1,
        filePropertiesVersion: 1,
        channel,
        input,
        revisions: { ...this.revisions },
        lockToken: relative ? this.heldLocks.get(relative) : undefined,
      };
      const source = input as {
        relativePath?: string;
        objectId?: string;
        structureRevision?: number;
        documentPath?: string;
        revision?: number;
        updates?: {
          relativePath: string;
          revision?: number;
          objectId?: string;
          structureRevision?: number;
        }[];
        documents?: {
          relativePath: string;
          revision?: number;
          objectId?: string;
          structureRevision?: number;
        }[];
      };
      const sourcePath = source.relativePath ?? source.documentPath;
      if (channel === 'documents:save' && sourcePath && command.properties) {
        const contentRevision = (input as { contentRevision?: number })
          .contentRevision;
        if (contentRevision !== undefined)
          command.properties[sourcePath] = {
            ...command.properties[sourcePath],
            content: contentRevision,
          };
      }
      if (
        (channel === 'documents:set-workflow' ||
          channel === 'files:set-status-property' ||
          channel === 'kanban:move-card') &&
        sourcePath &&
        command.properties
      ) {
        const revision = (input as { workflowRevision?: number })
          .workflowRevision;
        if (revision !== undefined)
          command.properties[sourcePath] = {
            ...command.properties[sourcePath],
            workflow: revision,
          };
      }
      const setIdentity = (
        relative: string,
        item: { objectId?: string; structureRevision?: number },
      ) => {
        if (item.objectId !== undefined && command.objects)
          command.objects[relative] = item.objectId;
        if (item.structureRevision !== undefined && command.properties)
          command.properties[relative] = {
            ...command.properties[relative],
            structure: item.structureRevision,
          };
      };
      if (sourcePath) setIdentity(sourcePath, source);
      if (sourcePath && source.revision !== undefined)
        command.revisions[sourcePath] = source.revision;
      if (channel === 'canvas:batch') {
        for (const part of (
          input as {
            commands: {
              channel: string;
              input: { relativePath?: string; revision?: number };
            }[];
          }
        ).commands) {
          if (
            part.channel === 'documents:set-color' &&
            part.input.relativePath &&
            part.input.revision !== undefined
          )
            command.revisions[part.input.relativePath] = part.input.revision;
        }
      }
      for (const item of [
        ...(source.updates ?? []),
        ...(source.documents ?? []),
      ]) {
        setIdentity(item.relativePath, item);
        if (item.revision !== undefined)
          command.revisions[item.relativePath] = item.revision;
      }
      let result: CollaborationEnvelope & {
        result: unknown;
        historyId?: string;
      };
      // Keep the exact operation ID across app crashes and lost responses.
      let preview: Snapshot | undefined;
      if (channel !== 'tasks:create') {
        try {
          preview = reduceCollaboration(this.files, channel, input).files;
        } catch (error) {
          // A confirmed drawing request may be replayed after a lost IPC reply.
          // Let the server resolve its stable operation ID before validating again.
          if (
            (channel !== 'drawings:apply' && channel !== 'game-ui:apply') ||
            !(input as { requestId?: string }).requestId
          )
            throw error;
        }
      }
      this.outgoing = { command, base: { ...this.files }, local: preview };
      try {
        await this.persist();
      } catch (error) {
        this.outgoing = null;
        throw error;
      }
      try {
        result = (await this.request('command', command)) as typeof result;
      } catch (error) {
        // A lost response can be retried safely with the same operation ID.
        if (!retryableTransport(error)) {
          this.outgoing = null;
          await this.persist();
          throw error;
        }
        try {
          result = (await this.request('command', command)) as typeof result;
        } catch (retryError) {
          if (!retryableTransport(retryError)) {
            this.outgoing = null;
            await this.persist();
            throw retryError;
          }
          this.state = {
            ...this.state,
            connected: false,
            locks: [],
            syncMessage: '서버 재연결 후 이전 저장 요청의 결과를 확인합니다.',
          };
          // Deterministic edits can be acknowledged locally. Creations wait for the server's original ID.
          if (
            preview &&
            changedPaths(this.files, preview).every(
              (path) => this.files[path] !== undefined,
            ) &&
            !changedPaths(this.files, preview).some(
              (path) =>
                path.startsWith('.ai/') ||
                (path.startsWith('docs/html-sources/') &&
                  !(
                    channel === 'files:set-status-property' &&
                    workflowOnlyChange(path, this.files[path], preview[path])
                  )),
            )
          ) {
            this.offline = { base: { ...this.files }, local: preview };
            this.files = preview;
            this.lastCommandHistoryId = null;
            await this.persist();
            this.publishOffline();
            return undefined;
          }
          await this.persist();
          this.onUpdate(this.state, false);
          throw retryError;
        }
      }
      this.outgoing = null;
      this.accept(result);
      await this.persist();
      this.lastCommandHistoryId = result.historyId ?? null;
      return result.result;
    });
  }
  async changeHistory(id: string, direction: 'undo' | 'redo') {
    return this.serial(async () => {
      if (!this.state.connected || this.offline || this.outgoing)
        throw new Error(
          '서버 연결과 동기화를 완료한 뒤 실행 취소를 사용해주세요.',
        );
      const input = { id, direction, operationId: randomUUID() };
      let result: CollaborationEnvelope;
      try {
        result = (await this.request(
          'history-change',
          input,
        )) as CollaborationEnvelope;
      } catch (error) {
        if (!retryableTransport(error)) throw error;
        result = (await this.request(
          'history-change',
          input,
        )) as CollaborationEnvelope;
      }
      this.accept(result);
    });
  }
  async lock(relativePath: string) {
    await this.serial(async () => {
      if (this.offline || !this.state.connected) {
        if (
          !this.state.offlineSync ||
          this.state.accessDenied ||
          this.state.role === 'viewer'
        )
          throw new Error('현재 편집 권한이 없습니다.');
        return;
      }
      const result = (await this.request('lock', {
        relativePath,
      })) as CollaborationEnvelope & { lockToken: string };
      this.heldLocks.set(relativePath, result.lockToken);
      this.accept(result);
    });
  }
  async unlock(relativePath: string) {
    await this.serial(async () => {
      const token = this.heldLocks.get(relativePath);
      this.heldLocks.delete(relativePath);
      if (!token) return;
      if (!this.state.connected || this.offline) return;
      const result = (await this.request('unlock', {
        relativePath,
        token,
      })) as CollaborationEnvelope;
      this.accept(result);
    });
  }
  async rotateInvite() {
    const result = (await this.request('invite')) as CollaborationEnvelope & {
      code: string;
    };
    this.credentials.inviteCode = result.code;
    this.accept(result);
    return this.state;
  }
  async renameProject(name: string, expectedName = this.state.projectName) {
    await this.serial(async () => {
      if (!this.state.connected || this.offline || this.outgoing)
        throw new Error(
          '서버에 연결하고 미동기화 작업을 반영한 뒤 이름을 변경해주세요.',
        );
      if (this.state.role !== 'admin')
        throw new Error('공동 프로젝트 이름은 관리자만 변경할 수 있습니다.');
      if (!this.state.projectRename)
        throw new Error(
          '공동 프로젝트 이름 변경을 지원하는 협업 서버로 업데이트해주세요.',
        );
      this.accept(
        (await this.request('rename', {
          name,
          expectedName,
        })) as CollaborationEnvelope,
      );
    });
  }
  async setRole(memberId: string, role: string) {
    this.accept(
      (await this.request('role', { memberId, role })) as CollaborationEnvelope,
    );
  }
  async history() {
    return (await this.request('history')) as HistoryEntry[];
  }
  async readHistory(id: string, relativePath: string, version: string) {
    return (await this.request('history-read', {
      id,
      relativePath,
      version,
    })) as string | null;
  }
  async restore(id: string, relativePath?: string, version?: string) {
    if (!this.state.connected || this.offline || this.outgoing)
      throw new Error(
        '서버 연결과 동기화를 완료한 뒤 히스토리를 복원해주세요.',
      );
    const revision = this.state.revision;
    this.accept(
      (await this.request('restore', {
        id,
        relativePath,
        version,
        revision,
      })) as CollaborationEnvelope,
    );
  }
  async beginAi(
    taskPath: string,
    modelId?: string | null,
    providerId: import('./shared').AiProviderId = 'codex-cli',
    approval?: import('./gamejam-approval.ts').ApprovalStart,
    reasoningEffort?: import('./shared').AiReasoningEffort | null,
  ) {
    return this.serial(async () => {
      if (!this.state.connected || this.offline || this.state.role !== 'admin')
        throw new Error(
          '연결된 관리자만 AI를 실행할 수 있습니다. 팀원은 요청하기로 등록해주세요.',
        );
      if (
        this.files[taskPath] &&
        taskDocumentFormat(this.files[taskPath]) &&
        !this.state.documentOutputFormats
      )
        throw new CanvasError(
          'GC-AI-004',
          '문서 출력 구성을 편집하려면 앱과 협업 서버를 함께 업데이트해주세요.',
        );
      if (
        this.files[taskPath] &&
        documentBundleContract(this.files[taskPath]) &&
        !this.state.documentBundles
      )
        throw new CanvasError(
          'GC-AI-004',
          '시스템별 문서 생성을 사용하려면 앱과 협업 서버를 함께 업데이트해주세요.',
        );
      if (!supportsSharedAiProvider(this.state, providerId))
        throw new CanvasError(
          'GC-AI-010',
          '선택한 AI 제공자를 지원하지 않는 협업 서버입니다. 서버를 업데이트해주세요.',
        );
      if (reasoningEffort && this.state.aiReasoningVersion !== 1)
        throw new Error('추론 수준을 지정하려면 협업 서버를 업데이트해주세요.');
      const result = (await this.request(
        approval ? 'requests-start' : 'ai-start',
        {
          ...(approval
            ? { ...approval, requestRevision: approval.revision }
            : {}),
          taskPath,
          modelId,
          providerId,
          reasoningEffort,
          gamejamVersion: 1,
          multiplayerVersion: 1,
          documentBundleVersion: 1,
          documentOutputFormatVersion: 1,
          htmlAnalysisVersion: 1,
          htmlInputVersion: 1,
          canvasSheetsVersion: 1,
          revision: this.state.revision,
        },
      )) as CollaborationEnvelope & { lease: string; taskPath?: string };
      this.lease = result.lease;
      this.accept(result);
      return { ...result.files };
    });
  }
  async enqueueAi(input: import('./shared').StartCodexRunInput) {
    return this.serial(async () => {
      if (!supportsSharedAiProvider(this.state, input.providerId))
        throw new CanvasError(
          'GC-AI-010',
          '선택한 AI 제공자를 지원하지 않는 협업 서버입니다. 서버를 업데이트해주세요.',
        );
      if (this.state.aiQueueVersion !== 1)
        throw new Error('예약 실행을 사용하려면 협업 서버를 업데이트해주세요.');
      if (input.reasoningEffort && this.state.aiReasoningVersion !== 1)
        throw new Error('추론 수준을 지정하려면 협업 서버를 업데이트해주세요.');
      const action = input.approval ? 'requests-start' : 'ai-start';
      const command = {
        ...input,
        ...(input.approval
          ? { ...input.approval, requestRevision: input.approval.revision }
          : {}),
        queueVersion: 1,
        revision: this.state.revision,
        gamejamVersion: 1,
        multiplayerVersion: 1,
        documentBundleVersion: 1,
        documentOutputFormatVersion: 1,
        htmlAnalysisVersion: 1,
        htmlInputVersion: 1,
        canvasSheetsVersion: 1,
      };
      let response: unknown;
      try {
        response = await this.request(action, command);
      } catch (error) {
        if (!retryableTransport(error)) throw error;
        response = await this.request(action, command);
      }
      const result = response as CollaborationEnvelope & {
        queuedTask: import('./ai-task-queue').AiQueueTask;
      };
      this.accept(result);
      return result.queuedTask;
    });
  }
  async claimAi(taskId: string) {
    return this.serial(async () => {
      const command = {
        taskId,
        claimId: randomUUID(),
        aiReasoningVersion: 1,
        gamejamVersion: 1,
        multiplayerVersion: 1,
        documentBundleVersion: 1,
        documentOutputFormatVersion: 1,
        htmlAnalysisVersion: 1,
        htmlInputVersion: 1,
        canvasSheetsVersion: 1,
      };
      let response: unknown;
      try {
        response = await this.request('ai-claim', command);
      } catch (error) {
        if (!retryableTransport(error)) throw error;
        response = await this.request('ai-claim', command);
      }
      const result = response as CollaborationEnvelope & {
        lease: string | null;
        runId?: string;
        taskPath?: string;
      };
      if (result.lease) this.lease = result.lease;
      this.accept(result);
      return { ...result, files: { ...this.files } };
    });
  }
  async cancelQueuedTask(taskId: string) {
    await this.serial(async () =>
      this.accept(
        (await this.request('ai-queue-cancel', {
          taskId,
        })) as CollaborationEnvelope,
      ),
    );
  }
  async listApprovals() {
    if (this.state.requestApprovalVersion !== 1)
      throw new Error('요청 기능을 사용하려면 협업 서버를 업데이트해주세요.');
    return (await this.request(
      'requests-list',
    )) as import('./gamejam-approval.ts').ApprovalList;
  }
  async readApproval(id: string) {
    return (await this.request('requests-read', {
      id,
    })) as import('./gamejam-approval.ts').ApprovalDetail;
  }
  async readApprovalDocuments(
    id: string,
    revision: number,
    reviewToken: string,
  ) {
    if (this.state.requestDocumentVersion !== 1)
      throw new Error(
        '디스코드 문서 검토를 사용하려면 협업 서버를 업데이트해주세요.',
      );
    return (await this.request('requests-documents', {
      id,
      revision,
      reviewToken,
    })) as import('./discord-review-documents.ts').ApprovalDocuments;
  }
  async mutateApproval(
    action: 'create' | 'update' | 'cancel' | 'feedback' | 'delete',
    input: import('./gamejam-approval.ts').ApprovalMutation,
  ) {
    if (action === 'delete' && this.state.requestDeletionVersion !== 1)
      throw new Error('요청 삭제를 사용하려면 협업 서버를 업데이트해주세요.');
    if (
      !this.state.connected ||
      this.state.accessDenied ||
      this.state.requestApprovalVersion !== 1
    )
      throw new Error(
        '서버 연결과 요청 기능 지원을 확인해주세요. 작성 내용은 보관됩니다.',
      );
    const result = (await this.request(
      `requests-${action}`,
      input,
    )) as import('./gamejam-approval.ts').GamejamApproval;
    await this.refresh();
    return result;
  }
  async progress(event: CodexRunEvent) {
    if (
      !this.lease ||
      !['starting', 'running', 'validating'].includes(event.status)
    )
      return;
    const result = (await this.request('ai-progress', {
      lease: this.lease,
      status: event.status,
    })) as CollaborationEnvelope;
    this.accept(result);
  }
  async finishAi(
    status: string,
    artifacts: Snapshot = {},
    modelId: string | null = null,
    failure?: import('./app-errors').FailureInfo,
  ) {
    const lease = this.lease;
    try {
      this.accept(
        (await this.request('ai-finish', {
          lease,
          status,
          artifacts,
          modelId,
          failure,
        })) as CollaborationEnvelope,
      );
    } finally {
      this.lease = null;
    }
  }
  async cancelAi(runId?: string) {
    this.accept(
      (await this.request('ai-cancel', { runId })) as CollaborationEnvelope,
    );
    this.lease = null;
  }
}
