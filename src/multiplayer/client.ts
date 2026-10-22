import { WebSocket } from 'ws';
import {
  CollaborationClient,
  type CollaborationCredentials,
} from '../collaboration-client.ts';
import { jsonPayload } from './contract.ts';
import type {
  PlayAction,
  PlayEnvelope,
  PlayMessage,
  PlayRoom,
  PlayServerStatus,
} from './types.ts';
import {
  PlayError,
  playFailure,
  type PlayErrorCode,
  type PlayFailure,
} from './errors.ts';

export class PlayClient {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private loaded = false;
  private failures = 0;
  private transportFailure?: PlayFailure;
  private disconnectedAt = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private openedAt = 0;
  private lastSeen = 0;
  private attached = false;
  private attachedAt = 0;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private inputSequence = 0;
  private runtimeInputSequence = 0;
  private recoveryExpired() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.recoveryTimer);
    clearInterval(this.watchdog);
    this.socket?.terminate();
    const failure = playFailure(new PlayError('GC-MP-024'), 'GC-MP-024', {
      side: 'client',
      attempt: this.failures,
      durationMs: Date.now() - this.disconnectedAt,
      connectionStage: 'recovering',
    });
    this.notify({
      type: 'error',
      code: failure.code,
      message: failure.message,
      failure,
    });
  }
  /** A successful socket upgrade alone does not mean the play service replied. */
  private checkLiveness(now = Date.now()) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.attached && now - this.attachedAt >= 5000) {
      this.disconnectedAt = 0;
      this.failures = 0;
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }
    if (
      (!this.attached && now - this.openedAt > 8000) ||
      now - this.lastSeen > 10000 ||
      (this.failures > 0 &&
        this.disconnectedAt > 0 &&
        now - this.disconnectedAt >= 20000)
    ) {
      this.transportFailure = playFailure(
        new PlayError('GC-MP-006'),
        'GC-MP-006',
        {
          side: 'client',
          operation: 'connect',
          durationMs: now - this.lastSeen,
        },
      );
      this.socket.terminate();
    }
  }
  readonly credentials: CollaborationCredentials;
  room: PlayRoom;
  private notify: (message: PlayMessage) => void;
  constructor(
    credentials: CollaborationCredentials,
    room: PlayRoom,
    notify: (message: PlayMessage) => void,
  ) {
    this.credentials = credentials;
    this.room = room;
    this.notify = notify;
  }
  static async control(
    credentials: CollaborationCredentials,
    input: PlayAction,
  ) {
    try {
      return (await CollaborationClient.fetch(
        credentials.serverUrl,
        `/projects/${credentials.projectId}/play`,
        input,
        credentials.token,
      )) as PlayEnvelope;
    } catch (error) {
      const failure = playFailure(error, 'GC-MP-007', {
        operation: input.action,
      });
      throw new PlayError(failure.code, failure.details, failure);
    }
  }
  static async status(
    credentials: CollaborationCredentials,
  ): Promise<PlayServerStatus> {
    let raw: Partial<PlayServerStatus>;
    try {
      const response = await fetch(new URL('/health', credentials.serverUrl), {
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok)
        throw new PlayError('GC-MP-007', { httpStatus: response.status });
      raw = (await response.json()) as Partial<PlayServerStatus>;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new PlayError('GC-MP-007');
      jsonPayload(raw, 8192);
    } catch (error) {
      const failure = playFailure(
        error,
        (error as Error)?.name === 'TimeoutError' ? 'GC-MP-006' : 'GC-MP-007',
        { connectionStage: 'server' },
      );
      throw new PlayError(failure.code, failure.details, failure);
    }
    const status = {
      version: typeof raw.version === 'string' ? raw.version : undefined,
      multiplayerVersion: Number.isSafeInteger(raw.multiplayerVersion)
        ? raw.multiplayerVersion!
        : 0,
      multiplayerDiagnosticsVersion: Number.isSafeInteger(
        raw.multiplayerDiagnosticsVersion,
      )
        ? raw.multiplayerDiagnosticsVersion!
        : 0,
      multiplayerLobbyVersion: Number.isSafeInteger(raw.multiplayerLobbyVersion)
        ? raw.multiplayerLobbyVersion!
        : 0,
    };
    if (status.multiplayerVersion !== 1)
      throw new PlayError('GC-MP-032', {
        serverVersion: status.version,
        multiplayerVersion: status.multiplayerVersion,
      });
    return status;
  }
  connect() {
    if (this.stopped || this.socket) return;
    this.notify({
      type: 'connection',
      connected: false,
      stage: this.disconnectedAt ? 'recovering' : 'connecting',
    });
    const url = new URL(
      `/projects/${this.credentials.projectId}/play-socket`,
      this.credentials.serverUrl,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${this.credentials.token}` },
      followRedirects: false,
      handshakeTimeout: 10000,
      maxPayload: 40 * 1024,
      perMessageDeflate: false,
    });
    this.socket = socket;
    let lastFailure: ReturnType<typeof playFailure> | undefined;
    socket.on('error', (error: Error & { code?: string }) => {
      lastFailure ??= playFailure(
        error,
        error.message.includes('timed out') ? 'GC-MP-006' : 'GC-MP-005',
        {
          operation: 'connect',
          side: 'client',
          attempt: this.failures,
          transportCode: error.code,
        },
      );
    });
    socket.on('unexpected-response', (_request, response) => {
      const header = response.headers['x-gamejam-error'];
      lastFailure = playFailure(
        { code: header, status: response.statusCode },
        'GC-MP-007',
        { operation: 'connect', side: 'client' },
      );
      response.resume();
      socket.terminate();
    });
    socket.on('open', () => {
      this.transportFailure = undefined;
      this.openedAt = this.lastSeen = Date.now();
      this.attached = false;
      this.attachedAt = 0;
      this.watchdog = setInterval(() => this.checkLiveness(), 1000);
      this.watchdog.unref();
      socket.send(
        JSON.stringify({
          type: 'attach',
          roomId: this.room.id,
          artifactId: this.room.artifactId,
        }),
      );
      this.notify({ type: 'connection', connected: false, stage: 'joining' });
      if (this.loaded) this.send({ type: 'loaded' });
    });
    socket.on('ping', () => {
      this.lastSeen = Date.now();
    });
    socket.on('pong', () => {
      this.lastSeen = Date.now();
    });
    socket.on('message', (bytes) => {
      this.lastSeen = Date.now();
      try {
        const message = JSON.parse(bytes.toString()) as PlayMessage;
        jsonPayload(message, 48 * 1024);
        if (message.type === 'room') {
          const room = message.room as PlayRoom;
          if (
            room.id !== this.room.id ||
            room.serverEpoch !== this.room.serverEpoch
          )
            throw new PlayError('GC-MP-021');
          this.room = room;
          if (!this.attached) {
            this.attached = true;
            this.attachedAt = Date.now();
            this.notify({
              type: 'connection',
              connected: true,
              stage: this.loaded ? 'ready' : 'preparing',
            });
          }
        }
        if (
          message.type === 'error' ||
          (message.type === 'room' && this.room.failure)
        ) {
          const failure = playFailure(
            message.type === 'room'
              ? this.room.failure
              : (message.failure ?? { code: message.code }),
            'GC-MP-020',
          );
          if (message.type === 'error') {
            message.failure = failure;
            message.code = failure.code;
            message.message = failure.message;
            lastFailure = failure;
          } else this.room.failure = failure;
        }
        this.notify(message);
      } catch (error) {
        lastFailure = playFailure(error, 'GC-MP-020', {
          side: 'client',
          operation: 'receive',
        });
        socket.close(4003, 'invalid server message');
      }
    });
    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      clearInterval(this.watchdog);
      this.socket = undefined;
      if (this.room.status === 'closed') {
        this.stopped = true;
        return;
      }
      if (this.stopped) return;
      this.disconnectedAt ||= Date.now();
      const fallback: PlayErrorCode =
        code === 4008 || code === 1009
          ? 'GC-MP-022'
          : code === 4001
            ? 'GC-MP-021'
            : code === 4003
              ? 'GC-MP-008'
              : 'GC-MP-005';
      const failure = playFailure(
        lastFailure ?? this.transportFailure,
        fallback,
        {
          closeCode: code,
          attempt: this.failures,
          side: 'client',
        },
      );
      this.notify({ type: 'connection', connected: false, failure });
      if (this.failures >= 6 || Date.now() - this.disconnectedAt >= 20000) {
        this.recoveryExpired();
        return;
      }
      if (![4000, 4001, 4003].includes(code) && failure.retryable) {
        this.recoveryTimer ??= setTimeout(
          () => this.recoveryExpired(),
          Math.max(0, 20000 - (Date.now() - this.disconnectedAt)),
        );
        this.recoveryTimer.unref();
        this.timer = setTimeout(
          () => this.connect(),
          Math.min(4000, 500 * 2 ** this.failures++) + Math.random() * 150,
        );
      } else {
        this.stopped = true;
        clearTimeout(this.recoveryTimer);
        this.notify({
          type: 'error',
          code: failure.code,
          message: failure.message,
          failure,
        });
      }
    });
  }
  send(message: PlayMessage) {
    if (message.type === 'loaded') this.loaded = true;
    if (message.type === 'loaded' || message.type === 'begun')
      this.runtimeInputSequence = 0;
    if (
      !['loaded', 'begun', 'input', 'snapshot', 'finish', 'error'].includes(
        message.type,
      )
    )
      throw new PlayError('GC-MP-020');
    if (message.type === 'input') {
      const sequence = message.sequence;
      if (
        typeof sequence !== 'number' ||
        !Number.isSafeInteger(sequence) ||
        sequence <= this.runtimeInputSequence
      )
        return;
      // A fresh iframe or match restarts the SDK counter; the transport does not.
      this.runtimeInputSequence = sequence;
      message = { ...message, sequence: ++this.inputSequence };
    }
    const encoded = jsonPayload(
      {
        ...message,
        roomId: this.room.id,
        serverEpoch: this.room.serverEpoch,
        matchId: this.room.matchId,
      },
      40 * 1024,
    );
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount >= 256 * 1024
    ) {
      const failure = playFailure(new PlayError('GC-MP-022'), 'GC-MP-022', {
        side: 'client',
        bytes: this.socket.bufferedAmount,
        limit: 256 * 1024,
      });
      this.transportFailure = failure;
      this.notify({
        type: 'error',
        code: failure.code,
        message: failure.message,
        failure,
      });
      this.socket.terminate();
      return;
    }
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < 256 * 1024
    )
      this.socket.send(encoded);
  }
  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.recoveryTimer);
    clearInterval(this.watchdog);
    this.socket?.terminate();
    this.socket = undefined;
  }
}
