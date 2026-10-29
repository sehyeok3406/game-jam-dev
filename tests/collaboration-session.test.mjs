import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import matter from 'gray-matter';
import { CollaborationService } from '../src/application/projects/collaboration-service.ts';
import { DesktopCollaborationSessions } from '../src/desktop/collaboration/sessions.ts';
import { CollaborationCacheQueue } from '../src/desktop/collaboration/cache-queue.ts';
import { CollaborationSessionStore } from '../src/desktop/collaboration/session-store.ts';
import { DesktopProjectSessions } from '../src/desktop/project-session.ts';
import { ProjectLibrary } from '../src/project-library.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { registerCollaborationSessionIpc } from '../src/desktop/ipc/collaboration-session.ts';

function fixture() {
  const calls = [];
  let current = true,
    shared = false,
    root = '/local',
    busy = false;
  const mark =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return result;
    };
  const guard = () => {
    if (!current) throw Error('stale session');
  };
  const active = {
    assertCurrent: guard,
    backupOffline: mark('backup'),
    resolve: mark('resolve'),
    resume: mark('resume'),
    invite: mark('invite', { active: true }),
    persist: mark('persist'),
    role: mark('role'),
    lock: mark('lock'),
    unlock: mark('unlock'),
  };
  const offer = {
    activate: mark('activate', { active: true }),
    retain: mark('retain'),
  };
  const ports = {
    scope: () => ({ root, shared, localRoot: null, assertCurrent: guard }),
    state: () => ({ active: shared }),
    active: () => (shared ? active : null),
    busy: () => busy,
    assertSecure: () => calls.push(['secure']),
    source: mark('source', { name: 'local', files: { 'project.md': 'raw' } }),
    create: mark('create', offer),
    join: mark('join', offer),
    recover: mark('recover', offer),
    suspend: async () => {
      calls.push(['suspend']);
      root = null;
      shared = false;
    },
    leave: mark('leave'),
    prepareLock: mark('prepare-lock'),
  };
  return {
    calls,
    active,
    ports,
    offer,
    service: new CollaborationService(ports),
    share: () => (shared = true),
    home: () => (root = null),
    expire: () => (current = false),
    busy: () => (busy = true),
  };
}
test('create rejects active/AI/insecure sessions before reading local data or making a request', async () => {
  for (const reason of ['shared', 'AI', 'encryption', 'missing root']) {
    const f = fixture();
    if (reason === 'shared') f.share();
    if (reason === 'AI') f.busy();
    if (reason === 'encryption')
      f.ports.assertSecure = () => {
        throw Error('encryption');
      };
    if (reason === 'missing root') f.home();
    await assert.rejects(f.service.create({}), /프로젝트|AI|encryption/);
    assert.ok(
      !f.calls.some(([name]) => name === 'source' || name === 'create'),
    );
  }
});
test('create captures local name/files before remote call and preserves the original local root', async () => {
  const f = fixture();
  await f.service.create({ serverUrl: 'url', nickname: 'name' });
  assert.deepEqual(
    f.calls.map(([n]) => n),
    ['secure', 'source', 'create', 'activate'],
  );
  assert.deepEqual(f.calls.at(-1), ['activate', '/local']);
});
test('a stale local read stops creation before any remote side effect', async () => {
  const f = fixture();
  f.ports.source = async () => {
    f.expire();
    return {};
  };
  await assert.rejects(f.service.create({}), /stale/);
  assert.deepEqual(f.calls, [['secure']]);
});
for (const method of ['create', 'join', 'recover']) {
  test(`late ${method} response retains the received session without activating another project`, async () => {
    const f = fixture();
    f.ports[method] = async () => {
      f.expire();
      return f.offer;
    };
    await assert.rejects(f.service[method]({}), /stale/);
    assert.ok(!f.calls.some(([n]) => n === 'activate' || n === 'suspend'));
    assert.deepEqual(f.calls.at(-1), ['retain', '/local']);
  });
}
for (const method of ['join', 'recover']) {
  test(`${method} failure keeps existing membership; success suspends only after the remote response`, async () => {
    const f = fixture();
    f.share();
    const original = f.ports[method];
    f.ports[method] = async () => {
      throw Error('offline');
    };
    await assert.rejects(f.service[method]({}), /offline/);
    assert.ok(!f.calls.some(([n]) => n === 'suspend'));
    f.calls.length = 0;
    f.ports[method] = original;
    await f.service[method]({});
    assert.deepEqual(
      f.calls.map(([n]) => n),
      ['secure', method, 'suspend', 'activate'],
    );
    assert.deepEqual(f.calls.at(-1), ['activate', null]);
  });
}
test('activation or suspension failure retains successful remote membership for later reopening', async () => {
  const f = fixture();
  f.offer.activate = async () => {
    throw Error('bad cache');
  };
  await assert.rejects(f.service.create({}), /bad cache/);
  assert.deepEqual(f.calls.at(-1), ['retain', '/local']);
  f.share();
  f.ports.suspend = async () => {
    throw Error('disk full');
  };
  await assert.rejects(f.service.join({}), /disk full/);
  assert.deepEqual(f.calls.at(-1), ['retain', null]);
});
test('offline resolution backs up before selecting either server or local contents', async () => {
  for (const choice of ['local', 'server']) {
    const f = fixture();
    f.share();
    await f.service.resolve('conflict', choice);
    assert.deepEqual(f.calls, [['backup'], ['resolve', 'conflict', choice]]);
  }
});
test('backup failure or session change cannot discard an offline variant', async () => {
  const f = fixture();
  f.share();
  f.active.backupOffline = async () => {
    throw Error('disk full');
  };
  await assert.rejects(f.service.resolve('id', 'server'), /disk full/);
  assert.equal(f.calls.length, 0);
  f.active.backupOffline = async () => f.expire();
  await assert.rejects(f.service.resolve('id', 'server'), /stale/);
  assert.equal(f.calls.length, 0);
});
test('invite rotation persists the same active session and stops on stale response', async () => {
  const f = fixture();
  f.share();
  await f.service.invite();
  assert.deepEqual(f.calls, [['invite'], ['persist']]);
  f.calls.length = 0;
  f.active.invite = async () => {
    f.expire();
    return {};
  };
  await assert.rejects(f.service.invite(), /stale/);
  assert.equal(f.calls.length, 0);
});
test('role/lock/unlock preserve independent lock lane and AI lock preparation', async () => {
  const f = fixture();
  await f.service.lock('a.md');
  assert.deepEqual(f.calls, [['prepare-lock', 'a.md']]);
  f.share();
  await f.service.role('member', 'viewer');
  await f.service.lock('a.md');
  await f.service.unlock('a.md');
  assert.deepEqual(f.calls.slice(1), [
    ['role', 'member', 'viewer'],
    ['prepare-lock', 'a.md'],
    ['lock', 'a.md'],
    ['unlock', 'a.md'],
  ]);
  f.ports.prepareLock = async () => {
    throw Error('AI lock');
  };
  f.calls.length = 0;
  await assert.rejects(f.service.lock('a.md'), /AI lock/);
  assert.equal(f.calls.length, 0);
});
test('all 13 session IPC wires serialize transitions but never queue read/lock release behind a drain', async () => {
  const f = fixture(),
    handlers = new Map();
  let queued = 0;
  registerCollaborationSessionIpc(
    (channel, fn) => {
      assert.ok(!handlers.has(channel));
      handlers.set(channel, fn);
      return fn;
    },
    f.service,
    async (operation) => {
      queued++;
      return operation();
    },
  );
  assert.equal(handlers.size, 13);
  handlers.get('collaboration:get')();
  await handlers.get('collaboration:lock')(null, 'a.md');
  await handlers.get('collaboration:unlock')(null, 'a.md');
  assert.equal(queued, 0);
  await handlers.get('collaboration:join')(null, {});
  assert.equal(queued, 1);
});

