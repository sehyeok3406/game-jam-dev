import { ProjectTrash } from '../src/project-trash.ts';
import { readProjectPreference } from '../src/ui/workspace/project-preferences.ts';
import { createMemoryPreferences } from '../src/ui/runtime/preferences.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { ProjectLibrary } from '../src/project-library.ts';
import { DesktopProjectSessions } from '../src/desktop/project-session.ts';
import { DesktopProjectModes } from '../src/desktop/projects/project-modes.ts';
import { ProjectModeFiles } from '../src/adapters/filesystem/project-mode-files.ts';
import { CollaborationSessionStore } from '../src/desktop/collaboration/session-store.ts';
import { captureProject, materialize } from '../src/project-store.ts';
import { initialProjectSnapshot } from '../src/core/projects/initial-project.ts';
import { ProjectHomeService } from '../src/application/projects/home-service.ts';

const secret = () => randomBytes(32).toString('hex');
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text).map((v) => v ^ 111),
  decryptString: (data) =>
    Buffer.from(data)
      .map((v) => v ^ 111)
      .toString(),
};
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-modes-'));
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'test',
  });
  const url = 'http://127.0.0.1:' + server.port;
  const profile = path.join(root, 'profile'),
    local = path.join(root, 'original');
  await fs.mkdir(profile);
  await fs.mkdir(local);
  const original = initialProjectSnapshot('전환 검사');
  original['docs/old.md'] =
    '---\nid: old\ntitle: old\ntype: idea\n---\n원래 문서\n';
  await materialize(local, original);
  const library = new ProjectLibrary(profile, encryption);
  await library.load();
  await library.rememberLocal(local, '전환 검사');
  const libraryId = library.list()[0].id;
  await library.createFolder('분류');
  await library.moveProject(libraryId, library.listFolders()[0].id);
  const sessions = new DesktopProjectSessions();
  await sessions.activate(local);
  const files = new ProjectModeFiles(profile, encryption);
  const store = new CollaborationSessionStore(profile, encryption);
  const peers = [];
  const ports = {
    sessions,
    library: () => library,
    files: () => files,
    store: () => store,
    prepare: async () => {},
    busy: () => false,
    creation: async () => ({ key: 'test', internal: false }),
    chooseParent: async () => root,
    changed: () => {},
    attach: async (credentials, localRoot) => {
      const target = path.join(
        profile,
        'shared-workspaces',
        credentials.projectId,
      );
      await fs.mkdir(target, { recursive: true });
      const client = new CollaborationClient(credentials, () => {});
      await sessions.activate(target, client);
      sessions.localRootBeforeShare = localRoot;
      await client.refresh();
      await library.rememberShared(
        credentials,
        client.state.projectName,
        client.state.role,
        localRoot,
      );
      await store.save({ credentials, localRoot });
      return client.state;
    },
    openLocal: async (root) => {
      await sessions.activate(root);
      sessions.localRootBeforeShare = null;
      await library.rememberLocal(root, '전환 검사');
      return { root, name: '전환 검사' };
    },
  };
  const modes = new DesktopProjectModes(ports);
  const share = async () => {
    const offer = await modes.createSource(
      { serverUrl: url, serverKey: 'test', nickname: '생성자' },
      { name: '전환 검사', files: await captureProject(local) },
      local,
    );
    await offer.activate(local);
    return sessions.client;
  };
  const join = async (client) => {
    const joined = await CollaborationClient.join(
      url,
      client.credentials.inviteCode,
      '후임',
    );
    const peer = new CollaborationClient(joined.credentials, () => {});
    peer.accept(joined.result);
    peers.push(peer);
    await client.refresh();
    return peer;
  };
  const handover = async (client, peer) => {
    await modes.handover('prepare', peer.state.memberId);
    await peer.refresh();
    const key = secret();
    await peer.handover('accept', {
      id: peer.state.handover.id,
      recoveryKey: key,
    });
    await client.refresh();
    return key;
  };
  t.after(async () => {
    await sessions.close();
    peers.forEach((p) => p.stop());
    await server.close();
    assert.ok(root.startsWith(os.tmpdir() + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    profile,
    local,
    original,
    library,
    libraryId,
    sessions,
    files,
    store,
    ports,
    modes,
    share,
    join,
    handover,
    url,
  };
}

test('folder selection has no creation side effect; explicit completion uses selected parent without selecting again', async () => {
  const calls = [];
  const service = new ProjectHomeService({
    chooseParent: async () => {
      calls.push('choose');
      return '/parent';
    },
    local: {
      create: async (parent, name) => {
        calls.push([parent, name]);
        return '/parent/game';
      },
    },
    session: {
      suspend: async () => calls.push('suspend'),
      openLocal: async (root) => ({ root }),
    },
  });
  assert.equal(await service.chooseParent(), '/parent');
  assert.deepEqual(calls, ['choose']);
  await assert.rejects(
    service.create({ mode: 'local', name: 'CON', parent: '/parent' }),
    /예약 이름/,
  );
  assert.deepEqual(calls, ['choose']);
  assert.deepEqual(
    await service.create({ mode: 'local', name: ' game ', parent: '/parent' }),
    { root: '/parent/game' },
  );
  assert.deepEqual(calls, ['choose', ['/parent', 'game'], 'suspend']);
  await assert.rejects(
    service.create({ mode: 'local', name: 'game' }),
    /저장 위치/,
  );
});

test('local sharing keeps one stable card and classification; reopening the old root resolves to the shared card', async (t) => {
  const f = await fixture(t);
  const client = await f.share();
  const entries = f.library.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, f.libraryId);
  assert.equal(entries[0].kind, 'shared');
  assert.equal(entries[0].folderId, f.library.listFolders()[0].id);
  assert.equal(
    f.library.get('shared:' + client.credentials.projectId).id,
    f.libraryId,
  );
  assert.equal(f.library.findRoot(f.local).kind, 'shared');
  assert.deepEqual(await captureProject(f.local), f.original);
  const reloaded = new ProjectLibrary(f.profile, encryption);
  await reloaded.load();
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].kind, 'shared');
});

