import { createHash, randomUUID, randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  jsonPayload,
  validateMultiplayerHtml,
  validateSnapshot,
} from './contract.ts';
import type {
  PlayAction,
  PlayArtifact,
  PlayEnvelope,
  PlayMessage,
  PlayRoom,
} from './types.ts';
import {
  PlayError,
  playFailure,
  isPlayCode,
  type PlayErrorCode,
} from './errors.ts';
import type { PlayDiagnostics } from './diagnostics.ts';
import { diagnosticRef } from './diagnostics.ts';
import { isPreviewPath } from '../preview-output.ts';

type Access = {
  id: string;
  nickname: string;
  role: string;
  files: Record<string, string>;
};
type Connection = {
  id: string;
  ws: WebSocket;
  projectId: string;
  token: string;
  memberId: string;
  roomId?: string;
  sequence: number;
  alive: boolean;
  count: number;
  bytes: number;
  since: number;
  slowSince: number;
};
type Room = {
  view: PlayRoom;
  projectId: string;
  artifact: PlayArtifact;
  snapshot?: unknown;
  stateSequence: number;
  lastProgress: number;
  created: number;
  touched: number;
  deadline?: number;
  disconnected: Map<string, number>;
  begun: Set<string>;
};
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function fail(_message: string, code: PlayErrorCode = 'GC-MP-020'): never {
  throw new PlayError(code);
}

