import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createProjectService } from '../src/server/services/project-service.ts';
import { createMemberService } from '../src/server/services/member-service.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { ApiError } from '../src/server/services/errors.ts';
import { SyncStore } from '../src/sync-store.ts';

const snapshot = {
  'project.md': '---\nid: project\ntitle: 원본\ncustom: keep\n---\n한글 원본\n',
};
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture(options = {}) {
  const projects = new Map(),
    queue = new ProjectQueue(),
    notices = [],
    seen = [],
    locks = new Map(),
    online = new Map();
  let now = 1000,
    ids = 0,
    tokens = 0,
    codes = 0;
  const identity = {
    now: () => now,
    id: () => `00000000-0000-0000-0000-${String(++ids).padStart(12, '0')}`,
    secret: () => `private-${++tokens}`,
    invite: () => String(++codes).padStart(20, '0'),
    digest: (value) => createHash('sha256').update(value).digest('hex'),
    matches: (value, hash) =>
      timingSafeEqual(
        Buffer.from(identity.digest(value), 'hex'),
        Buffer.from(hash, 'hex'),
      ),
  };
  const lockMap = (id) => {
    if (!locks.has(id)) locks.set(id, new Map());
    return locks.get(id);
  };
  const access = createAccessPolicy({
    matches: identity.matches,
    now: identity.now,
    seen: (...args) => {
      seen.push(args);
      online.set(args[1], args[2]);
    },
    locks: lockMap,
  });
  const lifecycle = (p) => ({
    projectId: p.id,
    name: p.name,
    status: p.lifecycle?.status ?? 'active',
    version: p.lifecycle?.version ?? 0,
  });
  const persist = async (p) => {
    await options.beforeCommit?.(p);
    options.store?.save(p);
    projects.set(p.id, p);
    notices.push(p.id);
  };
  const envelope = (p, m) => ({
    files: p.files,
    revisions: p.revisions,
    state: {
      projectId: p.id,
      memberId: m.id,
      role: m.role,
      revision: p.revision,
      projectName: p.name,
      connected: true,
      members: p.members
        .filter((m) => !m.removed)
        .map((m) => ({
          id: m.id,
          role: m.role,
          owner: m.owner,
          nickname: m.nickname,
        })),
    },
  });
  const common = {
    identity,
    persist,
    envelope,
    clone: structuredClone,
    admin: access.admin,
    recordChanges: (p, m, files, label) => {
      p.revision++;
      p.files = files;
      p.history.push({
        entry: { id: identity.id(), actorId: m.id, label, files: [] },
        before: { ...files },
        after: { ...files },
      });
    },
  };
  const service = createProjectService({
    ...common,
    editable: access.editable,
    projects: {
      count: () => projects.size,
      all: () => projects.values(),
      get: (id) => projects.get(id),
    },
    queue: queue.run.bind(queue),
    authenticate: access.authenticate,
    lifecycle,
    assertActive: (p) => {
      if (p.lifecycle && p.lifecycle.status !== 'active')
        throw new ApiError('project trashed', 410);
    },
  });
  const members = createMemberService({
    ...common,
    releaseLocks: (id, member) => {
      for (const [key, lock] of lockMap(id))
        if (lock.memberId === member) lockMap(id).delete(key);
    },
    forgetPresence: (_id, member) => online.delete(member),
  });
  const create = () =>
    service.create({
      name: ' test ',
      nickname: ' 관리자 ',
      files: structuredClone(snapshot),
    });
  const current = (result) => projects.get(result.state.projectId);
  const owner = (result) => current(result).members.find((m) => m.owner);
  const queued = (result, operation) =>
    queue.run(result.state.projectId, async () =>
      operation(
        current(result),
        access.authenticate(current(result), result.token),
      ),
    );
  return {
    projects,
    queue,
    service,
    members,
    notices,
    seen,
    locks,
    lockMap,
    online,
    identity,
    access,
    create,
    current,
    owner,
    queued,
    setNow: (v) => (now = v),
  };
}

test('project creation preserves defaults and bytes, injects clock/IDs/tokens, and authenticates after persistence', async () => {
  const f = fixture(),
    created = await f.create(),
    p = f.current(created);
  assert.equal(p.name, 'test');
  assert.equal(p.createdAt, 1000);
  assert.equal(p.modifiedAt, 1000);
  assert.equal(p.revision, 1);
  assert.deepEqual(p.files, snapshot);
  assert.deepEqual(p.revisions, { 'project.md': 1 });
  assert.equal(p.members[0].role, 'admin');
  assert.equal(p.members[0].owner, true);
  assert.equal(p.members[0].nickname, '관리자');
  assert.equal(p.members[0].tokenHash, f.identity.digest(created.token));
  assert.equal(p.inviteHash, f.identity.digest(created.code));
  assert.equal(p.recoveryHash, f.identity.digest(created.recoveryKey));
  assert.equal(p.inviteExpiresAt, 1000 + 86400000);
  assert.deepEqual(p.history, []);
  assert.deepEqual(p.applied, []);
  assert.deepEqual(f.notices, [p.id]);
  assert.equal(f.seen.length, 1);
  assert.ok(!JSON.stringify(created.state).includes(created.token));
});

