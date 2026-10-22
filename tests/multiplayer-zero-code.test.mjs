import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import matter from '../src/markdown.ts';
import {
  ProjectEventDecoder,
  readPlayLobbyEvent,
} from '../src/project-events.ts';
import {
  resolveGamejamRequest,
  gamejamTaskInput,
} from '../src/gamejam-request.ts';
import { createTaskPlan } from '../src/task-plan.ts';
import { COOP_REFERENCE_HTML } from '../src/multiplayer/reference-game.ts';
import { PlayClient } from '../src/multiplayer/client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';

const until = async (check) => {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error('Lobby event was not delivered');
};

test('review, approval payload, history and server planning resolve the same plain-text request', () => {
  const request = {
    organize: true,
    implement: true,
    inputPaths: ['ideas/request.md'],
    x: 0,
    y: 0,
    instructions: {
      organize: '정리해줘',
      implement: '선택한 메모로 게임을 만들어줘',
    },
    htmlResult: { mode: 'new' },
    resultName: '사용자 게임',
  };
  const docs = [
    {
      relativePath: 'ideas/request.md',
      body: '온라인으로 3명이 함께 플레이하는 이동 게임',
    },
  ];
  const resolved = resolveGamejamRequest(request, docs, []);
  assert.equal(
    request.multiplayer,
    undefined,
    'Inference must not mutate the editable draft',
  );
  assert.equal(resolved.multiplayer.maxPlayers, 3);
  const approvalPayload = { request: structuredClone(resolved) };
  const task = gamejamTaskInput(approvalPayload.request, {
    providerId: 'codex-cli',
  });
  assert.deepEqual(task.multiplayer, task.thenImplement.multiplayer);
  assert.deepEqual(
    task.requestSnapshot.request.multiplayer,
    resolved.multiplayer,
  );
  const planned = matter(
    createTaskPlan(task, 'resolved', { 'ideas/request.md': docs[0].body }),
  );
  assert.deepEqual(planned.data.multiplayer, resolved.multiplayer);
  const conflicting = [
    ...docs,
    { relativePath: 'ideas/other.md', body: '온라인 4명이 함께 플레이' },
  ];
  const multiInput = {
    ...request,
    inputPaths: conflicting.map((doc) => doc.relativePath),
  };
  assert.throws(
    () => resolveGamejamRequest(multiInput, conflicting, []),
    /GC-MP-031/,
  );
  assert.equal(
    resolveGamejamRequest(
      {
        ...multiInput,
        instructions: {
          ...request.instructions,
          implement: '온라인 2명으로 만들어줘',
        },
      },
      conflicting,
      [],
    ).multiplayer.maxPlayers,
    2,
  );
  assert.equal(
    resolveGamejamRequest({ ...multiInput, multiplayer: null }, conflicting, [])
      .multiplayer,
    null,
  );
  assert.equal(
    resolveGamejamRequest(
      request,
      [{ ...docs[0], body: '같은 PC에서 로컬 멀티 게임' }],
      [],
    ).multiplayer,
    null,
  );
});

test('SSE decoder preserves project messages and separates bounded, split, named lobby events', () => {
  const decoder = new ProjectEventDecoder();
  const epoch = randomUUID();
  const source = `: heartbeat\r\n\r\ndata: {"revision":4}\r\n\r\nevent: play-lobby\r\ndata: {"serverEpoch":"${epoch}","revision":1}\r\n\r\n`;
  const events = [...source].flatMap((character) => decoder.push(character));
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'message');
  assert.equal(events[1].type, 'play-lobby');
  assert.deepEqual(readPlayLobbyEvent(events[1].data), {
    serverEpoch: epoch,
    revision: 1,
  });
  assert.throws(() =>
    readPlayLobbyEvent('{"serverEpoch":"secret","revision":1}'),
  );
  assert.throws(() => new ProjectEventDecoder().push('x'.repeat(65537)));
});