test('sole owner cannot leave; owner handover needs acceptance and latest data survives local conversion', async (t) => {
  const f = await fixture(t),
    owner = await f.share();
  await assert.rejects(f.modes.toLocal({}), /후임|소유권/);
  assert.equal(f.library.list()[0].kind, 'shared');
  const peer = await f.join(owner);
  await f.modes.handover('prepare', peer.state.memberId);
  await assert.rejects(
    f.modes.toLocal({ successorId: peer.state.memberId }),
    /보관 확인/,
  );
  const recoveryKey = await f.handover(owner, peer);
  await peer.command('documents:create-idea', {
    title: '팀원의 최신 자료',
    x: 110,
    y: 220,
  });
  await owner.refresh();
  const latest = structuredClone(owner.files);
  const oldToken = owner.credentials.token,
    oldKey = owner.credentials.recoveryKey,
    projectId = owner.credentials.projectId;
  await f.modes.toLocal({ successorId: peer.state.memberId });
  assert.equal(f.library.list().length, 1);
  assert.equal(f.library.list()[0].id, f.libraryId);
  assert.equal(f.library.list()[0].kind, 'local');
  assert.equal(f.library.list()[0].folderId, f.library.listFolders()[0].id);
  const local = await captureProject(f.local);
  for (const [relative, content] of Object.entries(latest))
    if (relative !== 'project.md') assert.equal(local[relative], content);
  await assert.rejects(
    CollaborationClient.fetch(
      f.url,
      '/projects/' + projectId + '/state',
      {},
      oldToken,
    ),
    /권한|참여|인증/,
  );
  await assert.rejects(
    CollaborationClient.recover(f.url, projectId, oldKey),
    /복구/,
  );
  await peer.refresh();
  assert.equal(peer.state.role, 'admin');
  assert.equal(peer.state.members.length, 1);
  assert.ok(peer.state.members[0].owner);
  await peer.command('documents:create-idea', {
    title: '전환 후에도 공동 편집',
    x: 0,
    y: 0,
  });
  const recovered = await CollaborationClient.recover(
    f.url,
    projectId,
    recoveryKey,
  );
  assert.equal(recovered.result.state.role, 'admin');
  assert.equal((await f.store.read()).credentials, null);
});

