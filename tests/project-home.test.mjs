import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectHomeService } from '../src/application/projects/home-service.ts';
import { filesystemHomeProjects } from '../src/adapters/filesystem/home-projects.ts';
import {
  desktopSharedProjects,
  homeProjectRegistry,
} from '../src/desktop/projects/shared-projects.ts';
import { registerProjectIpc } from '../src/desktop/ipc/projects.ts';
import { ProjectLibrary } from '../src/project-library.ts';
import { parseConnectionInfo, connectionInfo } from '../src/connection-info.ts';
import { serverAddress } from '../src/collaboration-client.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { createCollaborationServer } from '../src/collaboration-server.ts';
import { readHistoryFile, listHistory } from '../src/project-store.ts';

const projectId = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const entries = [
    {
      id: 'local:one',
      kind: 'local',
      root: '/one',
      name: 'local',
      lastOpenedAt: 1,
    },
    {
      id: `shared:${projectId}`,
      projectId,
      kind: 'shared',
      name: 'shared',
      serverUrl: 'https://old.example',
      role: 'admin',
      lastOpenedAt: 2,
    },
  ];
  const calls = [];
  const record =
    (name, value) =>
    async (...args) => {
      calls.push([name, ...args]);
      return value;
    };
  let current = { root: null };
  const ports = {
    registry: {
      list: () => structuredClone(entries),
      get: (id) =>
        structuredClone(
          entries.find((e) => e.id === id) ??
            (() => {
              throw Error('missing');
            })(),
        ),
      hasSharedSession: (id) => id === entries[1].id,
      renameProject: record('remember'),
      updateServer: record('server'),
      listFolders: () => [],
      createFolder: record('create-folder'),
      renameFolder: record('rename-folder'),
      removeFolder: record('remove-folder'),
      moveProject: record('move'),
    },
    local: {
      name: record('name', 'disk name'),
      timestamps: record('timestamps', { createdAt: 10, modifiedAt: 20 }),
      rename: record('rename-local'),
      directory: record('directory', '/real/one'),
      create: record('mkdir', '/new'),
    },
    shared: {
      cache: record('cache', {
        pendingChanges: 2,
        role: 'editor',
        createdAt: 30,
        modifiedAt: 40,
      }),
      lifecycle: record('lifecycle', {
        projectId,
        status: 'active',
        version: 1,
      }),
      metadata: record('metadata', {
        name: 'online',
        role: 'admin',
        modifiedAt: 50,
      }),
      rename: record('rename-shared', { name: 'server name', role: 'admin' }),
    },
    session: {
      current: () => current,
      workspace: () => ({ root: current.root, name: 'current' }),
      suspend: record('suspend'),
      openLocal: record('open-local', { root: '/real/one', name: 'local' }),
      openShared: record('open-shared', { root: '/shared', name: 'shared' }),
      checkHost: record('check-host'),
    },
    trash: {
      hasProject: () => false,
      prepare: record('prepare'),
      list: record('trash-list', []),
      trash: record('trash', 'trash-id'),
      restore: record('restore', { key: 'value' }),
      acknowledgeRestore: record('ack'),
      purge: record('purge'),
      maintain: record('retry'),
    },
    parseConnection: parseConnectionInfo,
    serverAddress,
    chooseParent: record('choose', '/parent'),
    reveal: (...args) => calls.push(['reveal', ...args]),
    changed: () => calls.push(['changed']),
    stopViewer: () => calls.push(['stop-viewer']),
    drainViewer: record('drain-viewer'),
    pauseSaves: record('pause'),
    drainCache: record('drain-cache'),
    startViewer: () => calls.push(['start-viewer']),
  };
  return {
    ports,
    entries,
    calls,
    service: new ProjectHomeService(ports),
    current: (value) => (current = value),
  };
}
test('home listing stays offline by default, preserves roles/grouping and has no registry writes', async () => {
  const f = fixture();
  f.entries[1].folderId = 'group';
  f.current({ root: '/shared', sharedId: projectId, connected: false });
  const list = await f.service.list();
  assert.equal(list[0].name, 'disk name');
  assert.deepEqual(
    [
      list[1].role,
      list[1].pendingChanges,
      list[1].folderId,
      list[1].current,
      list[1].connected,
    ],
    ['admin', 2, 'group', true, false],
  );
  assert.ok(
    !f.calls.some(([name]) =>
      ['metadata', 'lifecycle', 'remember'].includes(name),
    ),
  );
  assert.equal(f.entries[0].name, 'local');
});
test('unavailable files/cache/server keep list entries and names usable', async () => {
  const f = fixture();
  f.ports.local.timestamps = async () => {
    throw Error('missing folder');
  };
  f.ports.shared.cache = f.ports.shared.lifecycle = async () => {
    throw Error('offline');
  };
  const list = await f.service.list(true);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'disk name');
  assert.equal(list[1].name, 'shared');
  assert.ok(!f.calls.some(([n]) => n === 'remember'));
});
test('refresh reads metadata only for active shared projects; lifecycle tombstones survive', async () => {
  const f = fixture();
  const list = await f.service.list(true);
  assert.equal(list[1].name, 'online');
  assert.deepEqual(
    f.calls.find(([n]) => n === 'remember'),
    ['remember', f.entries[1].id, 'online', 'admin'],
  );
  f.calls.length = 0;
  f.ports.shared.lifecycle = async () => ({
    projectId,
    status: 'trashed',
    version: 2,
  });
  assert.equal((await f.service.list(true))[1].lifecycle.status, 'trashed');
  assert.ok(!f.calls.some(([n]) => n === 'metadata' || n === 'remember'));
});
test('rename validates before effects, preserves expected name and acknowledges only successful persistence', async () => {
  const f = fixture();
  await assert.rejects(f.service.rename('local:one', '\n'), /이름/);
  assert.equal(f.calls.length, 0);
  await f.service.rename(f.entries[1].id, ' new ', 'old');
  assert.deepEqual(f.calls, [
    ['rename-shared', f.entries[1].id, 'new', 'old'],
    ['remember', f.entries[1].id, 'server name', 'admin'],
    ['changed'],
  ]);
  f.calls.length = 0;
  f.ports.local.rename = async () => {
    throw Error('conflict');
  };
  await assert.rejects(f.service.rename('local:one', 'new', 'old'), /conflict/);
  assert.equal(f.calls.length, 0);
  f.ports.registry.renameProject = async () => {
    throw Error('registry disk full');
  };
  await assert.rejects(f.service.rename(f.entries[1].id, 'new'), /disk full/);
  assert.ok(!f.calls.some(([n]) => n === 'changed'));
});
test('open validates local directory and trash before suspending, current project does not reopen', async () => {
  const f = fixture();
  f.current({ root: '/one' });
  assert.equal((await f.service.open('local:one')).name, 'current');
  assert.equal(f.calls.length, 0);
  f.ports.trash.hasProject = () => true;
  await assert.rejects(f.service.open('local:one'), /복원/);
  assert.equal(f.calls.length, 0);
  f.ports.trash.hasProject = () => false;
  f.current({ root: null });
  f.ports.local.directory = async () => {
    throw Error('missing');
  };
  await assert.rejects(f.service.open('local:one'), /missing/);
  assert.equal(f.calls.length, 0);
  await f.service.open(f.entries[1].id);
  assert.deepEqual(f.calls, [['suspend'], ['open-shared', f.entries[1].id]]);
});
test('create validates names and cancel does not suspend or create a directory', async () => {
  const f = fixture();
  await assert.rejects(f.service.create('../escape'), /이름/);
  assert.equal(f.calls.length, 0);
  f.ports.chooseParent = async () => null;
  assert.deepEqual(await f.service.create('new'), {
    root: null,
    name: 'current',
  });
  assert.equal(f.calls.length, 0);
  f.ports.chooseParent = async () => '/parent';
  f.ports.local.create = async () => {
    throw Error('existing folder');
  };
  await assert.rejects(f.service.create('new'), /existing/);
  assert.equal(f.calls.length, 0);
});
test('home waits for successful suspension before checking PC host, reveal rejects shared projects', async () => {
  const f = fixture();
  await f.service.home();
  assert.deepEqual(f.calls, [['suspend'], ['check-host']]);
  f.calls.length = 0;
  f.ports.session.suspend = async () => {
    throw Error('AI active');
  };
  await assert.rejects(f.service.home(), /AI active/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.service.reveal(f.entries[1].id), /로컬/);
  await f.service.reveal('local:one');
  assert.deepEqual(f.calls, [
    ['directory', '/one'],
    ['reveal', '/real/one'],
  ]);
});
test('connection requires saved membership, blocks active project, and returns only public fields', async () => {
  const f = fixture();
  const text = connectionInfo(projectId, 'https://new.example');
  assert.deepEqual(f.service.inspectConnection(text), {
    id: f.entries[1].id,
    name: 'shared',
    serverUrl: 'https://new.example',
    previousUrl: 'https://old.example',
  });
  f.current({ root: '/shared', sharedId: projectId });
  await assert.rejects(f.service.applyConnection(text), /홈으로/);
  await assert.rejects(
    f.service.server(f.entries[1].id, 'https://new.example'),
    /홈으로/,
  );
  assert.equal(f.calls.length, 0);
  f.current({ root: null });
  await f.service.applyConnection(text);
  assert.deepEqual(f.calls, [
    ['server', f.entries[1].id, 'https://new.example'],
  ]);
  f.ports.registry.hasSharedSession = () => false;
  assert.throws(() => f.service.inspectConnection(text), /참여 세션/);
  assert.throws(
    () =>
      f.service.inspectConnection(
        connectionInfo(projectId, 'http://localhost:1234'),
      ),
    /HTTPS/,
  );
});
test('trash drains writes in order and returns only after native commit', async () => {
  const f = fixture();
  const storage = { scope: 'draft' };
  assert.equal(await f.service.trash('prepared-token', storage), 'trash-id');
  assert.deepEqual(f.calls, [
    ['stop-viewer'],
    ['drain-viewer'],
    ['suspend'],
    ['pause'],
    ['drain-cache'],
    ['trash', 'prepared-token', storage],
    ['start-viewer'],
  ]);
});
for (const failure of [
  'drainViewer',
  'suspend',
  'pauseSaves',
  'drainCache',
  'trash',
]) {
  test(`trash failure at ${failure} restarts viewer without proceeding or acknowledging success`, async () => {
    const f = fixture();
    if (failure === 'suspend')
      f.ports.session.suspend = async () => {
        throw Error('injected');
      };
    else if (failure === 'trash')
      f.ports.trash.trash = async () => {
        throw Error('injected');
      };
    else
      f.ports[failure] = async () => {
        throw Error('injected');
      };
    await assert.rejects(f.service.trash('token', {}), /injected/);
    assert.equal(f.calls.at(-1)[0], 'start-viewer');
    assert.ok(!f.calls.some(([n]) => n === 'trash'));
  });
}
test('IPC retains all 28 project wires and home-sender guard before parsing connection data', async () => {
  const f = fixture(),
    handlers = new Map();
  registerProjectIpc(
    (channel, fn) => {
      assert.ok(!handlers.has(channel));
      handlers.set(channel, fn);
      return fn;
    },
    f.service,
    (event) => {
      if (event !== 'trusted') throw Error('sender');
    },
  );
  assert.equal(handlers.size, 28);
  assert.throws(
    () => handlers.get('projects:connection-inspect')('untrusted', 'invalid'),
    /sender/,
  );
  assert.throws(
    () => handlers.get('projects:connection-apply')('untrusted', 'invalid'),
    /sender/,
  );
  await handlers.get('projects:shared-trash')(
    'trusted',
    'id',
    'typed',
    true,
    7,
  );
  assert.deepEqual(f.calls.at(-1), [
    'lifecycle',
    'id',
    'trash',
    { typedName: 'typed', confirmTeam: true, expectedVersion: 7 },
  ]);
  await handlers.get('projects:trash-purge')('trusted', 'id', 'typed', false);
  assert.deepEqual(f.calls.at(-1), ['purge', 'id', 'typed', false]);
});