test('authenticated room discovery pushes create and close without project writes or document refresh', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-zero-code-'),
  );
  const server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  const gamePath = 'output/prototypes/coop/v001/index.html';
  const files = {
    'project.md': matter.stringify('Project', {
      id: 'project',
      type: 'idea',
      title: 'Project',
      status: 'draft',
      sources: [],
    }),
    [gamePath]: COOP_REFERENCE_HTML,
  };
  let client;
  t.after(async () => {
    client?.stop();
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const owner = await CollaborationClient.create(
    url,
    '',
    'owner',
    'room discovery',
    files,
  );
  const guest = await CollaborationClient.join(url, owner.result.code, 'guest');
  const events = [];
  client = new CollaborationClient(
    guest.credentials,
    () => {},
    async () => {},
    (event) => events.push(event),
  );
  await client.refresh();
  assert.equal(client.state.multiplayerLobbyVersion, 1);
  let stateReads = 0;
  const original = client.request.bind(client);
  client.request = (...args) => {
    if (args[0] === 'state') stateReads++;
    return original(...args);
  };
  client.start();
  await until(() => events.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 220));
  const before = stateReads;
  const revision = client.state.revision;
  const status = await PlayClient.status(guest.credentials);
  assert.equal(status.multiplayerLobbyVersion, 1);
  const control = (input) =>
    PlayClient.control(owner.credentials, {
      ...input,
      requestId: randomUUID(),
    });
  const result = await control({
    action: 'create',
    path: gamePath,
    sourceHash: createHash('sha256').update(COOP_REFERENCE_HTML).digest('hex'),
  });
  await until(() => events.some((event) => event.revision >= 1));
  assert.equal(
    (await PlayClient.control(guest.credentials, { action: 'list' })).rooms[0]
      .id,
    result.room.id,
  );
  await control({ action: 'leave', roomId: result.room.id });
  await until(() => events.some((event) => event.revision >= 2));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(
    stateReads,
    before,
    'Play events must not trigger document state reads',
  );
  assert.equal(client.state.revision, revision);
  assert.equal(
    (await PlayClient.control(guest.credentials, { action: 'list' })).rooms
      .length,
    0,
  );
  const denied = await fetch(
    `${url}/projects/${owner.credentials.projectId}/events`,
    { headers: { Authorization: 'Bearer invalid' } },
  );
  assert.equal(denied.status, 403);
  const other = await CollaborationClient.create(
    url,
    '',
    'other',
    'other project',
    files,
  );
  const count = events.length;
  await PlayClient.control(other.credentials, {
    action: 'create',
    path: gamePath,
    sourceHash: createHash('sha256').update(COOP_REFERENCE_HTML).digest('hex'),
    requestId: randomUUID(),
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    events.length,
    count,
    'Other projects must not receive lobby hints',
  );
  client.stop();
  const resumed = [];
  client = new CollaborationClient(
    guest.credentials,
    () => {},
    async () => {},
    (event) => resumed.push(event),
  );
  await client.refresh();
  client.start();
  await until(() => resumed.length > 0);
  assert.equal(resumed[0].serverEpoch, events[0].serverEpoch);
  assert.equal(resumed[0].revision, 2);
});

test('server capability checks accept optional-feature fallback and explain unsupported servers', async (t) => {
  let health = { version: '0.24.0', multiplayerVersion: 1 };
  const server = http.createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(health));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const credentials = {
    serverUrl: `http://127.0.0.1:${server.address().port}`,
    projectId: randomUUID(),
    token: 'do-not-send-to-health',
  };
  assert.equal(
    (await PlayClient.status(credentials)).multiplayerLobbyVersion,
    0,
  );
  health = { version: '0.23.0' };
  await assert.rejects(
    PlayClient.status(credentials),
    (error) =>
      error.code === 'GC-MP-032' && error.details.serverVersion === '0.23.0',
  );
  health = {
    version: '0.24.0',
    multiplayerVersion: 1,
    multiplayerLobbyVersion: '1',
  };
  assert.equal(
    (await PlayClient.status(credentials)).multiplayerLobbyVersion,
    0,
  );
});