test('content changes after preparation reject detach without revoking membership', async (t) => {
  const f = await fixture(t),
    owner = await f.share(),
    peer = await f.join(owner);
  await f.handover(owner, peer);
  const snapshot = await owner.modeSnapshot();
  await peer.command('documents:create-idea', { x: 50, y: 60 });
  await assert.rejects(
    owner.request('detach', {
      id: randomUUID(),
      proof: secret(),
      stamp: snapshot.stamp,
      successorId: peer.state.memberId,
    }),
    /바뀌었습니다/,
  );
  await owner.refresh();
  assert.equal(owner.state.role, 'admin');
});

test('an ambiguous detach response recovers from a restricted receipt; wrong proof cannot read it', async (t) => {
  const f = await fixture(t),
    owner = await f.share(),
    peer = await f.join(owner);
  await f.handover(owner, peer);
  const original = owner.request.bind(owner);
  owner.request = async (action, input) => {
    const result = await original(action, input);
    if (action === 'detach') throw new TypeError('lost response');
    return result;
  };
  await assert.rejects(
    f.modes.toLocal({ successorId: peer.state.memberId }),
    /lost response/,
  );
  const key = (await f.files.ids('local-'))[0],
    attempt = await f.files.read(key);
  assert.equal(f.library.list()[0].transitionPending, true);
  await assert.rejects(
    CollaborationClient.fetch(
      f.url,
      '/projects/' + owner.credentials.projectId + '/detach-status',
      { id: attempt.id, proof: secret() },
    ),
    /권한/,
  );
  await f.modes.recover(f.libraryId);
  assert.equal(f.library.list()[0].kind, 'local');
  assert.deepEqual(await f.files.ids('local-'), []);
  assert.deepEqual(await captureProject(f.local), attempt.files);
});

test('local finalization failure after server commit is resumed without departing twice', async (t) => {
  const f = await fixture(t),
    owner = await f.share(),
    peer = await f.join(owner);
  await f.handover(owner, peer);
  const finish = f.files.finish.bind(f.files);
  f.files.finish = async () => {
    throw Error('disk unavailable');
  };
  await assert.rejects(
    f.modes.toLocal({ successorId: peer.state.memberId }),
    /disk unavailable/,
  );
  const key = (await f.files.ids('local-'))[0];
  assert.equal((await f.files.read(key)).committed, true);
  f.files.finish = finish;
  await f.modes.recover();
  assert.equal(f.library.list()[0].kind, 'local');
  await f.modes.recover();
  assert.equal(f.library.list().length, 1);
});

test('external local modifications block overwrite before remote departure', async (t) => {
  const f = await fixture(t),
    owner = await f.share(),
    peer = await f.join(owner);
  await f.handover(owner, peer);
  await fs.writeFile(path.join(f.local, 'docs/old.md'), '외부 변경 보존');
  await assert.rejects(
    f.modes.toLocal({ successorId: peer.state.memberId }),
    /외부/,
  );
  assert.equal(
    await fs.readFile(path.join(f.local, 'docs/old.md'), 'utf8'),
    '외부 변경 보존',
  );
  await owner.refresh();
  assert.equal(owner.state.role, 'admin');
});