async function temporary(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-home-service-')),
  );
  t.after(async () => {
    assert.ok(root.startsWith((await fs.realpath(os.tmpdir())) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString(),
};
test('native local rename preserves body/unknown metadata, history snapshots, and deleted project.md semantics', async (t) => {
  const root = await temporary(t);
  const raw =
    '---\nid: project\ntitle: old\nproject_name: old\ncustom: keep\n---\n# 원본 한글\n';
  await fs.writeFile(path.join(root, 'project.md'), raw);
  await assert.rejects(
    filesystemHomeProjects.rename(root, 'new', 'stale'),
    /바뀌었습니다/,
  );
  assert.equal(await fs.readFile(path.join(root, 'project.md'), 'utf8'), raw);
  await filesystemHomeProjects.rename(root, 'new', 'old');
  const next = await fs.readFile(path.join(root, 'project.md'), 'utf8');
  assert.match(next, /custom: keep/);
  assert.match(next, /# 원본 한글/);
  assert.equal(await filesystemHomeProjects.name(root), 'new');
  const history = await listHistory(root);
  assert.equal(history.length, 1);
  assert.equal(
    await readHistoryFile(root, history[0].id, 'project.md', 'before'),
    raw,
  );
  assert.equal(
    await readHistoryFile(root, history[0].id, 'project.md', 'after'),
    next,
  );
  await fs.rm(path.join(root, 'project.md'));
  await filesystemHomeProjects.rename(root, 'without document', 'new');
  await assert.rejects(fs.access(path.join(root, 'project.md')), {
    code: 'ENOENT',
  });
  assert.equal(await filesystemHomeProjects.name(root), 'without document');
  assert.equal((await listHistory(root)).length, 1);
});
test('native local rename detects concurrent source edits and keeps temp files out of project', async (t) => {
  const root = await temporary(t),
    filename = path.join(root, 'project.md');
  const raw = '---\nid: project\nproject_name: old\n---\nold\n';
  await fs.writeFile(filename, raw);
  const write = fs.writeFile;
  try {
    fs.writeFile = async (...args) => {
      const result = await write(...args);
      if (
        String(args[0]).startsWith(filename + '.') &&
        String(args[0]).endsWith('.tmp')
      )
        await write(filename, raw + 'peer edit');
      return result;
    };
    await assert.rejects(
      filesystemHomeProjects.rename(root, 'new', 'old'),
      /문서가 변경/,
    );
  } finally {
    fs.writeFile = write;
  }
  assert.equal(await fs.readFile(filename, 'utf8'), raw + 'peer edit');
  assert.ok(!(await fs.readdir(root)).some((name) => name.endsWith('.tmp')));
  assert.equal((await listHistory(root)).length, 0);
});
test('native directory creation refuses existing folders without changing their contents', async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, 'existing'));
  await fs.writeFile(path.join(root, 'existing/keep'), 'preserve');
  await assert.rejects(filesystemHomeProjects.create(root, 'existing'), /이미/);
  assert.equal(
    await fs.readFile(path.join(root, 'existing/keep'), 'utf8'),
    'preserve',
  );
});
async function sharedFixture(t) {
  const root = await temporary(t),
    library = new ProjectLibrary(root, encryption);
  await library.load();
  const credentials = {
    projectId,
    serverUrl: 'http://127.0.0.1:1',
    internalServer: true,
    token: 'secret-token',
    memberId: randomUUID(),
  };
  await library.rememberShared(
    credentials,
    'saved',
    'admin',
    '/private-source',
  );
  const id = `shared:${projectId}`,
    directory = path.join(root, 'shared-workspaces', projectId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'server-cache.json'),
    JSON.stringify({ files: {}, state: { role: 'admin' } }),
  );
  const requests = [];
  const options = {
    library,
    userData: root,
    active: () => null,
    internalServerUrl: async () => 'http://127.0.0.1:43210',
    drainCache: async () => {},
    fetch: async (...args) => {
      requests.push(args);
      return args[1].endsWith('/state')
        ? { state: { projectName: 'metadata', role: 'editor' } }
        : { projectId, status: 'active', version: 1 };
    },
  };
  return {
    root,
    library,
    id,
    directory,
    requests,
    options,
    adapter: desktopSharedProjects(options),
  };
}
test('shared adapter keeps credentials private and uses current internal server address for lifecycle/metadata/rename', async (t) => {
  const f = await sharedFixture(t),
    publicRegistry = homeProjectRegistry(f.library);
  assert.ok(!JSON.stringify(publicRegistry.get(f.id)).includes('secret-token'));
  assert.ok(
    !JSON.stringify(publicRegistry.get(f.id)).includes('/private-source'),
  );
  await f.adapter.lifecycle(f.id, 'lifecycle');
  await f.adapter.metadata(f.id);
  assert.equal(f.requests.length, 2);
  for (const args of f.requests) {
    assert.equal(args[0], 'http://127.0.0.1:43210');
    assert.equal(args[3], 'secret-token');
  }
  assert.deepEqual(f.requests[1][2], { metadataOnly: true });
  let seen;
  f.options.client = (credentials) => {
    seen = credentials;
    return {
      state: { projectName: 'renamed', role: 'admin' },
      refresh: async () => {},
      renameProject: async (name, expected) => {
        assert.deepEqual([name, expected], ['renamed', 'saved']);
      },
    };
  };
  assert.equal(
    (await desktopSharedProjects(f.options).rename(f.id, 'renamed', 'saved'))
      .name,
    'renamed',
  );
  assert.equal(seen.serverUrl, 'http://127.0.0.1:43210');
  assert.equal(f.library.get(f.id).credentials.serverUrl, 'http://127.0.0.1:1');
});
test('shared lifecycle fallback is query-only; destructive failures are propagated without caching a success', async (t) => {
  const f = await sharedFixture(t),
    lifecycle = { projectId, status: 'trashed', version: 4 };
  f.options.fetch = async () => {
    throw Object.assign(Error('gone'), { lifecycle });
  };
  const adapter = desktopSharedProjects(f.options);
  assert.deepEqual(await adapter.lifecycle(f.id, 'lifecycle'), lifecycle);
  await assert.rejects(
    adapter.lifecycle(f.id, 'trash', { typedName: 'saved' }),
    /gone/,
  );
  assert.deepEqual(f.library.get(f.id).lifecycle, lifecycle);
});
test('pending cache blocks shared rename before connecting and counts distinct offline changed files', async (t) => {
  const f = await sharedFixture(t);
  const offline = {
    base: { 'a.md': 'old', 'b.md': 'same' },
    local: { 'a.md': 'new', 'b.md': 'same', 'c.md': 'created' },
  };
  await fs.writeFile(
    path.join(f.directory, 'server-cache.json'),
    JSON.stringify({ files: {}, state: {}, offline }),
  );
  assert.equal((await f.adapter.cache(f.id)).pendingChanges, 2);
  let connected = false;
  f.options.client = () => {
    connected = true;
    throw Error('must not connect');
  };
  await assert.rejects(
    desktopSharedProjects(f.options).rename(f.id, 'new', 'old'),
    /미동기화/,
  );
  assert.equal(connected, false);
  assert.equal(f.library.get(f.id).name, 'saved');
});

