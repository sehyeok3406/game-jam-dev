import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { PlayClient } from '../src/multiplayer/client.ts';
import { DEFAULT_MULTIPLAYER } from '../src/multiplayer/types.ts';
import { COOP_REFERENCE_HTML } from '../src/multiplayer/reference-game.ts';
import {
  jsonPayload,
  readMultiplayerManifest,
  validateMultiplayerHtml,
} from '../src/multiplayer/contract.ts';
import { createTaskPlan, workflowStages } from '../src/task-plan.ts';
import { gamejamTaskInput } from '../src/gamejam-request.ts';
import { withMultiplayerSdk } from '../src/multiplayer/sdk.ts';
import { validateHtmlAnalysis } from '../src/html-source.ts';

const gamePath = 'output/prototypes/coop/v001/index.html';
const note = matter.stringify('test idea', {
  id: 'idea-a',
  title: 'a',
  type: 'idea',
  status: 'draft',
  sources: [],
});
const files = () => ({
  'project.md': matter.stringify('project', {
    id: 'project',
    title: 'test',
    type: 'idea',
    status: 'draft',
    sources: [],
  }),
  'ideas/a.md': note,
  [gamePath]: COOP_REFERENCE_HTML,
});
async function waitFor(condition, label) {
  for (let n = 0; n < 150; n++) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error('Timed out: ' + label);
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-mp-'));
  const server = await createCollaborationServer({
    dataDirectory: directory,
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  const created = await CollaborationClient.create(
    url,
    '',
    'owner',
    'coop',
    files(),
  );
  const joined = await CollaborationClient.join(
    url,
    created.result.code,
    'editor',
  );
  const third = await CollaborationClient.join(
    url,
    created.result.code,
    'viewer',
  );
  const control = (auth, input) =>
    PlayClient.control(auth, { requestId: randomUUID(), ...input });
  const clients = [];
  t.after(async () => {
    clients.forEach((c) => c.close());
    await server.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const make = async (auth, room) => {
    const messages = [];
    const client = new PlayClient(auth, room, (message) =>
      messages.push(message),
    );
    clients.push(client);
    client.connect();
    await waitFor(
      () => messages.some((m) => m.type === 'room'),
      'socket attach',
    );
    client.send({ type: 'loaded' });
    await waitFor(
      () =>
        client.room.members.find((m) => m.id === auth.memberId)?.loaded ??
        messages.some(
          (m) =>
            m.type === 'room' && m.room.members.some((member) => member.loaded),
        ),
      'loaded',
    );
    return { client, messages };
  };
  return { server, url, created, joined, third, control, make };
}

test('multiplayer contract validates portable games and bounded JSON; SDK precedes game scripts', () => {
  assert.equal(validateMultiplayerHtml(COOP_REFERENCE_HTML).maxPlayers, 2);
  assert.throws(
    () =>
      validateMultiplayerHtml(COOP_REFERENCE_HTML, {
        ...DEFAULT_MULTIPLAYER,
        maxPlayers: 4,
      }),
    /인원/,
  );
  assert.throws(
    () =>
      validateMultiplayerHtml(
        COOP_REFERENCE_HTML.replace(
          '</body>',
          '<script src="https://invalid.example/a.js"></script></body>',
        ),
      ),
    /단일 HTML/,
  );
  assert.throws(
    () =>
      readMultiplayerManifest(
        COOP_REFERENCE_HTML.replace('"solo":true', '"solo":false'),
      ),
    /설정/,
  );
  for (const value of [
    NaN,
    Infinity,
    () => {},
    { x: undefined },
    JSON.parse('{"__proto__":1}'),
  ])
    assert.throws(() => jsonPayload(value, 1024));
  assert.throws(() => jsonPayload({ x: 'a'.repeat(2048) }, 1024), /GC-MP-019/);
  const injected = withMultiplayerSdk(COOP_REFERENCE_HTML);
  assert.ok(
    injected.indexOf('installMultiplayerSdk') <
      injected.indexOf('const canvas='),
  );
  assert.equal(
    withMultiplayerSdk('<body>ordinary game</body>'),
    '<body>ordinary game</body>',
  );
  const invalid = COOP_REFERENCE_HTML.replace(
    '"sdkVersion":1',
    '"sdkVersion":99',
  );
  assert.equal(
    withMultiplayerSdk(invalid),
    invalid,
    'unsupported imported declarations cannot crash the canvas',
  );
});

test('generation carries module through two stages and explicitly removes or inherits an existing module', () => {
  const request = {
    organize: true,
    implement: true,
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    resultName: 'coop',
    instructions: { organize: 'organize', implement: 'implement' },
    multiplayer: DEFAULT_MULTIPLAYER,
  };
  const input = gamejamTaskInput(request, {
    providerId: 'codex-cli',
    modelId: 'fixture',
  });
  assert.deepEqual(input.thenImplement.multiplayer, DEFAULT_MULTIPLAYER);
  const task = createTaskPlan(input, 'task', files());
  const stages = workflowStages(task);
  assert.equal(matter(stages[0]).data.multiplayer, undefined);
  assert.deepEqual(matter(stages[1]).data.multiplayer, DEFAULT_MULTIPLAYER);
  assert.ok(stages[1].includes('GameJamMultiplayer.register'));
  const base = {
    kind: 'implement',
    inputPaths: ['ideas/a.md'],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new', basePath: gamePath },
  };
  const inherited = createTaskPlan(base, 'inherit', files());
  assert.deepEqual(matter(inherited).data.multiplayer, DEFAULT_MULTIPLAYER);
  const removed = createTaskPlan(
    { ...base, multiplayer: null },
    'remove',
    files(),
  );
  assert.equal(matter(removed).data.multiplayer, null);
  const target = matter(inherited).data.expected_outputs[0];
  assert.throws(
    () =>
      validateHtmlAnalysis(
        inherited,
        { ...files(), [target]: '<body>single</body>' },
        [target],
      ),
    /반영/,
  );
  const organize = gamejamTaskInput({ ...request, implement: false });
  assert.equal(organize.multiplayer, undefined);
  const secondPath = 'output/prototypes/second/v001/index.html';
  const merged = { ...files(), [secondPath]: COOP_REFERENCE_HTML };
  const composition = {
    kind: 'implement',
    sourceMode: 'html-compose',
    inputPaths: [gamePath, secondPath],
    x: 0,
    y: 0,
    htmlResult: { mode: 'new' },
  };
  assert.throws(
    () => createTaskPlan(composition, 'mixed', merged),
    /라이브러리/,
  );
  assert.deepEqual(
    matter(
      createTaskPlan(
        { ...composition, multiplayer: DEFAULT_MULTIPLAYER },
        'mixed-online',
        merged,
      ),
    ).data.multiplayer,
    DEFAULT_MULTIPLAYER,
  );
  assert.equal(
    matter(
      createTaskPlan(
        { ...composition, multiplayer: null },
        'mixed-solo',
        merged,
      ),
    ).data.multiplayer,
    null,
  );
});

test('real authenticated rooms start, relay only host state, preserve project revisions, and revoke participants', async (t) => {
  const { url, created, joined, third, control, make } = await setup(t);
  const owner = created.credentials,
    editor = joined.credentials,
    viewer = third.credentials;
  await CollaborationClient.fetch(
    url,
    `/projects/${owner.projectId}/role`,
    { memberId: third.result.state.memberId, role: 'viewer' },
    owner.token,
  );
  await assert.rejects(
    control(viewer, {
      action: 'create',
      path: gamePath,
      sourceHash: createHash('sha256')
        .update(COOP_REFERENCE_HTML)
        .digest('hex'),
    }),
    /GC-MP-008/,
  );
  const create = {
    action: 'create',
    path: gamePath,
    sourceHash: createHash('sha256').update(COOP_REFERENCE_HTML).digest('hex'),
    requestId: randomUUID(),
  };
  const first = await control(owner, create);
  const repeated = await control(owner, create);
  assert.equal(first.room.id, repeated.room.id);
  const roomId = first.room.id;
  const room = (await control(viewer, { action: 'join', roomId })).room;
  await assert.rejects(
    control(editor, { action: 'join', roomId }),
    /GC-MP-010/,
  );
  const host = await make(owner, room),
    guest = await make(viewer, room);
  await waitFor(
    () => host.client.room.members.every((m) => m.loaded),
    'both loaded',
  );
  await control(owner, { action: 'ready', roomId, ready: true });
  await control(viewer, { action: 'ready', roomId, ready: true });
  let current = (await control(owner, { action: 'list' })).rooms[0];
  await control(owner, {
    action: 'start',
    roomId,
    expectedRevision: current.revision,
  });
  await waitFor(
    () =>
      host.client.room.status === 'loading' &&
      guest.client.room.status === 'loading',
    'start barrier',
  );
  host.client.send({ type: 'begun' });
  guest.client.send({ type: 'begun' });
  const snapshot = {
    state: { score: 1 },
    tick: 1,
    rng: 1,
    emission: 1,
    sequences: [],
  };
  host.client.send({ type: 'snapshot', sequence: 1, snapshot });
  await waitFor(
    () =>
      host.client.room.status === 'running' &&
      guest.messages.some((m) => m.type === 'snapshot'),
    'running',
  );
  guest.client.send({ type: 'input', sequence: 1, input: { x: 1 } });
  await waitFor(
    () =>
      host.messages.some(
        (m) => m.type === 'input' && m.playerId === third.result.state.memberId,
      ),
    'authenticated input identity',
  );
  const inputsBeforeReload = host.messages.filter(
    (m) => m.type === 'input',
  ).length;
  guest.client.send({ type: 'loaded' });
  guest.client.send({ type: 'begun' });
  guest.client.send({ type: 'input', sequence: 1, input: { y: 1 } });
  await waitFor(
    () =>
      host.messages.filter((m) => m.type === 'input').length ===
      inputsBeforeReload + 1,
    'fresh iframe input accepted on the existing socket',
  );
  const latestInput = host.messages.filter((m) => m.type === 'input').at(-1);
  assert.equal(latestInput.sequence, 2);
  assert.equal(latestInput.input.y, 1);
  guest.client.send({ type: 'input', sequence: 1, input: { y: -1 } });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(
    host.messages.filter((m) => m.type === 'input').length,
    inputsBeforeReload + 1,
    'Duplicate inputs in one runtime are still ignored',
  );
  const revision = (
    await CollaborationClient.fetch(
      url,
      `/projects/${owner.projectId}/state`,
      { metadataOnly: true },
      owner.token,
    )
  ).state.revision;
  for (let n = 2; n < 8; n++)
    host.client.send({
      type: 'snapshot',
      sequence: n,
      snapshot: { ...snapshot, state: { score: n } },
    });
  await waitFor(
    () =>
      guest.messages.some(
        (m) => m.type === 'snapshot' && m.snapshot.state.score === 7,
      ),
    'latest snapshot',
  );
  const oldConnection = host.messages.find(
    (m) => m.type === 'input',
  ).connectionId;
  guest.messages.length = 0;
  guest.client.socket.terminate();
  await waitFor(
    () => guest.messages.some((m) => m.type === 'restore'),
    'guest reconnect restores latest snapshot',
  );
  assert.equal(
    guest.messages.find((m) => m.type === 'restore').snapshot.state.score,
    7,
  );
  guest.client.send({ type: 'input', sequence: 1, input: { x: -1 } });
  await waitFor(
    () =>
      host.messages.some(
        (m) => m.type === 'input' && m.connectionId !== oldConnection,
      ),
    'fresh connection input accepted',
  );
  host.messages.length = 0;
  host.client.socket.terminate();
  await waitFor(
    () => host.messages.some((m) => m.type === 'restore'),
    'host reconnect snapshot',
  );
  host.client.send({ type: 'begun' });
  await waitFor(
    () => host.client.room.status === 'loading',
    'host recovery barrier',
  );
  host.client.send({ type: 'begun' });
  guest.client.send({ type: 'begun' });
  await waitFor(
    () => host.client.room.status === 'running',
    'host recovery resumed',
  );
  assert.equal(
    (
      await CollaborationClient.fetch(
        url,
        `/projects/${owner.projectId}/state`,
        { metadataOnly: true },
        owner.token,
      )
    ).state.revision,
    revision,
  );
  await CollaborationClient.fetch(
    url,
    `/projects/${owner.projectId}/role`,
    { memberId: third.result.state.memberId, role: 'removed' },
    owner.token,
  );
  await waitFor(
    () => host.client.room.status === 'finished',
    'revocation ends round',
  );
  await assert.rejects(control(viewer, { action: 'list' }), /권한/);
});
