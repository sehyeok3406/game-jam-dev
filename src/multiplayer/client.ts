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
  connect() {
    if (this.stopped || this.socket) return;
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
      this.disconnectedAt = 0;
      this.failures = 0;
      socket.send(
        JSON.stringify({
          type: 'attach',
          roomId: this.room.id,
          artifactId: this.room.artifactId,
        }),
      );
      this.notify({ type: 'connection', connected: true });
      if (this.loaded) this.send({ type: 'loaded' });
    });
    socket.on('message', (bytes) => {
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
        this.stopped = true;
        const timeout = playFailure(new PlayError('GC-MP-024'), 'GC-MP-024', {
          side: 'client',
          attempt: this.failures,
          durationMs: Date.now() - this.disconnectedAt,
        });
        this.notify({
          type: 'error',
          code: timeout.code,
          message: timeout.message,
          failure: timeout,
        });
        return;
      }
      if (![4000, 4001, 4003].includes(code) && failure.retryable)
        this.timer = setTimeout(
          () => this.connect(),
          Math.min(4000, 500 * 2 ** this.failures++) + Math.random() * 150,
        );
      else
        this.notify({
          type: 'error',
          code: failure.code,
          message: failure.message,
          failure,
        });
    });
  }
  send(message: PlayMessage) {
    if (message.type === 'loaded') this.loaded = true;
    if (
      !['loaded', 'begun', 'input', 'snapshot', 'finish', 'error'].includes(
        message.type,
      )
    )
      throw new PlayError('GC-MP-020');
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
    this.socket?.terminate();
    this.socket = undefined;
  }
}