test('default authenticated transport refreshes and renames through a real temporary PC server', async (t) => {
  const root = await temporary(t);
  const server = await createCollaborationServer({
    dataDirectory: path.join(root, 'server'),
    port: 0,
    creationKey: 'fixture',
  });
  try {
    const url = `http://127.0.0.1:${server.port}`;
    const created = await CollaborationClient.create(
      url,
      'fixture',
      'owner',
      'saved',
      {},
    );
    const library = new ProjectLibrary(path.join(root, 'profile'), encryption);
    await library.load();
    await library.rememberShared(
      {
        ...created.credentials,
        internalServer: true,
        serverUrl: 'http://127.0.0.1:1',
      },
      'saved',
      'admin',
      null,
    );
    const id = `shared:${created.credentials.projectId}`,
      directory = path.join(
        root,
        'profile/shared-workspaces',
        created.credentials.projectId,
      );
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'server-cache.json'),
      JSON.stringify({ files: {}, state: {} }),
    );
    const adapter = desktopSharedProjects({
      library,
      userData: path.join(root, 'profile'),
      active: () => null,
      internalServerUrl: async () => url,
      drainCache: async () => {},
    });
    assert.equal((await adapter.lifecycle(id, 'lifecycle')).status, 'active');
    assert.equal((await adapter.metadata(id)).name, 'saved');
    assert.equal(
      (await adapter.rename(id, 'renamed', 'saved')).name,
      'renamed',
    );
    assert.equal((await adapter.metadata(id)).name, 'renamed');
    await assert.rejects(adapter.rename(id, 'stale', 'saved'), /변경|바뀌/);
    assert.equal((await adapter.metadata(id)).name, 'renamed');
  } finally {
    await server.close();
  }
});
