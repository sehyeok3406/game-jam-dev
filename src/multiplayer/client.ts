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

export class PlayClient {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private loaded = false;
  private failures = 0;
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
  static control(credentials: CollaborationCredentials, input: PlayAction) {
    return CollaborationClient.fetch(
      credentials.serverUrl,
      `/projects/${credentials.projectId}/play`,
      input,
      credentials.token,
    ) as Promise<PlayEnvelope>;
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
    socket.on('error', () => {});
    socket.on('open', () => {
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
            throw Error('Game room changed');
          this.room = room;
        }
        this.notify(message);
      } catch {
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
      this.notify({ type: 'connection', connected: false });
      if (!this.stopped && ![4000, 4001, 4003].includes(code))
        this.timer = setTimeout(
          () => this.connect(),
          Math.min(4000, 500 * 2 ** this.failures++) + Math.random() * 150,
        );
      else if (!this.stopped)
        this.notify({
          type: 'error',
          message: '방이 종료되었거나 참여 권한이 변경되었습니다.',
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
      throw Error('허용되지 않는 게임 메시지입니다.');
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