test('project creation rejects invalid names/snapshots and preserves the existing project limit', async () => {
  const f = fixture();
  for (const value of ['', 'x'.repeat(41), 'a\nb', null])
    await assert.rejects(
      f.service.create({ name: value, nickname: 'x', files: snapshot }),
      { status: 400 },
    );
  await assert.rejects(
    f.service.create({
      name: 'x',
      nickname: 'x',
      files: { '../escape': 'no' },
    }),
  );
  for (let i = 0; i < 20; i++) f.projects.set(String(i), {});
  await assert.rejects(f.create(), { status: 413 });
  assert.equal(f.notices.length, 0);
  assert.equal(f.seen.length, 0);
});

test('creation waits for commit and failed creation never publishes or authenticates', async () => {
  const gate = defer(),
    started = defer();
  let fail = true;
  const f = fixture({
    beforeCommit: async () => {
      started.resolve();
      await gate.promise;
      if (fail) throw Error('save failed');
    },
  });
  const pending = f.create(),
    rejected = assert.rejects(pending, /save failed/);
  await started.promise;
  assert.equal(f.projects.size, 0);
  assert.deepEqual(f.seen, []);
  gate.resolve();
  await rejected;
  assert.deepEqual(f.notices, []);
  fail = false;
  await f.create();
  assert.equal(f.projects.size, 1);
  assert.equal(f.seen.length, 1);
});

test('joining normalizes invite code and ignores supplied role/owner while preserving files and history', async () => {
  const f = fixture(),
    created = await f.create(),
    before = structuredClone(f.current(created));
  const joined = await f.service.join({
    code: ` ${created.code.slice(0, 10)}-${created.code.slice(10)} `,
    nickname: ' 팀원 ',
    role: 'admin',
    owner: true,
  });
  const p = f.current(created);
  assert.equal(joined.state.role, 'editor');
  assert.equal(p.members.length, 2);
  assert.equal(p.members[1].owner, false);
  assert.equal(p.members[1].nickname, '팀원');
  assert.deepEqual(p.files, before.files);
  assert.deepEqual(p.history, before.history);
  assert.equal(p.revision, before.revision);
  assert.equal(f.access.authenticate(p, joined.token).id, p.members[1].id);
});

test('join rechecks rotated invite inside queue and a corrected retry can join', async () => {
  const f = fixture(),
    created = await f.create(),
    gate = defer();
  let rotated;
  const change = f.queued(created, async (p, m) => {
    await gate.promise;
    rotated = await f.members.rotateInvite(p, m);
  });
  const joining = assert.rejects(
    f.service.join({ code: created.code, nickname: 'late' }),
    { status: 403 },
  );
  gate.resolve();
  await Promise.all([change, joining]);
  assert.equal(f.current(created).members.length, 1);
  const joined = await f.service.join({
    code: rotated.code,
    nickname: 'retry',
  });
  assert.equal(joined.state.role, 'editor');
});

test('join rechecks expiry and lifecycle after a queued wait', async () => {
  for (const mode of ['expired', 'trashed']) {
    const f = fixture(),
      created = await f.create(),
      gate = defer();
    const changed = f.queue.run(created.state.projectId, async () => {
      await gate.promise;
      if (mode === 'expired') f.setNow(86402000);
      else f.current(created).lifecycle = { status: 'trashed', version: 1 };
    });
    const joining = assert.rejects(
      f.service.join({ code: created.code, nickname: 'late' }),
      { status: mode === 'expired' ? 403 : 410 },
    );
    gate.resolve();
    await Promise.all([changed, joining]);
    assert.equal(f.current(created).members.length, 1);
  }
});

