import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createLifecycleService } from '../src/server/services/lifecycle-service.ts';
import {
  projectLifecycle,
  assertProjectActive,
  unavailableProject,
} from '../src/server/services/lifecycle-policy.ts';
import { createProjectRetention } from '../src/server/services/project-retention.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { TRASH_RETENTION } from '../src/trash-files.ts';
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
async function fixture(options = {}) {
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gamejam-lifecycle-service-'),
    ),
    id = randomUUID(),
    live = path.join(root, id);
  await fs.mkdir(live);
  await fs.writeFile(path.join(live, 'unknown.bin'), '보존할 전체 파일');
  const p = {
      id,
      name: '팀 원본',
      revision: 1,
      files: { 'project.md': '# 원본' },
      inviteExpiresAt: 99999,
      job: null,
      lastRun: null,
    },
    projects = new Map([[id, p]]),
    queue = new ProjectQueue(),
    saved = [],
    markers = [],
    removed = [],
    released = [],
    purged = [],
    files = createProjectRetention(root);
  let clock = 1000;
  const ports = {
    projects: { all: () => projects.values(), get: (id) => projects.get(id) },
    queue: (id, work) => queue.run(id, work),
    admin: (m) => {
      if (m.role !== 'admin')
        throw Object.assign(Error('관리자'), { status: 403 });
    },
    files,
    checkpoint: async (id) => {
      await options.checkpoint?.(id);
    },
    persist: async (p) => {
      await options.persist?.(p);
      saved.push(structuredClone(p));
      projects.set(p.id, p);
    },
    purgeStored: (id, version) => purged.push({ id, version }),
    marker: async (id, status, version) =>
      markers.push({ id, status, version }),
    releaseAccess: (id) => released.push(id),
    remove: (id) => {
      removed.push(id);
      projects.delete(id);
    },
    activeRun: (e) =>
      !!e && ['starting', 'running', 'validating'].includes(e.status),
    now: () => clock,
    id: randomUUID,
    retention: TRASH_RETENTION,
  };
  const service = createLifecycleService(ports),
    input = () => ({
      typedName: p.name,
      expectedVersion: projects.get(id)?.lifecycle?.version ?? 0,
      confirmTeam: true,
    });
  const run = (action, payload = input(), role = 'admin') =>
    queue.run(id, () =>
      service.execute(projects.get(id), { id: role, role }, action, payload),
    );
  return {
    root,
    id,
    live,
    files,
    ports,
    service,
    projects,
    queue,
    saved,
    markers,
    purged,
    removed,
    released,
    input,
    run,
    time: (value) => (clock = value),
    get current() {
      return projects.get(id);
    },
    get retained() {
      return path.join(
        root,
        '.project-trash',
        projects.get(id).lifecycle.trashId,
        'project',
      );
    },
  };
}

test('lifecycle policy preserves active/default metadata and 404/410/tombstone error contracts', () => {
  const p = { id: 'p', name: '이름' };
  assert.equal(projectLifecycle(p).status, 'active');
  assert.equal(projectLifecycle(p).version, 0);
  assert.doesNotThrow(() => assertProjectActive(p));
  p.lifecycle = { status: 'trashed', version: 2 };
  assert.throws(() => assertProjectActive(p), {
    status: 410,
    code: 'PROJECT_TRASHED',
  });
  assert.throws(() => unavailableProject('p', undefined), { status: 404 });
  assert.throws(() => unavailableProject('p', 3), {
    status: 410,
    code: 'PROJECT_PURGED',
  });
  assert.throws(
    () => unavailableProject('p', undefined, { status: 'purged', version: 4 }),
    (e) => e.lifecycle.version === 4,
  );
});

test('lifecycle trash requires admin/exact name/version/team confirmation and stopped AI before filesystem changes', async () => {
  const f = await fixture();
  await assert.rejects(f.run('trash', f.input(), 'editor'), { status: 403 });
  for (const patch of [
    { typedName: 'wrong' },
    { expectedVersion: 2 },
    { confirmTeam: false },
  ])
    await assert.rejects(f.run('trash', { ...f.input(), ...patch }));
  f.current.job = { id: 'active' };
  await assert.rejects(f.run('trash'), /AI 작업/);
  f.current.job = null;
  f.current.lastRun = { status: 'validating' };
  await assert.rejects(f.run('trash'), /AI 작업/);
  assert.deepEqual(f.saved, []);
  assert.deepEqual(f.released, []);
  assert.equal(
    await fs.readFile(path.join(f.live, 'unknown.bin'), 'utf8'),
    '보존할 전체 파일',
  );
});