/** Ephemeral play rooms: never write project files, revisions, or history. */
export function attachMultiplayerServer(
  server: Server,
  access: (projectId: string, token: string) => Access,
  diagnostics?: PlayDiagnostics,
) {
  const epoch = randomUUID();
  const rooms = new Map<string, Room>();
  const connections = new Set<Connection>();
  const cached = new Map<
    string,
    { signature: string; result: PlayEnvelope; at: number }
  >();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 40 * 1024,
    perMessageDeflate: false,
  });
  let closing = false;
  const actorFor = (projectId: string, token: string) => {
    try {
      return access(projectId, token);
    } catch (error) {
      const failure = playFailure(error, 'GC-MP-008');
      throw new PlayError(failure.code, {}, failure);
    }
  };
  const detailsFor = (room?: Room, c?: Connection) => ({
    side: 'server',
    projectRef: diagnosticRef(room?.projectId ?? c?.projectId),
    roomRef: diagnosticRef(room?.view.id ?? c?.roomId),
    matchRef: diagnosticRef(room?.view.matchId ?? undefined),
    sourceHash: room?.view.sourceHash,
    roomStatus: room?.view.status,
    sessionRef: diagnosticRef(room?.view.serverEpoch),
    sequence: room?.stateSequence,
  });
  const record = (
    error: unknown,
    fallback: PlayErrorCode,
    room?: Room,
    c?: Connection,
  ) =>
    diagnostics?.record(error, fallback, detailsFor(room, c)) ??
    playFailure(error, fallback, detailsFor(room, c));
  const safeAccess = (connection: Connection) => {
    const member = actorFor(connection.projectId, connection.token);
    if (member.id !== connection.memberId)
      fail('참여자 연결이 변경되었습니다.', 'GC-MP-008');
    return member;
  };
  const send = (connection: Connection, message: unknown) => {
    if (connection.ws.readyState !== WebSocket.OPEN) return;
    if (connection.ws.bufferedAmount > 256 * 1024) {
      if (!connection.slowSince) connection.slowSince = Date.now();
      if (Date.now() - connection.slowSince > 2000)
        connection.ws.close(4008, 'slow consumer');
      return;
    }
    connection.slowSince = 0;
    connection.ws.send(JSON.stringify(message));
  };
  const roomConnections = (room: Room) =>
    [...connections].filter(
      (c) => c.roomId === room.view.id && c.projectId === room.projectId,
    );
  const announce = (room: Room) => {
    room.view.revision++;
    room.touched = Date.now();
    for (const connection of roomConnections(room))
      send(connection, { type: 'room', room: room.view });
  };
  const end = (
    room: Room,
    reason: string,
    closeRoom = false,
    failure?: ReturnType<typeof playFailure>,
  ) => {
    room.view.failure = failure;
    room.view.status = closeRoom ? 'closed' : 'finished';
    room.view.reason = reason;
    room.deadline = undefined;
    for (const member of room.view.members) member.ready = false;
    announce(room);
    if (closeRoom) {
      for (const connection of roomConnections(room)) {
        connection.roomId = undefined;
        connection.ws.close(4000, 'room closed');
      }
      rooms.delete(room.view.id);
    }
  };
  const findRoom = (projectId: string, id: unknown) => {
    const room = typeof id === 'string' ? rooms.get(id) : undefined;
    if (!room || room.projectId !== projectId)
      fail('플레이 방을 찾을 수 없습니다.', 'GC-MP-009');
    return room;
  };
  const memberOf = (room: Room, id: string) => {
    const member = room.view.members.find((m) => m.id === id);
    if (!member) fail('이 방의 참가자가 아닙니다.', 'GC-MP-008');
    return member;
  };
  const leave = (room: Room, id: string) => {
    if (room.view.hostId === id) {
      end(room, '방장이 나가 방을 종료했습니다.', true);
      return;
    }
    room.view.members = room.view.members.filter((m) => m.id !== id);
    room.disconnected.delete(id);
    for (const connection of roomConnections(room).filter(
      (c) => c.memberId === id,
    )) {
      connection.roomId = undefined;
      connection.ws.close(4000, 'left');
    }
    if (['running', 'paused', 'loading'].includes(room.view.status))
      end(room, '참가자가 나가 이번 판을 종료했습니다.');
    else announce(room);
  };
  const maybeRun = (room: Room) => {
    if (
      room.view.status !== 'loading' ||
      !room.view.members.every((m) => m.connected && room.begun.has(m.id)) ||
      !room.snapshot
    )
      return;
    room.view.status = 'running';
    room.view.failure = undefined;
    room.deadline = undefined;
    room.lastProgress = Date.now();
    announce(room);
  };
  const control = (
    projectId: string,
    token: string,
    raw: unknown,
  ): PlayEnvelope => {
    const input = raw as PlayAction;
    const actor = actorFor(projectId, token);
    if (!input || typeof input !== 'object')
      fail('플레이 요청을 확인해주세요.');
    jsonPayload(input, 4096);
    if (input.action === 'list')
      return {
        rooms: [...rooms.values()]
          .filter((r) => r.projectId === projectId)
          .map((r) => structuredClone(r.view)),
      };
    const mutate = !['artifact'].includes(input.action);
    if (
      mutate &&
      (typeof input.requestId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(input.requestId))
    )
      fail('요청 식별자를 확인해주세요.');
    const key = `${projectId}:${actor.id}:${input.requestId}`;
    const signature = JSON.stringify(input);
    const old = mutate ? cached.get(key) : undefined;
    if (old) {
      if (old.signature !== signature)
        fail('같은 요청 식별자를 재사용할 수 없습니다.');
      return structuredClone(old.result);
    }
    let result: PlayEnvelope;
    if (input.action === 'create') {
      if (actor.role === 'viewer')
        fail('뷰어는 방을 만들 수 없습니다.', 'GC-MP-008');
      if (
        [...rooms.values()].some(
          (r) =>
            r.projectId === projectId &&
            r.view.members.some((m) => m.id === actor.id),
        )
      )
        fail('이미 참가한 플레이 방이 있습니다.', 'GC-MP-010');
      if (
        rooms.size >= 8 ||
        [...rooms.values()].filter((r) => r.projectId === projectId).length >= 2
      )
        fail('플레이 방 수 제한에 도달했습니다.', 'GC-MP-010');
      if (typeof input.path !== 'string' || !isPreviewPath(input.path))
        fail('HTML 결과를 선택해주세요.', 'GC-MP-001');
      const html = actor.files[input.path];
      if (
        !html ||
        Buffer.byteLength(html) > 8_000_000 ||
        hash(html) !== input.sourceHash
      )
        fail(
          '게임 결과가 변경되었습니다. 최신 결과를 확인해주세요.',
          'GC-MP-012',
        );
      const manifest = validateMultiplayerHtml(html);
      if (!manifest)
        fail(
          '라이브러리의 온라인 멀티플레이 모듈을 추가한 게임이 필요합니다.',
          'GC-MP-014',
        );
      if (
        [...rooms.values()].reduce(
          (n, r) => n + Buffer.byteLength(r.artifact.html),
          Buffer.byteLength(html),
        ) >
        64 * 1024 * 1024
      )
        fail('플레이 소스 메모리 제한에 도달했습니다.', 'GC-MP-010');
      const sourceHash = hash(html),
        artifactId = hash(`${sourceHash}:sdk1`);
      const view: PlayRoom = {
        id: randomUUID(),
        serverEpoch: epoch,
        revision: 1,
        path: input.path,
        title: input.path.split('/').slice(-3).join('/'),
        sourceHash,
        artifactId,
        manifest,
        hostId: actor.id,
        members: [
          {
            id: actor.id,
            nickname: actor.nickname,
            ready: false,
            loaded: false,
            connected: false,
          },
        ],
        status: 'lobby',
        matchId: null,
        seed: 0,
      };
      const room: Room = {
        view,
        projectId,
        artifact: { html, sourceHash, artifactId, sdkVersion: 1 },
        stateSequence: 0,
        lastProgress: 0,
        created: Date.now(),
        touched: Date.now(),
        disconnected: new Map([[actor.id, Date.now() + 15000]]),
        begun: new Set(),
      };
      rooms.set(view.id, room);
      result = { room: structuredClone(view) };
    } else {
      const room = findRoom(projectId, input.roomId);
      if (input.action === 'join') {
        if (room.view.members.some((m) => m.id === actor.id))
          result = { room: structuredClone(room.view) };
        else {
          if (room.view.status !== 'lobby' && room.view.status !== 'finished')
            fail('진행 중인 게임에는 새로 참가할 수 없습니다.', 'GC-MP-011');
          if (room.view.members.length >= room.view.manifest.maxPlayers)
            fail('방이 가득 찼습니다.', 'GC-MP-010');
          if (
            [...rooms.values()].some(
              (r) =>
                r.projectId === projectId &&
                r.view.members.some((m) => m.id === actor.id),
            )
          )
            fail('이미 참가한 플레이 방이 있습니다.', 'GC-MP-010');
          room.view.members.push({
            id: actor.id,
            nickname: actor.nickname,
            ready: false,
            loaded: false,
            connected: false,
          });
          room.disconnected.set(actor.id, Date.now() + 15000);
          announce(room);
          result = { room: structuredClone(room.view) };
        }
      } else {
        const member = memberOf(room, actor.id);
        if (input.action === 'artifact')
          return { artifact: structuredClone(room.artifact) };
        if (input.action === 'leave') {
          leave(room, actor.id);
          result = {};
        } else if (input.action === 'ready') {
          if (
            !['lobby', 'finished'].includes(room.view.status) ||
            !member.loaded ||
            !member.connected
          )
            fail('게임 로딩과 연결을 먼저 확인해주세요.', 'GC-MP-011');
          member.ready = input.ready === true;
          announce(room);
          result = { room: structuredClone(room.view) };
        } else if (input.action === 'start') {
          if (room.view.hostId !== actor.id)
            fail('방장만 시작할 수 있습니다.', 'GC-MP-008');
          if (
            input.expectedRevision !== room.view.revision ||
            !['lobby', 'finished'].includes(room.view.status)
          )
            fail('방 상태가 변경되었습니다. 다시 확인해주세요.', 'GC-MP-011');
          if (
            room.view.members.length < 2 ||
            !room.view.members.every((m) => m.ready && m.loaded && m.connected)
          )
            fail('2명 이상 참가하고 모두 준비해주세요.', 'GC-MP-011');
          room.view.status = 'loading';
          room.view.matchId = randomUUID();
          room.view.seed = randomInt(1, 0x7fffffff);
          room.view.reason = undefined;
          room.view.failure = undefined;
          room.snapshot = undefined;
          room.stateSequence = 0;
          room.begun.clear();
          room.deadline = Date.now() + 10000;
          announce(room);
          result = { room: structuredClone(room.view) };
        } else fail('지원하지 않는 플레이 요청입니다.');
      }
    }
    if (mutate) {
      if (cached.size >= 2048) cached.delete(cached.keys().next().value!);
      cached.set(key, {
        signature,
        result: structuredClone(result),
        at: Date.now(),
      });
    }
    return result;
  };
  server.on('upgrade', (request, socket, head) => {
    try {
      if (closing || request.headers.origin)
        fail('데스크톱 앱에서 연결해주세요.', 'GC-MP-026');
      const match = /^\/projects\/([a-f0-9-]{36})\/play-socket$/.exec(
        request.url ?? '',
      );
      if (!match || connections.size >= 80)
        fail('게임 연결을 수락할 수 없습니다.', 'GC-MP-010');
      const token = String(request.headers.authorization ?? '').replace(
        /^Bearer /,
        '',
      );
      const actor = actorFor(match[1], token);
      if (
        [...connections].filter(
          (c) => c.projectId === match[1] && c.memberId === actor.id,
        ).length >= 2
      )
        fail('연결 수 제한에 도달했습니다.', 'GC-MP-010');
      wss.handleUpgrade(request, socket, head, (ws) => {
        const c: Connection = {
          id: randomUUID(),
          ws,
          projectId: match[1],
          token,
          memberId: actor.id,
          sequence: 0,
          alive: true,
          count: 0,
          bytes: 0,
          since: Date.now(),
          slowSince: 0,
        };
        connections.add(c);
        ws.on('error', (error: Error & { code?: string }) => {
          record(
            new PlayError(
              error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
                ? 'GC-MP-019'
                : 'GC-MP-020',
            ),
            'GC-MP-020',
            rooms.get(c.roomId ?? ''),
            c,
          );
        });
        ws.on('pong', () => {
          c.alive = true;
        });
        ws.on('message', (bytes, binary) => {
          try {
            safeAccess(c);
            if (binary) fail('JSON 메시지만 지원합니다.');
            if (Date.now() - c.since > 1000) {
              c.since = Date.now();
              c.count = 0;
              c.bytes = 0;
            }
            if (
              ++c.count > 90 ||
              (c.bytes += Array.isArray(bytes)
                ? bytes.reduce((n, b) => n + b.byteLength, 0)
                : bytes.byteLength) >
                256 * 1024
            )
              fail('게임 전송량을 초과했습니다.', 'GC-MP-022');
            const message = JSON.parse(bytes.toString()) as PlayMessage;
            jsonPayload(message, 40 * 1024);
            if (message.type === 'attach') {
              const room = findRoom(c.projectId, message.roomId),
                member = memberOf(room, c.memberId);
              if (
                message.artifactId !== room.view.artifactId ||
                (c.roomId && c.roomId !== room.view.id)
              )
                fail('게임 버전·방 연결을 확인해주세요.', 'GC-MP-012');
              for (const other of roomConnections(room).filter(
                (other) => other !== c && other.memberId === c.memberId,
              )) {
                other.roomId = undefined;
                other.ws.close(4001, 'replaced');
              }
              c.roomId = room.view.id;
              c.sequence = 0;
              member.connected = true;
              member.loaded = false;
              member.ready = false;
              room.disconnected.delete(c.memberId);
              announce(room);
              return;
            }
            const room = findRoom(c.projectId, c.roomId),
              member = memberOf(room, c.memberId);
            if (
              message.serverEpoch !== epoch ||
              message.roomId !== room.view.id
            )
              fail('이전 게임 연결입니다.', 'GC-MP-021');
            if (message.type === 'loaded') {
              member.loaded = true;
              announce(room);
              if (['paused', 'running'].includes(room.view.status))
                send(c, {
                  type: 'restore',
                  room: room.view,
                  snapshot: room.snapshot,
                });
              return;
            }
            if (message.matchId !== room.view.matchId)
              fail('이전 판의 메시지입니다.', 'GC-MP-021');
            if (message.type === 'begun') {
              room.begun.add(c.memberId);
              if (
                room.view.status === 'paused' &&
                room.view.members.every((m) => m.connected && m.loaded)
              ) {
                room.view.status = 'loading';
                room.deadline = Date.now() + 10000;
                room.begun.clear();
                announce(room);
                for (const peer of roomConnections(room))
                  send(peer, {
                    type: 'restore',
                    room: room.view,
                    snapshot: room.snapshot,
                  });
              } else maybeRun(room);
              return;
            }
            if (message.type === 'error') {
              const code = isPlayCode(message.code)
                ? message.code
                : 'GC-MP-025';
              const failure = record(
                new PlayError(
                  code,
                  message.diagnostic,
                  playFailure(message.failure ?? { code }, code),
                ),
                code,
                room,
                c,
              );
              end(room, failure.message, false, failure);
              return;
            }
            if (!['running', 'loading'].includes(room.view.status)) return;
            if (message.type === 'input') {
              if (room.view.status !== 'running') return;
              if (
                !Number.isSafeInteger(message.sequence) ||
                Number(message.sequence) <= c.sequence
              )
                return;
              jsonPayload(message.input, 1024);
              c.sequence = Number(message.sequence);
              for (const peer of roomConnections(room).filter(
                (p) => p.memberId === room.view.hostId,
              ))
                send(peer, {
                  type: 'input',
                  playerId: c.memberId,
                  connectionId: c.id,
                  sequence: c.sequence,
                  input: message.input,
                });
            } else if (
              message.type === 'snapshot' ||
              message.type === 'finish'
            ) {
              if (c.memberId !== room.view.hostId)
                fail('방장만 게임 상태를 발행할 수 있습니다.', 'GC-MP-008');
              validateSnapshot(message.snapshot);
              if (
                message.type === 'snapshot' &&
                (!Number.isSafeInteger(message.sequence) ||
                  Number(message.sequence) <= room.stateSequence)
              )
                return;
              room.stateSequence =
                Number(message.sequence) || room.stateSequence + 1;
              room.snapshot = message.snapshot;
              room.lastProgress = Date.now();
              room.touched = room.lastProgress;
              for (const peer of roomConnections(room).filter((p) => p !== c))
                send(peer, { type: 'snapshot', snapshot: room.snapshot });
              maybeRun(room);
              if (message.type === 'finish')
                end(room, '게임이 종료되었습니다.');
            }
          } catch (error) {
            const failure = record(
              error,
              'GC-MP-020',
              rooms.get(c.roomId ?? ''),
              c,
            );
            send(c, {
              type: 'error',
              code: failure.code,
              message: failure.message,
              failure,
            });
            ws.close(4003, 'invalid play message');
          }
        });
        ws.on('close', () => {
          connections.delete(c);
          const room = c.roomId ? rooms.get(c.roomId) : undefined;
          if (!room) return;
          const member = room.view.members.find((m) => m.id === c.memberId);
          if (!member) return;
          member.connected = false;
          member.loaded = false;
          member.ready = false;
          room.disconnected.set(c.memberId, Date.now() + 15000);
          if (
            c.memberId === room.view.hostId &&
            ['running', 'loading'].includes(room.view.status)
          ) {
            room.view.status = 'paused';
            room.view.failure = record(
              new PlayError('GC-MP-005'),
              'GC-MP-005',
              room,
              c,
            );
            room.deadline = Date.now() + 15000;
          }
          announce(room);
        });
      });
    } catch (error) {
      const failure = record(error, 'GC-MP-008');
      socket.end(
        `HTTP/1.1 403 Forbidden\r\nConnection: close\r\nX-GameJam-Error: ${failure.code}\r\nContent-Length: 0\r\n\r\n`,
      );
    }
  });
  const recheck = () => {
    for (const c of connections) {
      try {
        safeAccess(c);
      } catch (error) {
        const room = c.roomId ? rooms.get(c.roomId) : undefined;
        const failure = record(error, 'GC-MP-008', room, c);
        send(c, {
          type: 'error',
          code: failure.code,
          message: failure.message,
          failure,
        });
        if (room) leave(room, c.memberId);
        c.ws.close(4003, 'access revoked');
      }
    }
  };
  const timer = setInterval(() => {
    recheck();
    const now = Date.now();
    for (const c of connections) {
      if (!c.alive) c.ws.terminate();
      else {
        c.alive = false;
        c.ws.ping();
      }
    }
    for (const room of rooms.values()) {
      if (room.view.status === 'running' && now - room.lastProgress > 3000) {
        room.view.status = 'paused';
        room.view.failure = record(
          new PlayError('GC-MP-023'),
          'GC-MP-023',
          room,
        );
        room.deadline = now + 15000;
        announce(room);
      }
      if (room.deadline && room.deadline < now) {
        const failure = record(
          new PlayError(
            room.view.status === 'loading' ? 'GC-MP-013' : 'GC-MP-024',
          ),
          'GC-MP-024',
          room,
        );
        end(room, failure.message, false, failure);
      }
      for (const [id, deadline] of room.disconnected)
        if (deadline < now) leave(room, id);
      if (now - room.touched > 30 * 60_000)
        end(room, '활동 없는 방을 정리했습니다.', true);
    }
    for (const [key, item] of cached)
      if (now - item.at > 10 * 60_000) cached.delete(key);
  }, 2000);
  timer.unref();
  return {
    control,
    recheck,
    close() {
      closing = true;
      clearInterval(timer);
      for (const c of connections) c.ws.terminate();
      connections.clear();
      rooms.clear();
      cached.clear();
      wss.close();
    },
  };
}