test('creation response loss retries the same server identity and never creates duplicate cards', async (t) => {
  const f = await fixture(t);
  const original = CollaborationClient.fetch;
  const projectIds = [];
  let fail = true;
  CollaborationClient.fetch = async (...args) => {
    const result = await original.call(CollaborationClient, ...args);
    if (args[1] === '/projects-mode') {
      projectIds.push(result.state.projectId);
      if (fail) {
        fail = false;
        throw new TypeError('creation response lost');
      }
    }
    return result;
  };
  try {
    await assert.rejects(f.share(), /response lost/);
    assert.equal(f.library.list()[0].transitionPending, true);
    await f.modes.recover();
    assert.equal(projectIds.length, 2);
    assert.equal(projectIds[0], projectIds[1]);
    assert.equal(f.library.list().length, 1);
    assert.equal(f.library.list()[0].id, f.libraryId);
    assert.equal(f.library.list()[0].kind, 'shared');
  } finally {
    CollaborationClient.fetch = original;
  }
});

test('direct shared creation supports 100-character names and never creates a local project card', async (t) => {
  const f = await fixture(t);
  await f.modes.createDirect({
    mode: 'shared',
    name: '가'.repeat(100),
    serverUrl: f.url,
    nickname: '나',
    requestId: randomUUID(),
  });
  const entries = f.library.list();
  assert.equal(entries.filter((v) => v.kind === 'shared').length, 1);
  assert.equal(entries.filter((v) => v.kind === 'local').length, 1); // only the unrelated pre-existing fixture
  assert.equal(f.sessions.client.state.projectName.length, 100);
  const raw = await fs.readFile(path.join(f.profile, 'projects.enc'));
  assert.equal(
    raw.includes(Buffer.from(f.sessions.client.credentials.token)),
    false,
  );
});

test('an editor converts only their participation while the owner keeps working', async (t) => {
  const f = await fixture(t),
    owner = await f.share(),
    peer = await f.join(owner);
  const ownerCredentials = { ...owner.credentials };
  await f.sessions.activate(f.sessions.root, peer);
  f.sessions.localRootBeforeShare = null;
  await f.library.rememberShared(
    peer.credentials,
    peer.state.projectName,
    peer.state.role,
    null,
  );
  await f.modes.toLocal({ parent: f.root });
  assert.equal(f.library.list()[0].kind, 'local');
  assert.equal(f.library.list()[0].id, f.libraryId);
  const stillOwner = new CollaborationClient(ownerCredentials, () => {});
  try {
    await stillOwner.refresh();
    assert.equal(stillOwner.state.members.length, 1);
    assert.equal(stillOwner.state.role, 'admin');
    await stillOwner.command('documents:create-idea', { x: 1, y: 1 });
  } finally {
    stillOwner.stop();
  }
});