test('lifecycle trash waits for checkpoint, preserves the full tree, and repeated trash is a read-only replay', async () => {
  const gate = defer(),
    entered = defer(),
    f = await fixture({
      checkpoint: () => {
        entered.resolve();
        return gate.promise;
      },
    });
  const pending = f.run('trash');
  await entered.promise;
  assert.equal(f.saved[0].lifecycle.status, 'trashing');
  assert.ok(await fs.stat(f.live));
  gate.resolve();
  const result = await pending;
  assert.equal(result.status, 'trashed');
  assert.equal(result.expiresAt - 1000, TRASH_RETENTION);
  assert.equal(await fs.stat(f.live).catch(() => null), null);
  assert.equal(
    await fs.readFile(path.join(f.retained, 'unknown.bin'), 'utf8'),
    '보존할 전체 파일',
  );
  const n = f.saved.length;
  await f.run('trash');
  assert.equal(f.saved.length, n);
  assert.deepEqual(f.released, [f.id]);
});

test('lifecycle restore preserves files, advances lifecycle/project revision and expires the invite', async () => {
  const f = await fixture();
  await f.run('trash');
  const result = await f.run('trash-restore', {});
  assert.equal(result.status, 'active');
  assert.equal(result.version, 2);
  assert.equal(f.current.revision, 2);
  assert.equal(f.current.inviteExpiresAt, 0);
  assert.equal(
    await fs.readFile(path.join(f.live, 'unknown.bin'), 'utf8'),
    '보존할 전체 파일',
  );
  assert.deepEqual(
    f.saved.map((p) => p.lifecycle.status),
    ['trashing', 'trashed', 'restoring', 'active'],
  );
});

test('lifecycle expired restore is rejected and maintenance purges only the retained folder with a durable tombstone', async () => {
  const f = await fixture();
  await f.run('trash');
  const retained = f.retained;
  await fs.mkdir(f.live);
  await fs.writeFile(path.join(f.live, 'replacement'), '새 폴더 보존');
  f.time(f.current.lifecycle.expiresAt);
  await assert.rejects(f.run('trash-restore', {}), { status: 410 });
  await f.service.maintain();
  assert.equal(f.current, undefined);
  assert.deepEqual(f.purged, [{ id: f.id, version: 2 }]);
  assert.deepEqual(f.markers, [{ id: f.id, status: 'purged', version: 2 }]);
  assert.equal(await fs.stat(retained).catch(() => null), null);
  assert.equal(
    await fs.readFile(path.join(f.live, 'replacement'), 'utf8'),
    '새 폴더 보존',
  );
});

test('lifecycle filesystem identity refuses restoring over a replacement and maintenance records a resumable error', async () => {
  const f = await fixture();
  await f.run('trash');
  await fs.mkdir(f.live);
  await fs.writeFile(path.join(f.live, 'replacement'), 'keep');
  await assert.rejects(f.run('trash-restore', {}), /다른 폴더/);
  await f.service.maintain();
  assert.equal(f.current.lifecycle.status, 'restoring');
  assert.match(f.current.lifecycle.error, /다른 폴더/);
  assert.equal(
    await fs.readFile(path.join(f.retained, 'unknown.bin'), 'utf8'),
    '보존할 전체 파일',
  );
});

test('lifecycle resumes a durable trashing phase after rename succeeds but final state save fails', async () => {
  let fail = true;
  const f = await fixture({
    persist: async (p) => {
      if (fail && p.lifecycle.status === 'trashed') throw Error('phase-save');
    },
  });
  await assert.rejects(f.run('trash'), /phase-save/);
  assert.equal(f.saved.at(-1).lifecycle.status, 'trashing');
  assert.equal(await fs.stat(f.live).catch(() => null), null);
  f.projects.set(f.id, structuredClone(f.saved.at(-1)));
  fail = false;
  await createLifecycleService(f.ports).maintain();
  assert.equal(f.current.lifecycle.status, 'trashed');
  assert.equal(
    await fs.readFile(path.join(f.retained, 'unknown.bin'), 'utf8'),
    '보존할 전체 파일',
  );
});

test('lifecycle resumes a durable restoring phase after move succeeds but active save fails', async () => {
  let fail = false;
  const f = await fixture({
    persist: async (p) => {
      if (fail && p.lifecycle.status === 'active') throw Error('active-save');
    },
  });
  await f.run('trash');
  fail = true;
  await assert.rejects(f.run('trash-restore', {}), /active-save/);
  assert.equal(f.saved.at(-1).lifecycle.status, 'restoring');
  f.projects.set(f.id, structuredClone(f.saved.at(-1)));
  fail = false;
  await createLifecycleService(f.ports).maintain();
  assert.equal(f.current.lifecycle.status, 'active');
  assert.equal(f.current.lifecycle.version, 2);
  assert.equal(
    await fs.readFile(path.join(f.live, 'unknown.bin'), 'utf8'),
    '보존할 전체 파일',
  );
});