function clientCache(revision = 1) {
  return {
    files: { 'ideas/a.md': 'base' },
    revisions: {},
    properties: {},
    authorship: {},
    state: {
      active: true,
      connected: false,
      revision,
      pendingChanges: 1,
      inviteCode: 'secret-invite',
      recoveryKey: 'secret-recovery',
      conflicts: [],
    },
    offline: {
      base: { 'ideas/a.md': 'base' },
      local: { 'ideas/a.md': 'local' },
    },
    outgoing: { command: { id: 'receipt' }, base: {}, local: {} },
  };
}
test('cache queue captures root/offline/outgoing before awaits and removes transient secrets', async () => {
  const saved = [],
    queue = new CollaborationCacheQueue(async (root, cache) =>
      saved.push({ root, cache }),
    ),
    client = clientCache();
  const first = queue.save(client, '/old');
  client.files = { 'ideas/a.md': 'new' };
  client.offline.local['ideas/a.md'] = 'late';
  client.outgoing.command.id = 'changed';
  await first;
  assert.equal(saved[0].root, '/old');
  assert.equal(saved[0].cache.files['ideas/a.md'], 'base');
  assert.equal(saved[0].cache.offline.local['ideas/a.md'], 'local');
  assert.equal(saved[0].cache.outgoing.command.id, 'receipt');
  assert.ok(!JSON.stringify(saved).includes('secret-invite'));
  assert.ok(!JSON.stringify(saved).includes('secret-recovery'));
  assert.equal(saved[0].cache.state.conflicts, undefined);
});
test('cache queue deduplicates unchanged attempts, retries a failed write, and continues to another root', async () => {
  const saved = [];
  let fail = true;
  const queue = new CollaborationCacheQueue(async (root) => {
    saved.push(root);
    if (fail) {
      fail = false;
      throw Error('disk');
    }
  });
  const client = clientCache();
  const first = queue.save(client, '/one');
  assert.equal(queue.save(client, '/one'), first);
  await assert.rejects(first, /disk/);
  await queue.save(client, '/one');
  await queue.save(client, '/two');
  await queue.drain();
  assert.deepEqual(saved, ['/one', '/one', '/two']);
});
test('cache writes remain ordered when an old session finishes after another is queued', async () => {
  let release;
  const barrier = new Promise((resolve) => (release = resolve)),
    saved = [];
  const queue = new CollaborationCacheQueue(async (root) => {
    if (root === '/old') await barrier;
    saved.push(root);
  });
  queue.save(clientCache(), '/old');
  const next = queue.save(clientCache(2), '/new');
  await Promise.resolve();
  assert.deepEqual(saved, []);
  release();
  await next;
  assert.deepEqual(saved, ['/old', '/new']);
});

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value).map((v) => v ^ 99),
  decryptString: (value) =>
    Buffer.from(value)
      .map((v) => v ^ 99)
      .toString(),
};
async function nativeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-connection-'));
  const cleanup = [
    async () => {
      assert.ok(root.startsWith(os.tmpdir() + path.sep));
      await fs.rm(root, { recursive: true, force: true });
    },
  ];
  t.after(async () => {
    for (const operation of cleanup.reverse()) await operation();
  });
  const userData = path.join(root, 'profile'),
    local = path.join(root, 'local');
  await fs.mkdir(userData);
  await fs.mkdir(local);
  await fs.writeFile(
    path.join(local, 'project.md'),
    matter.stringify('original', {
      id: 'project',
      type: 'overview',
      title: 'local',
      project_name: 'local',
    }),
  );
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'fixture',
  });
  cleanup.push(() => server.close());
  const url = `http://127.0.0.1:${server.port}`;
  const sessions = new DesktopProjectSessions();
  await sessions.activate(local);
  const cache = new CollaborationCacheQueue();
  cleanup.push(async () => {
    await sessions.close();
    await cache.drain().catch(() => {});
  });
  const library = new ProjectLibrary(userData, encryption);
  await library.load();
  const store = new CollaborationSessionStore(userData, encryption),
    calls = [];
  const options = {
    sessions,
    library: () => library,
    hasTrash: () => false,
    userData: () => userData,
    store: () => store,
    cache,
    lifecycle: {
      preserve: async (intent) => {
        calls.push(['preserve', intent]);
        await cache.drain();
      },
    },
    busy: () => false,
    resetClipboard: () => calls.push(['clipboard']),
    clearState: () => calls.push(['clear']),
    changed: () => {},
    notify: () => calls.push(['notify']),
    lobby: () => {},
    startWatcher: async () => calls.push(['watch']),
    creation: async () => ({ key: 'fixture', internal: true }),
    prepareLock: async () => {},
  };
  const runtime = new DesktopCollaborationSessions(options);
  return {
    root,
    local,
    userData,
    sessions,
    cache,
    library,
    store,
    options,
    runtime,
    service: new CollaborationService(runtime),
    url,
    calls,
    input: { serverUrl: url, serverKey: '', nickname: 'owner' },
  };
}
test('native create/home/reopen/leave preserve encrypted credentials, membership, local root and original files', async (t) => {
  const f = await nativeFixture(t),
    state = await f.service.create(f.input);
  const id = `shared:${state.projectId}`,
    credentials = f.sessions.client.credentials;
  assert.equal(state.role, 'admin');
  assert.equal(f.sessions.localRootBeforeShare, f.local);
  assert.equal((await f.store.read()).credentials.token, credentials.token);
  assert.ok(
    !(await fs.readFile(f.store.filename, 'utf8')).includes(credentials.token),
  );
  assert.ok(!JSON.stringify(f.library.list()).includes(credentials.token));
  await f.runtime.suspend();
  assert.equal(f.sessions.root, null);
  assert.ok(f.library.get(id).credentials);
  await f.runtime.attach(credentials, f.local);
  await f.service.leave();
  assert.equal(f.sessions.root, f.local);
  assert.equal(f.sessions.client, null);
  assert.equal((await f.store.read()).credentials, null);
  assert.throws(() => f.library.get(id), /찾을 수/);
  assert.match(
    await fs.readFile(path.join(f.local, 'project.md'), 'utf8'),
    /original/,
  );
});
test('native create failure during cache validation preserves corrupt bytes and retains received credentials', async (t) => {
  const f = await nativeFixture(t),
    created = await CollaborationClient.create(
      f.url,
      'fixture',
      'owner',
      'remote',
      {},
    );
  const cacheRoot = path.join(
    f.userData,
    'shared-workspaces',
    created.credentials.projectId,
  );
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.writeFile(
    path.join(cacheRoot, 'server-cache.json'),
    'corrupt pending cache',
  );
  const offer = {
    activate: (root) => f.runtime.attach(created.credentials, root),
    retain: (root) =>
      f.library.rememberShared(created.credentials, 'remote', 'admin', root),
  };
  f.runtime.create = async () => offer;
  await assert.rejects(f.service.create(f.input), /덮어쓰지/);
  assert.equal(
    await fs.readFile(path.join(cacheRoot, 'server-cache.json'), 'utf8'),
    'corrupt pending cache',
  );
  assert.equal(f.sessions.root, null);
  assert.equal(
    f.library.get(`shared:${created.credentials.projectId}`).credentials.token,
    created.credentials.token,
  );
});
test('native pending offline/outgoing blocks leave; home still preserves the reconnectable session', async (t) => {
  const f = await nativeFixture(t),
    state = await f.service.create(f.input),
    client = f.sessions.client;
  client.stop();
  client.offline = {
    base: { ...client.files },
    local: { ...client.files, 'ideas/a.md': 'pending local' },
  };
  await f.cache.save(client, f.sessions.root);
  await assert.rejects(f.service.leave(), /미동기화/);
  assert.equal(f.sessions.client, client);
  await f.runtime.suspend();
  assert.ok(f.library.get(`shared:${state.projectId}`).credentials);
  assert.equal(f.sessions.root, null);
});
test('native join and recovery use the real PC protocol while preserving original local files', async (t) => {
  const f = await nativeFixture(t),
    owner = await CollaborationClient.create(
      f.url,
      'fixture',
      'owner',
      'shared',
      {},
    );
  const joined = await f.service.join({
    serverUrl: f.url,
    code: owner.result.code,
    nickname: 'editor',
  });
  assert.equal(joined.role, 'editor');
  assert.equal(f.sessions.localRootBeforeShare, f.local);
  await f.runtime.suspend();
  const recovered = await f.service.recover({
    serverUrl: f.url,
    projectId: owner.credentials.projectId,
    recoveryKey: owner.credentials.recoveryKey,
  });
  assert.equal(recovered.role, 'admin');
  assert.equal(recovered.projectId, joined.projectId);
  assert.match(
    await fs.readFile(path.join(f.local, 'project.md'), 'utf8'),
    /original/,
  );
});
test('native backup uses the original offline JSON format and blocks resolution on a failed backup', async (t) => {
  const f = await nativeFixture(t);
  await f.service.create(f.input);
  const client = f.sessions.client;
  client.stop();
  const offline = {
    base: {},
    local: { 'ideas/a.md': 'draft' },
    transaction: { id: 'receipt', submitted: { 'ideas/a.md': 'submitted' } },
  };
  client.offline = structuredClone(offline);
  let selected = false;
  client.resolveConflict = async () => {
    selected = true;
  };
  await f.service.resolve('id', 'server');
  assert.equal(selected, true);
  const history = path.join(f.sessions.root, '.history'),
    backups = await fs.readdir(history);
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(history, backups[0], 'draft.json'), 'utf8'),
    ),
    offline,
  );
  selected = false;
  const backup = f.store.backupOffline;
  f.store.backupOffline = async () => {
    throw Error('backup disk full');
  };
  await assert.rejects(f.service.resolve('id', 'server'), /backup disk full/);
  assert.equal(selected, false);
  assert.deepEqual(client.offline, offline);
  f.store.backupOffline = backup;
});
test('native session identity protects new root when a previous connection finishes refreshing', async (t) => {
  const f = await nativeFixture(t),
    created = await CollaborationClient.create(
      f.url,
      'fixture',
      'owner',
      'shared',
      {},
    );
  let release, entered;
  const barrier = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (entered = resolve));
  const refresh = CollaborationClient.prototype.refresh;
  try {
    CollaborationClient.prototype.refresh = async function () {
      entered();
      await barrier;
    };
    const attaching = f.runtime.attach(created.credentials, f.local);
    const rejected = assert.rejects(attaching, /세션.*변경/);
    await started;
    const newRoot = path.join(f.root, 'new');
    await fs.mkdir(newRoot);
    await f.sessions.activate(newRoot);
    release();
    await rejected;
    assert.equal(f.sessions.root, newRoot);
    assert.equal(f.calls.filter(([n]) => n === 'notify').length, 0);
    assert.deepEqual(await fs.readdir(newRoot), []);
  } finally {
    release?.();
    CollaborationClient.prototype.refresh = refresh;
  }
});
test('session store skips secret writes without OS encryption but local workspace stays usable', async (t) => {
  const f = await nativeFixture(t),
    store = new CollaborationSessionStore(f.userData, {
      ...encryption,
      isEncryptionAvailable: () => false,
    });
  await store.save({
    credentials: { token: 'never plaintext' },
    localRoot: f.local,
  });
  await assert.rejects(fs.access(store.filename), { code: 'ENOENT' });
  assert.match(
    await fs.readFile(path.join(f.local, 'project.md'), 'utf8'),
    /original/,
  );
});

test('native trash removes only matching session references and leaves unrelated saved sessions intact', async (t) => {
  const f = await nativeFixture(t);
  const session = {
    credentials: { projectId: 'project', token: 'secret' },
    localRoot: f.local,
    extra: 'legacy field',
  };
  await f.store.save(session);
  await f.store.removeReferences('another', path.join(f.root, 'another'));
  assert.deepEqual(await f.store.read(), session);
  await f.store.removeReferences('project', path.join(f.root, 'another'));
  assert.deepEqual(await f.store.read(), { ...session, credentials: null });
  await f.store.removeReferences(undefined, f.local);
  assert.deepEqual(await f.store.read(), {
    ...session,
    credentials: null,
    localRoot: null,
  });
});