test('concurrent admin departures leave one administrator and one valid membership', async (t) => {
  const f = await fixture(t),
    owner = await f.share(),
    peer = await f.join(owner);
  await owner.setRole(peer.state.memberId, 'admin');
  await f.handover(owner, peer);
  const snapshot = await owner.modeSnapshot();
  const results = await Promise.allSettled([
    owner.request('detach', {
      id: randomUUID(),
      proof: secret(),
      stamp: snapshot.stamp,
      successorId: peer.state.memberId,
    }),
    peer.request('detach', {
      id: randomUUID(),
      proof: secret(),
      stamp: snapshot.stamp,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const remaining = new CollaborationClient(
    results[0].status === 'fulfilled' ? peer.credentials : owner.credentials,
    () => {},
  );
  try {
    await remaining.refresh();
    assert.equal(remaining.state.members.length, 1);
    assert.equal(remaining.state.role, 'admin');
  } finally {
    remaining.stop();
  }
});

test('legacy shared IDs and old local paths cannot overwrite an independent local card on rejoin', async (t) => {
  const f = await fixture(t);
  const credentials = {
    serverUrl: f.url,
    projectId: randomUUID(),
    token: secret(),
  };
  await f.library.rememberShared(credentials, '공동', 'editor', null);
  const shared = f.library.findShared(credentials.projectId);
  const movedRoot = path.join(f.root, 'moved');
  await fs.mkdir(movedRoot);
  await f.library.makeLocal(shared.id, movedRoot, '독립 로컬');
  const freshSession = {
    serverUrl: f.url,
    projectId: credentials.projectId,
    token: secret(),
  };
  await f.library.rememberShared(freshSession, '다시 참여', 'editor', null);
  assert.equal(f.library.get(shared.id).kind, 'local');
  assert.notEqual(f.library.findShared(credentials.projectId).id, shared.id);
  const other = path.join(f.root, 'other');
  await fs.mkdir(other);
  await f.library.makeLocal(f.libraryId, other, '다른 위치');
  await f.library.rememberLocal(f.local, '예전 폴더 다시 열기');
  assert.equal(f.library.get(f.libraryId).root, other);
  assert.notEqual(f.library.findRoot(f.local).id, f.libraryId);
});

test('personal canvas preferences migrate once and follow a stable card through mode changes', () => {
  const preferences = createMemoryPreferences();
  preferences.setItem('game-canvas-active-sheet:/old-local', 'second');
  assert.equal(
    readProjectPreference(preferences, 'game-canvas-active-sheet:', {
      root: '/old-local',
      name: 'a',
      libraryId: 'fixed',
    }),
    'second',
  );
  assert.equal(
    readProjectPreference(preferences, 'game-canvas-active-sheet:', {
      root: '/shared-cache',
      name: 'a',
      libraryId: 'fixed',
    }),
    'second',
  );
  assert.equal(
    readProjectPreference(preferences, 'game-canvas-active-sheet:', {
      root: '/new-local',
      name: 'a',
      libraryId: 'fixed',
    }),
    'second',
  );
  assert.equal(preferences.getItem('game-canvas-active-sheet:fixed'), 'second');
});

test('handover acceptance retries keep the recovery key even if the owner commits between responses', async (t) => {
  const f = await fixture(t),
    owner = await f.share(),
    peer = await f.join(owner);
  await f.modes.handover('prepare', peer.state.memberId);
  await peer.refresh();
  await f.sessions.activate(f.sessions.root, peer);
  const request = peer.request.bind(peer);
  let lost = true;
  peer.request = async (action, input) => {
    const result = await request(action, input);
    if (action === 'handover-accept' && lost) {
      lost = false;
      throw new TypeError('accept response lost');
    }
    return result;
  };
  await assert.rejects(f.modes.handover('accept'), /response lost/);
  const recoveryKey = peer.credentials.recoveryKey;
  const snapshot = await owner.modeSnapshot();
  await owner.request('detach', {
    id: randomUUID(),
    proof: secret(),
    stamp: snapshot.stamp,
    successorId: peer.state.memberId,
  });
  await assert.rejects(f.modes.handover('accept'), /바뀌었습니다/);
  assert.equal(peer.credentials.recoveryKey, recoveryKey);
  const recovered = await CollaborationClient.recover(
    f.url,
    owner.credentials.projectId,
    recoveryKey,
  );
  assert.equal(recovered.result.state.role, 'admin');
});

test('unified shared trash retains stable personal settings and protects its parked source until restore', async (t) => {
  const f = await fixture(t),
    owner = await f.share();
  const trash = new ProjectTrash(f.profile, f.library, encryption, {
    capture: async () => null,
    remove: async () => {},
    restore: async () => {},
  });
  const plan = await trash.prepare(f.libraryId);
  const preference = 'game-canvas-active-sheet:' + f.libraryId;
  const id = await trash.trash(plan.token, { [preference]: 'second' });
  assert.equal(trash.hasProject(f.libraryId), true);
  assert.equal(trash.hasSharedProject(owner.credentials.projectId), true);
  assert.equal(trash.hasRoot(f.local), true);
  assert.deepEqual(await captureProject(f.local), f.original);
  assert.deepEqual(await trash.restore(id), { [preference]: 'second' });
  await trash.acknowledgeRestore(id);
  assert.equal(f.library.get(f.libraryId).kind, 'shared');
  assert.equal(trash.hasRoot(f.local), false);
});
