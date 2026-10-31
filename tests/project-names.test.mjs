import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { ProjectLibrary } from '../src/project-library.ts';
import {
  projectNameKey,
  projectDirectoryName,
} from '../src/core/projects/project-name.ts';
import {
  FilesystemSharedWorkspaces,
  sharedWorkspacePath,
} from '../src/adapters/filesystem/shared-workspace-locations.ts';
import { SelectedProjectRegistration } from '../src/application/projects/selected-project.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { DesktopCollaborationSessions } from '../src/desktop/collaboration/sessions.ts';
import { DesktopProjectSessions } from '../src/desktop/project-session.ts';
import { CollaborationSessionStore } from '../src/desktop/collaboration/session-store.ts';
import { CollaborationCacheQueue } from '../src/desktop/collaboration/cache-queue.ts';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (bytes) => bytes.toString(),
};
async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-project-names-'),
  );
  const cleanup = [];
  const library = new ProjectLibrary(root, encryption);
  await library.load();
  t.after(async () => {
    for (const close of cleanup) await close();
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, library, cleanup };
}
const credentials = () => ({
  serverUrl: 'http://127.0.0.1:1234',
  projectId: randomUUID(),
  token: randomBytes(32).toString('hex'),
});
const locations = (root, library) =>
  new FilesystemSharedWorkspaces(root, {
    get: (id) => library.get(id),
    setRoot: (id, value) => library.setSharedRoot(id, value),
    assertName: (name, id) => library.assertNameAvailable(name, id),
  });

