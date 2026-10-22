import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter from '../src/markdown.ts';
import { ProjectQueue } from '../src/server/services/project-queue.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { ApiError } from '../src/server/services/errors.ts';
import { ApiError as HttpApiError } from '../src/server/http/errors.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

test('project queue serializes a project while another project can finish independently', async () => {
  const queue = new ProjectQueue(),
    gate = deferred(),
    started = deferred(),
    order = [];
  const first = queue.run('a', async () => {
    order.push('a1');
    started.resolve();
    await gate.promise;
    order.push('a1:end');
    return 1;
  });
  await started.promise;
  const second = queue.run('a', async () => {
    order.push('a2');
    return 2;
  });
  assert.equal(
    await queue.run('b', async () => {
      order.push('b');
      return 3;
    }),
    3,
  );
  assert.deepEqual(order, ['a1', 'b']);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['a1', 'b', 'a1:end', 'a2']);
  await queue.drain();
});

test('project queue reports sync/async failures to callers and continues retries and drain', async () => {
  const queue = new ProjectQueue(),
    failure = new Error('commit failed');
  await assert.rejects(
    queue.run('a', () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  await assert.rejects(
    queue.run('a', async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(await queue.run('a', async () => 42), 42);
  await queue.drain();
});

test('completion of an earlier queue job cannot release a waiting successor', async () => {
  const queue = new ProjectQueue(),
    gate1 = deferred(),
    gate2 = deferred(),
    secondStarted = deferred(),
    order = [];
  const first = queue.run('a', async () => {
    await gate1.promise;
  });
  const second = queue.run('a', async () => {
    order.push(2);
    secondStarted.resolve();
    await gate2.promise;
  });
  gate1.resolve();
  await first;
  await secondStarted.promise;
  const third = queue.run('a', async () => {
    order.push(3);
  });
  let drained = false;
  const draining = queue.drain().then(() => (drained = true));
  await queue.run('b', async () => {});
  assert.deepEqual(order, [2]);
  assert.equal(drained, false);
  gate2.resolve();
  await Promise.all([second, third, draining]);
  assert.deepEqual(order, [2, 3]);
});

function fixture() {
  const seen = [],
    locks = new Map();
  let now = 100;
  const access = createAccessPolicy({
    matches: (token, hash) => hash === `hash:${token}`,
    now: () => now,
    seen: (...args) => seen.push(args),
    locks: () => locks,
  });
  const member = {
    id: 'editor',
    role: 'editor',
    tokenHash: 'hash:token',
    nickname: '한글',
    owner: false,
  };
  const project = {
    id: 'a',
    members: [member],
    revisions: { 'ideas/a.md': 4 },
    propertyVersions: { 'ideas/a.md': { structure: 2, content: 3 } },
    job: null,
  };
  return { access, seen, locks, member, project, setNow: (v) => (now = v) };
}

test('access authenticates only the current active member and records injected presence time', () => {
  const { access, seen, project, member, setNow } = fixture();
  assert.equal(access.authenticate(project, 'token'), member);
  assert.deepEqual(seen, [['a', 'editor', 100]]);
  setNow(150);
  assert.equal(access.authenticate(project, 'token').nickname, '한글');
  assert.equal(seen.at(-1)[2], 150);
  assert.throws(() => access.authenticate(project, 'wrong'), { status: 403 });
  member.removed = true;
  assert.throws(() => access.authenticate(project, 'token'), { status: 403 });
  assert.equal(seen.length, 2);
  member.removed = false;
  member.tokenHash = 'hash:replacement';
  assert.throws(() => access.authenticate(project, 'token'), { status: 403 });
  assert.equal(access.authenticate(project, 'replacement'), member);
  assert.equal(ApiError, HttpApiError);
});

test('admin/editable preserve viewer denial and legacy broad AI lock while scoped AI locks remain available', () => {
  const { access, member, project } = fixture();
  assert.throws(() => access.admin(member), { status: 403 });
  member.role = 'admin';
  access.admin(member);
  member.role = 'viewer';
  assert.throws(() => access.editable(project, member), { status: 403 });
  member.role = 'editor';
  access.editable(project, member);
  project.job = {};
  assert.throws(() => access.editable(project, member), { status: 409 });
  project.job = { fileLock: { paths: ['other'] } };
  access.editable(project, member);
});

const raw = (data = {}, body = '원문\n') =>
  matter.stringify(body, {
    id: 'a',
    title: '메모',
    x: 10,
    y: 20,
    width: 340,
    height: 300,
    ...data,
  });

test('unscoped edits check current revision, foreign content locks and existing AI task permissions', () => {
  const { access, member, project, locks } = fixture(),
    before = { 'ideas/a.md': raw() },
    after = { 'ideas/a.md': raw({}, '수정\n') };
  assert.throws(
    () =>
      access.assertBases(project, before, after, { 'ideas/a.md': 3 }, member),
    /최신/,
  );
  locks.set('ideas/a.md', { memberId: 'other' });
  assert.throws(
    () => access.assertBases(project, before, after, project.revisions, member),
    /편집 중/,
  );
  locks.set('ideas/a.md', { memberId: member.id });
  access.assertBases(project, before, after, project.revisions, member);
  const task = '.ai/tasks/a.md';
  project.revisions[task] = 1;
  assert.throws(
    () =>
      access.assertBases(
        project,
        { [task]: raw() },
        { [task]: raw({}, '수정') },
        { [task]: 1 },
        member,
      ),
    { status: 403 },
  );
  member.role = 'admin';
  access.assertBases(
    project,
    { [task]: raw() },
    { [task]: raw({}, '수정') },
    { [task]: 1 },
    member,
  );
});

const scoped = (channel = 'documents:save') => ({
  id: 'request',
  channel,
  input: {},
  revisions: {},
  propertySyncVersion: 1,
  objects: { 'ideas/a.md': 'a' },
  properties: { 'ideas/a.md': { structure: 2, content: 3 } },
});

test('scoped content checks object identity, structure and content versions despite unrelated file revision changes', () => {
  const { access, member, project } = fixture(),
    before = { 'ideas/a.md': raw() },
    after = { 'ideas/a.md': raw({}, '새 본문') };
  const command = scoped();
  access.assertBases(project, before, after, {}, member, command);
  command.objects['ideas/a.md'] = 'old';
  assert.throws(
    () => access.assertBases(project, before, after, {}, member, command),
    /객체가 변경/,
  );
  command.objects['ideas/a.md'] = 'a';
  project.propertyVersions['ideas/a.md'].structure = 5;
  assert.throws(
    () => access.assertBases(project, before, after, {}, member, command),
    /소속이나 생성/,
  );
  project.propertyVersions['ideas/a.md'].structure = 2;
  project.propertyVersions['ideas/a.md'].content = 8;
  assert.throws(
    () => access.assertBases(project, before, after, {}, member, command),
    /내용이 변경/,
  );
});

test('metadata-only allowance bypasses foreign content locks without allowing body or structural deletion', () => {
  const { access, member, project, locks } = fixture(),
    before = { 'ideas/a.md': raw() },
    color = { 'ideas/a.md': raw({ background_color: 'green' }) };
  locks.set('ideas/a.md', { memberId: 'other' });
  assert.throws(
    () => access.assertBases(project, before, color, project.revisions, member),
    /편집 중/,
  );
  project.propertySync = true;
  access.assertBases(project, before, color, project.revisions, member);
  access.assertBases(
    project,
    before,
    color,
    {},
    member,
    scoped('documents:set-color'),
  );
  assert.throws(
    () =>
      access.assertBases(
        project,
        before,
        { 'ideas/a.md': raw({}, '금지') },
        project.revisions,
        member,
      ),
    /편집 중/,
  );
  assert.throws(
    () => access.assertBases(project, before, {}, project.revisions, member),
    /편집 중/,
  );
});

test('queued access reads replacement project state and rejects revoked membership after a predecessor commits', async () => {
  const { access, project } = fixture(),
    queue = new ProjectQueue(),
    gate = deferred(),
    started = deferred();
  let current = project;
  access.authenticate(current, 'token'); // Pre-ingress authentication succeeds.
  const revoke = queue.run('a', async () => {
    started.resolve();
    await gate.promise;
    current = structuredClone(current);
    current.members[0].removed = true;
  });
  await started.promise;
  const save = queue.run('a', async () =>
    access.authenticate(current, 'token'),
  );
  const rejected = assert.rejects(save, { status: 403 });
  gate.resolve();
  await Promise.all([revoke, rejected]);
  await queue.drain();
});

test('queued checks re-read revision/locks after waiting and rejection does not block a corrected retry', async () => {
  const { access, project, member, locks } = fixture(),
    queue = new ProjectQueue(),
    gate = deferred();
  const before = { 'ideas/a.md': raw() },
    after = { 'ideas/a.md': raw({}, '수정') };
  const change = queue.run('a', async () => {
    await gate.promise;
    project.revisions['ideas/a.md'] = 5;
    locks.set('ideas/a.md', { memberId: 'other' });
  });
  const stale = queue.run('a', async () =>
    access.assertBases(project, before, after, { 'ideas/a.md': 4 }, member),
  );
  const rejected = assert.rejects(stale, /최신/);
  gate.resolve();
  await Promise.all([change, rejected]);
  await assert.rejects(
    queue.run('a', async () =>
      access.assertBases(project, before, after, project.revisions, member),
    ),
    /편집 중/,
  );
  locks.clear();
  await queue.run('a', async () =>
    access.assertBases(project, before, after, project.revisions, member),
  );
  await queue.drain();
});
