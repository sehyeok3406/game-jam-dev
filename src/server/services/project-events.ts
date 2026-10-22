import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../http/errors.ts';

type EventSource = {
  summary: (projectId: string) => { revision?: number; lifecycle?: unknown };
  memberActive: (projectId: string, memberId: string) => boolean;
};

/** Owns connections and heartbeat lifetime, without retaining project snapshots. */
export class ProjectEvents {
  private readonly streams = new Map<string, Set<ServerResponse>>();
  private readonly heartbeats = new Map<
    ServerResponse,
    ReturnType<typeof setInterval>
  >();
  private readonly lobbyEpoch = randomUUID();
  private readonly lobbyRevisions = new Map<string, number>();
  private readonly source: EventSource;

  constructor(source: EventSource) {
    this.source = source;
  }

  private lobbyEvent(projectId: string) {
    return `event: play-lobby\ndata: ${JSON.stringify({ serverEpoch: this.lobbyEpoch, revision: this.lobbyRevisions.get(projectId) ?? 0 })}\n\n`;
  }

  open(projectId: string, memberId: string, response: ServerResponse) {
    const set = this.streams.get(projectId) ?? new Set<ServerResponse>();
    if (set.size >= 80) throw new ApiError('연결 수가 너무 많습니다.', 429);
    this.streams.set(projectId, set);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    response.write('data: {}\n\n');
    response.write(this.lobbyEvent(projectId));
    set.add(response);
    const heartbeat = setInterval(() => {
      if (!this.source.memberActive(projectId, memberId)) {
        response.end();
        return;
      }
      response.write(': heartbeat\n\n');
    }, 10000);
    this.heartbeats.set(response, heartbeat);
    response.on('close', () => {
      clearInterval(heartbeat);
      this.heartbeats.delete(response);
      set.delete(response);
    });
  }

  announce(projectId: string) {
    for (const response of this.streams.get(projectId) ?? []) {
      if (!response.writableNeedDrain)
        response.write(
          `data: ${JSON.stringify(this.source.summary(projectId))}\n\n`,
        );
      else response.end();
    }
  }

  announcePlayLobby(projectId: string) {
    this.lobbyRevisions.set(
      projectId,
      (this.lobbyRevisions.get(projectId) ?? 0) + 1,
    );
    for (const response of this.streams.get(projectId) ?? []) {
      if (!response.writableNeedDrain)
        response.write(this.lobbyEvent(projectId));
      else response.end();
    }
  }

  purge(projectId: string) {
    for (const response of this.streams.get(projectId) ?? []) {
      response.write('data: {"lifecycle":{"status":"purged"}}\n\n');
      response.end();
    }
    this.streams.delete(projectId);
  }

  close() {
    for (const timer of this.heartbeats.values()) clearInterval(timer);
    this.heartbeats.clear();
    for (const set of this.streams.values())
      for (const response of set) response.end();
    this.streams.clear();
  }
}
