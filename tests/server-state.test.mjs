import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectEnvelope } from '../src/server/services/project-envelope.ts';
import { projectResponse } from '../src/server/services/project-response.ts';
import { createStateService } from '../src/server/services/state-service.ts';
import { createAccessPolicy } from '../src/server/services/access-policy.ts';
import { assertAiFilesUnlocked } from '../src/ai-file-lock.ts';
function fixture() {
  let clock = 1000,
    tokens = 0;
  const locks = new Map(),
    notices = [],
    p = {
      id: 'p',
      name: '팀',
      revision: 4,
      files: {
        'ideas/a.md': '원본',
        'sections/s.md': '섹션',
        '.ai/tasks/t.md': '작업',
      },
      revisions: { 'ideas/a.md': 2 },
      propertyVersions: {},
      authorship: {},
      history: [],
      members: [
        { id: 'admin', role: 'admin', nickname: '관리자', tokenHash: 'secret' },
        { id: 'editor', role: 'editor', nickname: '팀원' },
        { id: 'viewer', role: 'viewer', nickname: '뷰어' },
        { id: 'removed', role: 'editor', removed: true },
      ],
      job: null,
      lastRun: null,
      inviteExpiresAt: 8000,
      aiQueue: [
        { taskId: 't', status: 'queued', baseline: { private: '원본' } },
      ],
    };
  const policy = createAccessPolicy({
    matches: () => true,
    now: () => clock,
    locks: () => locks,
    seen: () => {},
  });
  const envelope = (p, m) =>
    projectEnvelope(p, m, {
      version: 'test',
      now: () => clock,
      online: (id, member) => (member === 'admin' ? clock : undefined),
      locks: () => locks,
    });
  const service = createStateService({
    ...policy,
    locks: () => locks,
    envelope,
    secret: () => `token-${++tokens}`,
    now: () => clock,
    announce: (id) => notices.push(id),
    assertUnlocked: (p, relative) =>
      assertAiFilesUnlocked(p.job?.fileLock, [relative]),
  });
  return {
    p,
    locks,
    notices,
    envelope,
    service,
    time: (n) => (clock = n),
    run: (action, input = {}, role = 'editor') =>
      service.execute(
        p,
        p.members.find((m) => m.role === role),
        action,
        input,
      ),
  };
}

test('project envelope preserves capability/role/presence fields without token hashes or queued baselines', () => {
  const f = fixture();
  f.time(20000);
  const result = f.envelope(f.p, f.p.members[0]);
  assert.equal(result.state.serverVersion, 'test');
  assert.equal(result.state.inviteExpiresAt, 8000);
  assert.equal(result.state.members.length, 3);
  assert.equal(result.state.members[0].online, true);
  assert.equal(result.state.members[1].online, false);
  assert.equal(result.state.aiQueue[0].baseline, undefined);
  assert.equal(result.state.members[0].tokenHash, undefined);
  assert.equal(
    f.envelope(f.p, f.p.members[1]).state.inviteExpiresAt,
    undefined,
  );
  assert.ok(f.p.aiQueue[0].baseline);
});

test('state keeps full/known-revision/metadata-only response precedence and does not announce', () => {
  const f = fixture();
  assert.equal(f.run('state').files, f.p.files);
  const known = f.run('state', { knownRevision: 4 });
  assert.equal(known.files, undefined);
  assert.equal(known.revisions, undefined);
  assert.ok(known.properties);
  const metadata = f.run('state', { metadataOnly: true, knownRevision: 4 });
  assert.deepEqual(Object.keys(metadata), ['state']);
  assert.deepEqual(f.notices, []);
});

test('state renews only matching owned locks and ignores malformed renewal entries', () => {
  const f = fixture();
  f.locks.set('ideas/a.md', {
    memberId: 'editor',
    token: 'owned',
    expiresAt: 5,
  });
  f.locks.set('ideas/b.md', {
    memberId: 'admin',
    token: 'other',
    expiresAt: 5,
  });
  f.run('state', {
    renewLocks: [
      null,
      1,
      'bad',
      {},
      { relativePath: 'ideas/a.md', token: 'wrong' },
      { relativePath: 'ideas/b.md', token: 'other' },
    ],
  });
  assert.equal(f.locks.get('ideas/a.md').expiresAt, 5);
  f.run('state', {
    renewLocks: [{ relativePath: 'ideas/a.md', token: 'owned' }],
  });
  assert.equal(f.locks.get('ideas/a.md').expiresAt, 31000);
  assert.equal(f.locks.get('ideas/b.md').expiresAt, 5);
});