test('local/shared names share one normalized namespace, retain existing conflicts and reserve before side effects', async (t) => {
  const { root, library } = await fixture(t);
  assert.equal(projectNameKey('  CaFe\u0301 '), projectNameKey('Café'));
  assert.equal(projectDirectoryName('  CaFe\u0301 '), 'CaFé');
  for (const name of ['CON', '../escape', 'a.', 'a\n'])
    assert.throws(() => projectDirectoryName(name));
  await library.rememberLocal(path.join(root, 'a'), 'Project-PP');
  await assert.rejects(
    library.rememberLocal(path.join(root, 'b'), ' project-pp '),
    /같은 이름/,
  );
  await assert.rejects(
    library.rememberShared(credentials(), 'PROJECT-PP', 'editor', null),
    /같은 이름/,
  );
  const c = credentials();
  await library.rememberShared(c, '공동', 'admin', null);
  const id = library.findShared(c.projectId).id;
  await assert.rejects(library.renameProject(id, 'PROJECT-PP'), /같은 이름/);
  await library.observeName(id, 'Project-PP');
  assert.ok(library.list().every((e) => e.nameConflict));
  await library.observeName(id, '공동');
  let release;
  const held = library.withName(
    '보류',
    undefined,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    library.withName('보류', undefined, async () =>
      assert.fail('must not mutate'),
    ),
    /진행 중/,
  );
  release();
  await held;
  await assert.rejects(
    library.withName('실패', undefined, async () => {
      throw Error('disk');
    }),
    /disk/,
  );
  await library.withName('실패', undefined, async () => {});
  const results = await Promise.allSettled([
    library.rememberLocal(path.join(root, 'x'), '경쟁'),
    library.rememberLocal(path.join(root, 'y'), '경쟁'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('selected-folder registration asks for a new name before writes and keeps its selected-root authority', async () => {
  let name = '중복',
    opens = 0,
    writes = 0,
    available = false;
  const service = new SelectedProjectRegistration({
    id: () => 'token',
    known: () => undefined,
    name: async () => name,
    assertName: () => {
      if (!available) throw Error('같은 이름');
    },
    withName: async (_name, _id, run) => {
      if (!available) throw Error('같은 이름');
      return run();
    },
    rename: async (root, next, expected) => {
      assert.equal(root, '/selected');
      assert.equal(expected, name);
      name = next;
      writes++;
    },
    open: async (root) => {
      opens++;
      return { root, name };
    },
  });
  const result = await service.select('/selected');
  assert.equal(result.root, null);
  assert.equal(result.registration.token, 'token');
  await assert.rejects(service.register('other', '새 이름'), /만료/);
  await assert.rejects(service.register('token', '새 이름'), /같은 이름/);
  assert.equal(writes, 0);
  assert.equal(opens, 0);
  available = true;
  assert.equal((await service.register('token', '새 이름')).root, '/selected');
  assert.equal(writes, 1);
  await assert.rejects(service.register('token', '다시'), /만료/);
  available = false;
  const canceled = await service.select('/selected');
  await service.register(canceled.registration.token, null);
  await assert.rejects(
    service.register(canceled.registration.token, '이름'),
    /만료/,
  );
  assert.equal(writes, 1);
});

test('new mirrors use the project name; legacy roots move whole and resume after an interrupted registry/settings commit', async (t) => {
  const { root, library } = await fixture(t);
  const fresh = credentials();
  await library.rememberShared(fresh, '새 공동', 'editor', null);
  const id = library.findShared(fresh.projectId).id,
    store = locations(root, library);
  assert.equal(path.basename(await store.ensure(id)), '새 공동');
  assert.equal(
    library.list()[0].sharedRoot,
    undefined,
    'private path stays in registry',
  );
  // Rejoining the same server/project after legacy leave can have a new home card ID.
  const freshRoot = library.get(id).sharedRoot;
  await fs.writeFile(path.join(freshRoot, 'sentinel.bin'), 'keep');
  await library.removeProject(id);
  await library.rememberShared(
    { ...fresh, libraryId: randomUUID() },
    '새 공동',
    'editor',
    null,
  );
  const rejoinedId = library.findShared(fresh.projectId).id;
  assert.notEqual(rejoinedId, id);
  assert.equal(await store.ensure(rejoinedId), freshRoot);
  assert.equal(
    await fs.readFile(path.join(freshRoot, 'sentinel.bin'), 'utf8'),
    'keep',
  );
  await library.removeProject(rejoinedId);
  await library.rememberShared(
    { ...fresh, serverUrl: 'https://other.invalid', libraryId: randomUUID() },
    '새 공동',
    'editor',
    null,
  );
  await assert.rejects(
    store.ensure(library.findShared(fresh.projectId).id),
    /같은 이름/,
  );
  const legacy = credentials();
  await library.rememberShared(legacy, 'Project-PP', 'admin', null);
  const oldId = library.findShared(legacy.projectId).id;
  const before = sharedWorkspacePath(root, library.get(oldId));
  await fs.mkdir(path.join(before, '.canvas'), { recursive: true });
  const bytes = randomBytes(800);
  await fs.writeFile(path.join(before, '.canvas/unknown.bin'), bytes);
  assert.equal(
    await store.ensure(oldId),
    before,
    'open must not migrate legacy paths',
  );
  await assert.rejects(
    store.rename(oldId, async () => {
      throw Error('settings failure');
    }),
    /settings failure/,
  );
  assert.equal(library.get(oldId).sharedRoot, before);
  await assert.rejects(store.ensure(oldId), /복구/);
  let finalized = false;
  await store.recover(oldId, async (from, to) => {
    assert.equal(from, before);
    assert.equal(path.basename(to), 'Project-PP');
    finalized = true;
  });
  assert.ok(finalized);
  const after = library.get(oldId).sharedRoot;
  assert.deepEqual(
    await fs.readFile(path.join(after, '.canvas/unknown.bin')),
    bytes,
  );
  await assert.rejects(fs.access(before), /ENOENT/);
  const reloaded = new ProjectLibrary(root, encryption);
  await reloaded.load();
  assert.equal(reloaded.get(oldId).sharedRoot, after);
  await library.observeName(oldId, 'project-pp');
  await assert.rejects(
    store.rename(oldId, async () => {
      throw Error('case finalize');
    }),
    /case finalize/,
  );
  await store.recover(oldId, async () => {});
  const casePath = library.get(oldId).sharedRoot;
  assert.equal(path.basename(casePath), 'project-pp');
  assert.ok((await fs.readdir(path.dirname(casePath))).includes('project-pp'));
  assert.deepEqual(
    await fs.readFile(path.join(casePath, '.canvas/unknown.bin')),
    bytes,
  );
  await library.observeName(oldId, '바뀐 이름');
  assert.equal(sharedWorkspacePath(root, library.get(oldId)), casePath);
  assert.ok(library.list().find((e) => e.id === oldId).folderNamePending);
  await fs.mkdir(path.join(root, 'shared-workspaces/바뀐 이름'));
  await assert.rejects(
    store.rename(oldId, async () => {}),
    /같은 이름/,
  );
  assert.deepEqual(
    await fs.readFile(path.join(casePath, '.canvas/unknown.bin')),
    bytes,
  );
});

test('server atomically rejects duplicate creates, cross-project renames and restore collisions; inspected joins are retry-safe', async (t) => {
  const { root, cleanup } = await fixture(t);
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'test',
  });
  const clients = [];
  cleanup.push(async () => {
    for (const c of clients) c.stop();
    await server.close();
  });
  const url = 'http://127.0.0.1:' + server.port;
  const creations = await Promise.allSettled(
    ['Race', 'race'].map((name) =>
      CollaborationClient.create(url, 'test', 'owner', name, {}),
    ),
  );
  assert.equal(creations.filter((r) => r.status === 'fulfilled').length, 1);
  const created = creations.find((r) => r.status === 'fulfilled').value;
  const owner = new CollaborationClient(created.credentials, () => {});
  clients.push(owner);
  await owner.refresh();
  const otherCreated = await CollaborationClient.create(
    url,
    'test',
    'owner',
    'Other',
    {},
  );
  const other = new CollaborationClient(otherCreated.credentials, () => {});
  clients.push(other);
  await other.refresh();
  const renames = await Promise.allSettled([
    owner.renameProject('Same', owner.state.projectName),
    other.renameProject('Same', other.state.projectName),
  ]);
  assert.equal(renames.filter((r) => r.status === 'fulfilled').length, 1);
  const inspection = await CollaborationClient.inspectJoin(
    url,
    created.result.code,
  );
  await owner.refresh();
  await owner.renameProject('New name', owner.state.projectName);
  const identity = { id: randomUUID(), token: randomBytes(32).toString('hex') };
  await assert.rejects(
    CollaborationClient.join(url, created.result.code, 'editor', {
      inspection,
      identity,
    }),
    /이름이 바뀌/,
  );
  await owner.refresh();
  assert.equal(owner.state.members.length, 1);
  const current = await CollaborationClient.inspectJoin(
    url,
    created.result.code,
  );
  const a = await CollaborationClient.join(url, created.result.code, 'editor', {
    inspection: current,
    identity,
  });
  const b = await CollaborationClient.join(url, created.result.code, 'editor', {
    inspection: current,
    identity,
  });
  assert.equal(a.result.state.memberId, b.result.state.memberId);
  await owner.refresh();
  assert.equal(owner.state.members.length, 2);
  const recoveryInspection = await CollaborationClient.inspectRecovery(
    url,
    created.credentials.projectId,
    created.credentials.recoveryKey,
  );
  await owner.renameProject('복구 직전 이름 변경');
  await assert.rejects(
    CollaborationClient.recover(
      url,
      created.credentials.projectId,
      created.credentials.recoveryKey,
      recoveryInspection,
    ),
    /이름이 바뀌/,
  );
  await owner.refresh();
  await CollaborationClient.inspectRecovery(
    url,
    created.credentials.projectId,
    created.credentials.recoveryKey,
  );
  await other.refresh();
  const trashName = other.state.projectName;
  await other.request('trash', {
    typedName: trashName,
    confirmTeam: true,
    expectedVersion: other.state.lifecycleVersion ?? 0,
  });
  await CollaborationClient.create(url, 'test', 'owner', trashName, {});
  await assert.rejects(other.request('trash-restore', {}), /같은 이름/);
});

test('desktop join checks names before membership, then creates a named mirror and reuses its existing member on repeated join', async (t) => {
  const { root, library, cleanup } = await fixture(t);
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'test',
  });
  const sessions = new DesktopProjectSessions();
  cleanup.push(async () => {
    await sessions.close();
    await server.close();
  });
  const url = 'http://127.0.0.1:' + server.port;
  const created = await CollaborationClient.create(
    url,
    'test',
    'owner',
    'Project-PP',
    {},
  );
  await library.rememberLocal(path.join(root, 'local'), 'Project-PP');
  const desktop = new DesktopCollaborationSessions({
    sessions,
    library: () => library,
    hasTrash: () => false,
    userData: () => root,
    store: () => new CollaborationSessionStore(root, encryption),
    cache: new CollaborationCacheQueue(),
    lifecycle: { preserve: async () => {} },
    busy: () => false,
    resetClipboard: () => {},
    clearState: () => {},
    changed: () => {},
    notify: () => {},
    lobby: () => {},
    startWatcher: async () => {},
    creation: async () => ({ key: 'test', internal: false }),
    prepareLock: async () => {},
  });
  const input = {
    serverUrl: url,
    code: created.result.code,
    nickname: 'editor',
  };
  await assert.rejects(desktop.join(input), /같은 이름/);
  const state = await CollaborationClient.fetch(
    url,
    `/projects/${created.credentials.projectId}/state`,
    {},
    created.credentials.token,
  );
  assert.equal(state.state.members.length, 1);
  await assert.rejects(
    desktop.recover({
      serverUrl: url,
      projectId: created.credentials.projectId,
      recoveryKey: created.credentials.recoveryKey,
    }),
    /같은 이름/,
  );
  // Collision must not rotate the owner's token or recovery key.
  await CollaborationClient.inspectRecovery(
    url,
    created.credentials.projectId,
    created.credentials.recoveryKey,
  );
  await CollaborationClient.fetch(
    url,
    `/projects/${created.credentials.projectId}/state`,
    {},
    created.credentials.token,
  );
  const store = new CollaborationSessionStore(root, encryption);
  assert.deepEqual(
    await store.prepareJoin(input),
    await store.prepareJoin({
      ...input,
      code: input.code.toLowerCase(),
      nickname: 'changed nickname',
    }),
  );
  await library.renameProject(library.list()[0].id, 'Local renamed');
  const offer = await desktop.join(input);
  const joined = await offer.activate(null);
  assert.equal(path.basename(sessions.root), 'Project-PP');
  const again = await desktop.join(input);
  await again.activate(null);
  assert.equal(sessions.client.state.memberId, joined.memberId);
  assert.equal(sessions.client.state.members.length, 2);
});

test('a lost join response reuses its durable identity after restart instead of adding another member', async (t) => {
  const { root, library, cleanup } = await fixture(t);
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'test',
  });
  const sessions = new DesktopProjectSessions();
  cleanup.push(async () => {
    await sessions.close();
    await server.close();
  });
  const url = 'http://127.0.0.1:' + server.port;
  const created = await CollaborationClient.create(
    url,
    'test',
    'owner',
    '응답 유실',
    {},
  );
  let lose = true;
  class InterruptedClient extends CollaborationClient {
    static async join(...args) {
      const joined = await super.join(...args);
      if (lose) {
        lose = false;
        throw new TypeError('connection dropped after commit');
      }
      return joined;
    }
  }
  const options = {
    sessions,
    library: () => library,
    hasTrash: () => false,
    userData: () => root,
    store: () => new CollaborationSessionStore(root, encryption),
    cache: new CollaborationCacheQueue(),
    lifecycle: { preserve: async () => {} },
    busy: () => false,
    resetClipboard() {},
    clearState() {},
    changed() {},
    notify() {},
    lobby() {},
    startWatcher: async () => {},
    creation: async () => ({ key: 'test', internal: false }),
    prepareLock: async () => {},
    client: InterruptedClient,
  };
  const input = {
    serverUrl: url,
    code: created.result.code,
    nickname: 'editor',
  };
  await assert.rejects(
    new DesktopCollaborationSessions(options).join(input),
    /connection dropped/,
  );
  assert.equal(library.list().length, 0);
  const offer = await new DesktopCollaborationSessions(options).join(input);
  await offer.activate(null);
  assert.equal(sessions.client.state.members.length, 2);
  assert.equal((await fs.readdir(path.join(root, 'pending-joins'))).length, 0);
  await library.observeName(library.list()[0].id, '응답 유실'.toUpperCase());
});
