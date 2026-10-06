import { randomUUID } from 'node:crypto';
import type {
  CollaborationState,
  CreateTaskInput,
  CodexRunEvent,
  HistoryEntry,
  FileAuthorshipMap,
} from './shared.ts';
import type { Snapshot } from './project-store.ts';
import { checkSnapshot } from './collaboration-model.ts';
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
  readonly credentials: CollaborationCredentials;
  private readonly onUpdate: (
    state: CollaborationState,
    changed: boolean,
  ) => void;
  constructor(
    credentials: CollaborationCredentials,
    onUpdate: (state: CollaborationState, changed: boolean) => void,
  ) {
    serverAddress(credentials.serverUrl);
    if (!/^[a-f0-9-]{36}$/.test(credentials.projectId))
      throw new Error('서버가 반환한 프로젝트 ID가 올바르지 않습니다.');
    this.credentials = credentials;
    this.onUpdate = onUpdate;
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
      if (!value || typeof value !== 'object')
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
        throw new Error(value.error ?? `협업 서버 오류 (${response.status})`);
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
      this.files = result.files;
    }
    if (result.revisions) this.revisions = result.revisions;
    if (result.authorship) this.authorship = result.authorship;
    else if (result.files) this.authorship = {};
    this.state = {
      ...result.state,
      serverUrl: this.credentials.serverUrl,
      inviteCode:
        result.state.role === 'admin' ? this.credentials.inviteCode : undefined,
      recoveryKey: result.state.members.find(
        (member) => member.id === result.state.memberId,
      )?.owner
        ? this.credentials.recoveryKey
        : undefined,
    };
    this.onUpdate(this.state, changed);
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
    try {
      if (this.lease)
        await this.request('ai-heartbeat', { lease: this.lease }).catch(() => {
          this.lease = null;
        });
      const result = (await this.request('state', {
        knownRevision: this.state.revision,
        renewLocks: [...this.heldLocks].map(([relativePath, token]) => ({
          relativePath,
          token,
        })),
      })) as CollaborationEnvelope;
      this.accept(result);
      this.failures = 0;
      this.nextPollAt = 0;
    } catch (error) {
      this.failures++;
      this.nextPollAt =
        Date.now() + Math.min(15_000, 900 * 2 ** Math.min(this.failures, 5));
      this.state = {
        ...this.state,
        connected: false,
        message: errorText(failureInfo(error, 'GC-COLLAB-001')),
      };
      this.onUpdate(this.state, false);
      throw error;
    }
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
  seedCache(result: CollaborationEnvelope) {
    checkSnapshot(result.files);
    this.files = result.files;
    this.revisions = result.revisions;
    this.authorship = result.authorship ?? {};
    this.state = {
      ...result.state,
      active: true,
      connected: false,
      serverUrl: this.credentials.serverUrl,
      message: '서버 재연결 중입니다. 저장된 사본을 표시합니다.',
    };
    this.onUpdate(this.state, true);
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
      if (!this.state.connected)
        throw new Error(
          '서버에 연결되어 있지 않습니다. 초안을 보관하고 재연결을 기다려주세요.',
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
      try {
        result = (await this.request('command', command)) as typeof result;
      } catch (error) {
        // A lost response can be retried safely with the same operation ID.
        if (!retryableTransport(error)) throw error;
        result = (await this.request('command', command)) as typeof result;
      }
      this.accept(result);
      this.lastCommandHistoryId = result.historyId ?? null;
      return result.result;
    });
  }
  async changeHistory(id: string, direction: 'undo' | 'redo') {
    return this.serial(async () => {
      if (!this.state.connected) throw new Error('서버에 먼저 연결해주세요.');
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
      if (!this.state.connected || this.state.role === 'viewer')
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