test('lock acquisition/reentry preserves token, renews lease and publishes metadata without modifying files', () => {
  const f = fixture(),
    before = structuredClone(f.p),
    first = f.run('lock', { relativePath: 'ideas/a.md' });
  assert.equal(first.lockToken, 'token-1');
  f.time(2000);
  assert.equal(
    f.run('lock', { relativePath: 'ideas/a.md' }).lockToken,
    first.lockToken,
  );
  assert.equal(f.locks.get('ideas/a.md').expiresAt, 32000);
  assert.deepEqual(f.p, before);
  assert.equal(f.notices.length, 2);
});

test('lock rejects viewer, task editor, missing/section documents, another owner and frozen AI input', () => {
  const f = fixture();
  assert.throws(() => f.run('lock', { relativePath: 'ideas/a.md' }, 'viewer'), {
    status: 403,
  });
  assert.throws(() => f.run('lock', { relativePath: '.ai/tasks/t.md' }), {
    status: 403,
  });
  for (const relativePath of [
    'ideas/missing.md',
    'sections/s.md',
    '../private',
  ])
    assert.throws(() => f.run('lock', { relativePath }));
  f.locks.set('ideas/a.md', { memberId: 'admin', token: 'held' });
  assert.throws(() => f.run('lock', { relativePath: 'ideas/a.md' }), /편집 중/);
  f.locks.clear();
  f.p.job = { fileLock: { paths: ['ideas/a.md'], folders: [] } };
  assert.throws(() => f.run('lock', { relativePath: 'ideas/a.md' }));
  assert.deepEqual(f.notices, []);
});

test('unlock requires owner/token while preserving legacy metadata announcement for no-op attempts', () => {
  const f = fixture();
  f.run('lock', { relativePath: 'ideas/a.md' });
  f.run('unlock', { relativePath: 'ideas/a.md', token: 'wrong' });
  assert.ok(f.locks.size);
  f.run('unlock', { relativePath: 'ideas/a.md', token: 'token-1' }, 'admin');
  assert.ok(f.locks.size);
  f.run('unlock', { relativePath: 'ideas/a.md', token: 'token-1' });
  assert.equal(f.locks.size, 0);
  assert.equal(f.notices.length, 4);
});

test('delta response uses current committed values, includes deletes/revisions/authorship, and leaves full result untouched', () => {
  const f = fixture(),
    full = f.envelope(f.p, f.p.members[0]);
  f.p.files = { 'ideas/a.md': '최신' };
  f.p.history = [
    {
      entry: {
        revision: 3,
        files: [
          { relativePath: 'ideas/a.md' },
          { relativePath: 'ideas/deleted.md' },
        ],
      },
      before: {},
      after: {},
    },
    {
      entry: { revision: 4, files: [{ relativePath: 'ideas/a.md' }] },
      before: {},
      after: {},
    },
  ];
  const before = structuredClone(full),
    result = projectResponse(f.p, { deltaVersion: 1, knownRevision: 2 }, full);
  assert.deepEqual(result.delta.changes, {
    'ideas/a.md': '최신',
    'ideas/deleted.md': null,
  });
  assert.equal(result.files, undefined);
  assert.deepEqual(result.authorship, {
    'ideas/a.md': null,
    'ideas/deleted.md': null,
  });
  assert.deepEqual(full, before);
});

test('delta response retains full fallback for gaps, future/invalid revision, absent state or opt-out', () => {
  const f = fixture(),
    full = f.envelope(f.p, f.p.members[0]);
  f.p.history = [{ entry: { revision: 4, files: [] } }];
  for (const input of [
    { deltaVersion: 1, knownRevision: 2 },
    { deltaVersion: 1, knownRevision: 5 },
    { deltaVersion: 1, knownRevision: 1.2 },
    { deltaVersion: 0, knownRevision: 4 },
    { metadataOnly: true, deltaVersion: 1, knownRevision: 4 },
  ])
    assert.equal(projectResponse(f.p, input, full), full);
  assert.equal(
    projectResponse(f.p, { deltaVersion: 1, knownRevision: 4 }, null),
    null,
  );
  assert.equal(
    projectResponse(undefined, { deltaVersion: 1, knownRevision: 4 }, full),
    full,
  );
});

test('delta metadata-only/known-revision no-change negotiation retains an empty delta when requested', () => {
  const f = fixture(),
    full = f.envelope(f.p, f.p.members[0]);
  const result = projectResponse(
    f.p,
    { deltaVersion: 1, knownRevision: 4 },
    full,
  );
  assert.deepEqual(result.delta, { from: 4, changes: {} });
  assert.deepEqual(result.revisions, {});
  assert.deepEqual(result.properties, {});
  assert.equal(result.state, full.state);
});