test('lifecycle purge resumes after checked deletion fails and never removes metadata prematurely', async () => {
  const f = await fixture();
  await f.run('trash');
  const original = f.ports.files.purge;
  f.ports.files.purge = async () => {
    throw Error('delete-failed');
  };
  await assert.rejects(f.run('trash-purge'), /delete-failed/);
  assert.equal(f.current.lifecycle.status, 'purging');
  assert.deepEqual(f.purged, []);
  assert.deepEqual(f.removed, []);
  f.ports.files.purge = original;
  await f.service.maintain();
  assert.equal(f.current, undefined);
  assert.equal(f.purged.length, 1);
});

test('lifecycle maintenance re-reads the current project after queue wait, avoiding a stale trash operation', async () => {
  const f = await fixture(),
    gate = defer();
  f.current.lifecycle = {
    status: 'trashing',
    version: 1,
    trashId: randomUUID(),
    identity: await f.files.identity(f.id),
  };
  const prior = f.queue.run(f.id, async () => {
    await gate.promise;
    f.projects.set(f.id, {
      ...f.current,
      lifecycle: { ...f.current.lifecycle, status: 'active', version: 2 },
    });
  });
  const pending = f.service.maintain();
  gate.resolve();
  await Promise.all([prior, pending]);
  assert.equal(f.current.lifecycle.status, 'active');
  assert.deepEqual(f.saved, []);
  assert.ok(await fs.stat(f.live));
});

test('retention paths reject traversal and junction sources while preserving the target sentinel', async () => {
  const f = await fixture();
  await assert.rejects(async () => f.files.identity('../escape'));
  const elsewhere = path.join(f.root, 'outside');
  await fs.mkdir(elsewhere);
  await fs.writeFile(path.join(elsewhere, 'sentinel'), 'keep');
  await fs.rename(f.live, path.join(f.root, 'original'));
  await fs.symlink(
    elsewhere,
    f.live,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(f.files.identity(f.id), /링크/);
  assert.equal(
    await fs.readFile(path.join(elsewhere, 'sentinel'), 'utf8'),
    'keep',
  );
  await assert.rejects(async () =>
    f.files.purge({
      id: '../escape',
      lifecycle: { trashId: randomUUID(), identity: null },
    }),
  );
  f.current.lifecycle = { trashId: '../escape', identity: null };
  await assert.rejects(async () => f.files.purge(f.current));
});

test('lifecycle status remains readable while destructive routes enforce admin and phase restrictions', async () => {
  const f = await fixture();
  assert.equal((await f.run('lifecycle', {}, 'viewer')).status, 'active');
  await assert.rejects(f.run('trash-restore', {}), /복원 가능한/);
  await assert.rejects(f.run('trash-purge'), { status: 409 });
  await f.run('trash');
  await assert.rejects(f.run('trash-status', {}, 'viewer'), { status: 403 });
  f.current.lifecycle.status = 'restoring';
  await assert.rejects(f.run('trash-purge'), /복원을 먼저/);
});

test('failed trash commit preserves active in-memory lifecycle and locks before any move', async () => {
  const f = await fixture({
    persist: async () => {
      throw new Error('commit-abort');
    },
  });
  const before = structuredClone(f.current);
  await assert.rejects(f.run('trash'), /commit-abort/);
  assert.deepEqual(f.current, before);
  assert.deepEqual(f.released, []);
  assert.equal(
    await fs.readFile(path.join(f.live, 'unknown.bin'), 'utf8'),
    '보존할 전체 파일',
  );
});

test('restore final commit failure keeps the durable restoring phase for maintenance retry', async () => {
  let block = false;
  const f = await fixture({
    persist: async (p) => {
      if (block && p.lifecycle.status === 'active')
        throw new Error('active-commit-abort');
    },
  });
  await f.run('trash');
  block = true;
  await assert.rejects(f.run('trash-restore', {}), /active-commit-abort/);
  assert.equal(f.current.lifecycle.status, 'restoring');
  assert.equal(f.current.revision, 1);
  block = false;
  await f.service.maintain();
  assert.equal(f.current.lifecycle.status, 'active');
  assert.equal(f.current.revision, 2);
});

test('async purge waits for the repository tombstone before publishing marker/removing project', async () => {
  const f = await fixture(),
    gate = defer(),
    entered = defer();
  await f.run('trash');
  f.ports.purgeStored = async () => {
    entered.resolve();
    await gate.promise;
  };
  const purging = f.run('trash-purge');
  await entered.promise;
  assert.equal(f.current.lifecycle.status, 'purging');
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.markers, []);
  gate.resolve();
  await purging;
  assert.equal(f.current, undefined);
  assert.equal(f.markers.at(-1).status, 'purged');
});