test('concurrent joins recheck active member limit in queue; removed members do not consume capacity', async () => {
  const f = fixture(),
    created = await f.create(),
    p = f.current(created);
  for (let i = 1; i < 19; i++)
    p.members.push({
      ...p.members[0],
      id: String(i),
      owner: false,
      role: 'editor',
    });
  p.members.push({
    ...p.members[0],
    id: 'removed',
    removed: true,
    owner: false,
  });
  const results = await Promise.allSettled([
    f.service.join({ code: created.code, nickname: 'one' }),
    f.service.join({ code: created.code, nickname: 'two' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 413);
  assert.equal(f.current(created).members.filter((m) => !m.removed).length, 20);
});

test('recovery rotates owner token and recovery key without changing files/history or other members', async () => {
  const f = fixture(),
    created = await f.create();
  await f.service.join({ code: created.code, nickname: 'team' });
  const before = structuredClone(f.current(created));
  f.owner(created).removed = true;
  f.owner(created).role = 'viewer';
  const restored = await f.service.recover({
    projectId: created.state.projectId,
    recoveryKey: created.recoveryKey,
  });
  assert.notEqual(restored.token, created.token);
  assert.notEqual(restored.recoveryKey, created.recoveryKey);
  assert.equal(restored.state.role, 'admin');
  assert.equal(f.owner(created).removed, false);
  assert.deepEqual(f.current(created).files, before.files);
  assert.deepEqual(f.current(created).history, before.history);
  assert.deepEqual(f.current(created).members[1], before.members[1]);
  assert.throws(
    () => f.access.authenticate(f.current(created), created.token),
    { status: 403 },
  );
  await assert.rejects(
    f.service.recover({
      projectId: created.state.projectId,
      recoveryKey: created.recoveryKey,
    }),
    { status: 403 },
  );
});

test('concurrent recovery rechecks the latest recovery key and allows only one rotation', async () => {
  const f = fixture(),
    created = await f.create(),
    input = {
      projectId: created.state.projectId,
      recoveryKey: created.recoveryKey,
    };
  const results = await Promise.allSettled([
    f.service.recover(input),
    f.service.recover(input),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 403);
});

test('recovery of trashed project returns management credentials without exposing stored files', async () => {
  const f = fixture(),
    created = await f.create();
  f.current(created).lifecycle = { status: 'trashed', version: 2 };
  const seen = f.seen.length;
  const restored = await f.service.recover({
    projectId: created.state.projectId,
    recoveryKey: created.recoveryKey,
  });
  assert.deepEqual(restored.files, {});
  assert.deepEqual(restored.revisions, {});
  assert.equal(restored.state.connected, false);
  assert.equal(restored.state.accessDenied, true);
  assert.equal(restored.state.projectDeleted, true);
  assert.equal(restored.lifecycle.version, 2);
  assert.deepEqual(f.current(created).files, snapshot);
  assert.equal(f.seen.length, seen);
});

test('failed join/recovery preserve membership and original tokens until a successful retry', async () => {
  let fail = false;
  const f = fixture({
      beforeCommit: async () => {
        if (fail) throw Error('save failed');
      },
    }),
    created = await f.create(),
    before = structuredClone(f.current(created)),
    seen = f.seen.length;
  fail = true;
  await assert.rejects(
    f.service.join({ code: created.code, nickname: 'team' }),
    /save failed/,
  );
  await assert.rejects(
    f.service.recover({
      projectId: created.state.projectId,
      recoveryKey: created.recoveryKey,
    }),
    /save failed/,
  );
  assert.deepEqual(f.current(created), before);
  assert.equal(f.seen.length, seen);
  assert.equal(
    f.access.authenticate(f.current(created), created.token).owner,
    true,
  );
  fail = false;
  await f.service.recover({
    projectId: created.state.projectId,
    recoveryKey: created.recoveryKey,
  });
});

test('rename is admin-only, stale-safe and retry-safe and preserves original document bytes', async () => {
  const f = fixture(),
    created = await f.create(),
    before = structuredClone(f.current(created).files);
  await assert.rejects(
    f.service.rename(
      f.current(created),
      { role: 'editor' },
      { name: 'next', expectedName: 'test' },
    ),
    { status: 403 },
  );
  await assert.rejects(
    f.queued(created, (p, m) =>
      f.service.rename(p, m, { name: 'next', expectedName: 'old' }),
    ),
    { status: 409 },
  );
  await f.queued(created, (p, m) =>
    f.service.rename(p, m, { name: ' next ', expectedName: 'test' }),
  );
  const count = f.notices.length;
  await f.queued(created, (p, m) =>
    f.service.rename(p, m, { name: 'next', expectedName: 'test' }),
  );
  assert.equal(f.current(created).name, 'next');
  assert.equal(f.current(created).history.length, 1);
  assert.equal(f.notices.length, count);
  assert.deepEqual(f.current(created).files, before);
  f.current(created).job = { memberId: 'any', fileLock: { paths: [] } };
  await assert.rejects(
    f.queued(created, (p, m) =>
      f.service.rename(p, m, { name: 'later', expectedName: 'next' }),
    ),
    /AI 작업/,
  );
});

test('invite rotation uses injected expiry and failed save keeps the old invite valid', async () => {
  let fail = false;
  const f = fixture({
      beforeCommit: async () => {
        if (fail) throw Error('save failed');
      },
    }),
    created = await f.create(),
    before = structuredClone(f.current(created));
  fail = true;
  await assert.rejects(
    f.queued(created, (p, m) => f.members.rotateInvite(p, m)),
    /save failed/,
  );
  assert.deepEqual(f.current(created), before);
  fail = false;
  f.setNow(2000);
  const rotated = await f.queued(created, (p, m) =>
    f.members.rotateInvite(p, m),
  );
  assert.notEqual(rotated.code, created.code);
  assert.equal(f.current(created).inviteExpiresAt, 86402000);
  await assert.rejects(
    f.service.join({ code: created.code, nickname: 'old' }),
    { status: 403 },
  );
  await f.service.join({ code: rotated.code, nickname: 'new' });
});

test('member role changes protect owner/AI runner and validate target/role before saving', async () => {
  const f = fixture(),
    created = await f.create(),
    joined = await f.service.join({ code: created.code, nickname: 'team' }),
    memberId = joined.state.memberId;
  const change = (input) =>
    f.queued(created, (p, m) => f.members.setRole(p, m, input));
  await assert.rejects(
    change({ memberId: created.state.memberId, role: 'removed' }),
    /소유자/,
  );
  await assert.rejects(
    change({ memberId: 'missing', role: 'viewer' }),
    /참여자/,
  );
  await assert.rejects(change({ memberId, role: 'owner' }), { status: 400 });
  f.current(created).job = { memberId };
  await assert.rejects(change({ memberId, role: 'viewer' }), /실행자의 역할/);
  f.current(created).job = null;
  f.lockMap(created.state.projectId).set('team.md', {
    memberId,
    token: 'held',
  });
  await change({ memberId, role: 'viewer' });
  assert.equal(f.current(created).members[1].role, 'viewer');
  assert.equal(f.lockMap(created.state.projectId).size, 0);
  await change({ memberId, role: 'removed' });
  assert.throws(() => f.access.authenticate(f.current(created), joined.token), {
    status: 403,
  });
});

test('leave clears only current actor presence/locks and preserves membership and persistence', async () => {
  const f = fixture(),
    created = await f.create(),
    joined = await f.service.join({ code: created.code, nickname: 'team' }),
    p = f.current(created),
    m = f.access.authenticate(p, joined.token),
    before = structuredClone(p),
    count = f.notices.length;
  f.lockMap(p.id).set('team.md', { memberId: m.id, token: 'one' });
  f.lockMap(p.id).set('owner.md', {
    memberId: f.owner(created).id,
    token: 'two',
  });
  assert.deepEqual(f.members.leave(p, m), {});
  assert.deepEqual(p, before);
  assert.equal(f.online.has(m.id), false);
  assert.equal(f.lockMap(p.id).has('team.md'), false);
  assert.equal(f.lockMap(p.id).has('owner.md'), true);
  assert.equal(f.notices.length, count);
  assert.equal(f.access.authenticate(p, joined.token).id, m.id);
});

test('actual SQLite abort preserves membership/recovery keys; retry and reopen retain the new identity', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-members-db-')),
    file = path.join(root, 'sync.sqlite'),
    store = new SyncStore(file),
    db = new DatabaseSync(file);
  t.after(() => {
    db.close();
    store.close();
  });
  const f = fixture({ store }),
    created = await f.create(),
    before = structuredClone(f.current(created));
  db.exec(
    "CREATE TRIGGER fail_members BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT, 'membership-abort'); END;",
  );
  await assert.rejects(
    f.service.join({ code: created.code, nickname: 'team' }),
    /membership-abort/,
  );
  await assert.rejects(
    f.service.recover({
      projectId: created.state.projectId,
      recoveryKey: created.recoveryKey,
    }),
    /membership-abort/,
  );
  assert.deepEqual(store.load(), [before]);
  assert.deepEqual(f.current(created), before);
  db.exec('DROP TRIGGER fail_members');
  const recovered = await f.service.recover({
    projectId: created.state.projectId,
    recoveryKey: created.recoveryKey,
  });
  const reopened = new SyncStore(file);
  try {
    const p = reopened.load()[0];
    assert.equal(f.access.authenticate(p, recovered.token).owner, true);
    assert.equal(p.recoveryHash, f.identity.digest(recovered.recoveryKey));
    assert.deepEqual(p.files, before.files);
  } finally {
    reopened.close();
  }
});
