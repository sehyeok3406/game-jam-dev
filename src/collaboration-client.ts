import { randomUUID } from 'node:crypto';
import type {
  CollaborationState,
  CreateTaskInput,
  CodexRunEvent,
  HistoryEntry,
  FileAuthorshipMap,
} from './shared.ts';
import type { Snapshot } from './project-store.ts';
import { checkSnapshot, reduceCollaboration } from './collaboration-model.ts';
import {
  changedPaths,
  planOfflineMerge,
  snapshotChanges,
} from './offline-sync.ts';
import { CanvasError, errorText, failureInfo } from './app-errors.ts';
import type {
  CollaborationCommand,
  CollaborationEnvelope,
} from './collaboration-server.ts';

export type CollaborationCredentials = {
  serverUrl: string;
  projectId: string;
  token: string;
  inviteCode?: string;
  recoveryKey?: string;
  internalServer?: boolean;
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
    ['GC-NET-001', 'GC-NET-002'].includes(error.code));

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
  readonly credentials: CollaborationCredentials;
  private readonly onUpdate: (
    state: CollaborationState,
    changed: boolean,
  ) => void;
  constructor(
    credentials: CollaborationCredentials,
    onUpdate: (state: CollaborationState, changed: boolean) => void,
    persist: () => Promise<void> = async () => {},
  ) {
    serverAddress(credentials.serverUrl);
    if (!/^[a-f0-9-]{36}$/.test(credentials.projectId))
      throw new Error('서버가 반환한 프로젝트 ID가 올바르지 않습니다.');
    this.credentials = credentials;
    this.onUpdate = onUpdate;
    this.persist = persist;
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
    const result = (await this.fetch(
      serverAddress(serverUrl),
      '/projects',
      { nickname, name, files },
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
    return this.transport(serverUrl, endpoint, input, token, key);
  }
  static async recover(
    serverUrl: string,
    projectId: string,
    recoveryKey: string,
  ) {
    const result = (await this.fetch(serverAddress(serverUrl), '/recover', {
      projectId,
      recoveryKey,
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
    let response: Response;
    try {
      response = await fetch(`${serverUrl}${endpoint}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(key ? { 'X-Server-Key': key } : {}),
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      const timeout = (error as { name?: string })?.name === 'TimeoutError';
      throw new CanvasError(
        timeout ? 'GC-NET-001' : 'GC-NET-002',
        timeout
          ? '협업 서버 연결 시간이 초과되었습니다.'
          : '협업 서버에 연결할 수 없습니다.',
        { endpoint },
      );
    }
    if (response.status === 429)
      throw new CanvasError(
        'GC-NET-004',
        '협업 서버의 요청 제한에 도달했습니다.',
        {
          endpoint,
          status: 429,
        },
      );
    let value: { error?: string };
    try {
      value = (await response.json()) as typeof value;
      if (
        (!value || typeof value !== 'object') &&
        !(
          response.ok &&
          endpoint.endsWith('/history-read') &&
          (value === null || typeof value === 'string')
        )
      )
        throw new Error('Invalid response');
    } catch (error) {
      if ((error as { name?: string })?.name === 'TimeoutError')
        throw new CanvasError(
          'GC-NET-001',
          '협업 서버 응답 시간이 초과되었습니다.',
          {
            endpoint,
            status: response.status,
          },
        );
      throw new CanvasError(
        'GC-NET-003',
        `협업 서버가 올바른 응답을 반환하지 않았습니다. (HTTP ${response.status})`,
        {
          endpoint,
          status: response.status,
        },
      );
    }
    if (!response.ok)
      if (response.status >= 500)
        throw new CanvasError(
          'GC-NET-003',
          `협업 서버가 요청을 처리하지 못했습니다. (HTTP ${response.status})`,
          {
            endpoint,
            status: response.status,
          },
        );
      else
        throw Object.assign(
          new Error(value.error ?? `협업 서버 오류 (${response.status})`),
          { status: response.status },
        );
    return value;
  }
  accept(result: CollaborationEnvelope) {
    if (
      this.stopped ||
      (result.state.revision ?? 0) < (this.state.revision ?? 0)
    )
      return;
    const changed = result.state.revision !== this.state.revision;
    if (result.files) {
      checkSnapshot(result.files);
      this.files = this.offline?.local ?? result.files;
    }
    if (result.revisions) this.revisions = result.revisions;
    if (result.authorship) this.authorship = result.authorship;
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
      input,
      this.credentials.token,
    );
  }
  async refresh() {
    return this.serial(async () => {
      if (this.stopped) return;
      try {
        if (this.lease)
          await this.request('ai-heartbeat', { lease: this.lease }).catch(
            () => {
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
        if (this.outgoing) {
          const attempted = this.outgoing;
          try {
            result = (await this.request(
              'command',
              this.outgoing.command,
            )) as CollaborationEnvelope;
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
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (
        this.polling ||
        this.busy ||
        this.stopped ||
        Date.now() < this.nextPollAt
      )
        return;
      this.polling = true;
      void this.refresh()
        .catch(() => undefined)
        .finally(() => {
          this.polling = false;
        });
    }, 900);
    this.timer.unref?.();
  }
  stop() {
    this.stopped = true;
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
    return this.serial(async () => {
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
        if (channel === 'tasks:create')
          throw new Error('AI 작업은 동기화 완료 후 온라인에서 실행해주세요.');
        const before = this.files;
        const reduced = reduceCollaboration(before, channel, input);
        if (
          changedPaths(before, reduced.files).some(
            (path) =>
              path.startsWith('.ai/') ||
              path.startsWith('output/') ||
              path.startsWith('docs/html-sources/'),
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
      if (
        channel === 'tasks:create' &&
        this.state.role === 'editor' &&
        !this.state.editorAi
      )
        throw new CanvasError(
          'GC-AI-010',
          '편집자 AI 실행에는 협업 서버 v0.8.0 이상이 필요합니다.',
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
      const relative = (input as { relativePath?: string })?.relativePath;
      const command: CollaborationCommand = {
        id: randomUUID(),
        channel,
        input,
        revisions: { ...this.revisions },
        lockToken: relative ? this.heldLocks.get(relative) : undefined,
      };
      const source = input as {
        relativePath?: string;
        documentPath?: string;
        revision?: number;
        updates?: { relativePath: string; revision?: number }[];
        documents?: { relativePath: string; revision?: number }[];
      };
      const sourcePath = source.relativePath ?? source.documentPath;
      if (sourcePath && source.revision !== undefined)
        command.revisions[sourcePath] = source.revision;
      for (const item of [
        ...(source.updates ?? []),
        ...(source.documents ?? []),
      ])
        if (item.revision !== undefined)
          command.revisions[item.relativePath] = item.revision;
      let result: CollaborationEnvelope & {
        result: unknown;
        historyId?: string;
      };
      // Keep the exact operation ID across app crashes and lost responses.
      const preview =
        channel !== 'tasks:create'
          ? reduceCollaboration(this.files, channel, input).files
          : undefined;
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
                path.startsWith('docs/html-sources/'),
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
  ) {
    return this.serial(async () => {
      if (!this.state.connected || this.offline || this.state.role === 'viewer')
        throw new Error('연결된 관리자·편집자만 AI를 실행할 수 있습니다.');
      if (
        (this.state.role === 'editor' && !this.state.editorAi) ||
        (providerId !== 'codex-cli' && !this.state.multiProviderAi)
      )
        throw new CanvasError(
          'GC-AI-010',
          'AI 실행에는 협업 서버 v0.8.0 이상이 필요합니다.',
        );
      const result = (await this.request('ai-start', {
        taskPath,
        modelId,
        providerId,
        gamejamVersion: 1,
        htmlAnalysisVersion: 1,
        htmlInputVersion: 1,
        revision: this.state.revision,
      })) as CollaborationEnvelope & { lease: string };
      this.lease = result.lease;
      this.accept(result);
      return { ...result.files };
    });
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
  async cancelAi() {
    this.accept((await this.request('ai-cancel')) as CollaborationEnvelope);
    this.lease = null;
  }
}
