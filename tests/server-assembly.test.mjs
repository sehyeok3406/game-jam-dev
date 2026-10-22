import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { createServerContext } from '../src/server/context.ts';
import { createRateLimit } from '../src/server/services/rate-limit.ts';
import { createProjectRequest } from '../src/server/services/project-request.ts';
import {
  assertLifecycleVersion,
  assertProjectCapabilities,
} from '../src/server/services/project-capabilities.ts';
import { startServerLifetime } from '../src/server/lifetime.ts';
import { ApiError } from '../src/server/services/errors.ts';
import { DOCUMENT_STATUSES_PATH } from '../src/document-statuses.ts';
const defer = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
function fixture() {
  const ctx = createServerContext(() => 1000),
    calls = [];
  const p = {
    id: 'p',
    files: {},
    members: [{ id: 'real', role: 'editor' }],
    revision: 1,
  };
  ctx.projects.set('p', p);
  const ports = {
    get: (id) => ctx.projects.get(id),
    unavailable: () => {
      throw new ApiError('missing', 404);
    },
    authenticate: (p, token) => {
      calls.push('auth:' + token);
      const member = p.members.find((m) => !m.removed);
      if (!member) throw new ApiError('revoked', 403);
      return member;
    },
    queue: (id, work) => ctx.projectQueue.run(id, work),
    assertActive: (p) => {
      calls.push('active');
      if (p.lifecycle?.status === 'trashed') throw new ApiError('trashed', 410);
    },
    admin: (m) => {
      calls.push('admin');
      if (m.role !== 'admin') throw new ApiError('admin', 403);
    },
    expire: async (p) => {
      calls.push('expire');
      return p;
    },
    lifecycle: (p, m) => {
      calls.push('lifecycle');
      return m.id;
    },
    dispatch: (p, m) => {
      calls.push('dispatch');
      return { actor: m.id, revision: p.revision };
    },
  };
  return { ctx, p, calls, run: createProjectRequest(ports) };
}

test('server context owns isolated maps and expires locks only after the existing strict deadline', () => {
  let time = 1000;
  const a = createServerContext(() => time),
    b = createServerContext(() => time);
  a.projectLocks('p').set('a', { token: 't', memberId: 'm', expiresAt: 1000 });
  assert.equal(b.projectLocks('p').size, 0);
  assert.equal(a.projectLocks('p').size, 1);
  time++;
  assert.equal(a.projectLocks('p').size, 0);
  a.online.set('p', new Map([['m', time]]));
  assert.equal(b.online.size, 0);
});
test('rate limits retain category/identity separation and reset at the exact minute deadline', () => {
  let now = 1000;
  const limit = createRateLimit(() => now);
  limit('m', 'write', 2);
  limit('m', 'write', 2);
  assert.throws(() => limit('m', 'write', 2), { status: 429 });
  assert.doesNotThrow(() => limit('m', 'stream', 1));
  assert.doesNotThrow(() => limit('other', 'write', 1));
  now = 61000;
  assert.doesNotThrow(() => limit('m', 'write', 2));
});
test('queued project requests reacquire current identity and reject revoked members after the prior queued operation', async () => {
  const f = fixture(),
    gate = defer();
  const prior = f.ctx.projectQueue.run('p', async () => {
    await gate.promise;
    f.ctx.projects.set('p', {
      ...f.p,
      members: [{ id: 'real', removed: true }],
    });
  });
  const pending = assert.rejects(
    f.run('p', 'token', 'state', { role: 'admin', memberId: 'spoof' }),
    { status: 403 },
  );
  gate.resolve();
  await Promise.all([prior, pending]);
  assert.deepEqual(f.calls, ['auth:token']);
});
test('project request preserves current actor, lifecycle/expiry/capability ordering and body spoof rejection', async () => {
  const f = fixture(),
    result = await f.run('p', 'token', 'state', {
      role: 'admin',
      memberId: 'spoof',
    });
  assert.equal(result.actor, 'real');
  assert.deepEqual(f.calls, ['auth:token', 'active', 'expire', 'dispatch']);
  f.calls.length = 0;
  f.p.files[DOCUMENT_STATUSES_PATH] = 'present';
  await assert.rejects(f.run('p', 'token', 'command', {}), /문서 상태/);
  assert.deepEqual(f.calls, ['auth:token', 'active', 'expire']);
});
test('lifecycle routes remain reachable before active/version/AI gates, while stale mutating requests stop before expiry', async () => {
  const f = fixture();
  f.p.lifecycle = { status: 'trashed', version: 2 };
  assert.equal(await f.run('p', 't', 'trash-restore', {}), 'real');
  assert.deepEqual(f.calls, ['auth:t', 'lifecycle']);
  f.p.lifecycle.status = 'active';
  f.calls.length = 0;
  await assert.rejects(f.run('p', 't', 'command', { lifecycleVersion: 1 }), {
    code: 'PROJECT_LIFECYCLE_CHANGED',
  });
  assert.deepEqual(f.calls, ['auth:t', 'active']);
});
test('capability checks retain state/history exemptions, admin precedence and legacy sync-client negotiation', () => {
  const p = { files: {}, lifecycle: { version: 2 }, propertySync: true },
    member = { role: 'editor' };
  assert.doesNotThrow(() => assertLifecycleVersion(p, 'state', {}));
  assert.throws(() => assertLifecycleVersion(p, 'command', {}), {
    code: 'PROJECT_LIFECYCLE_CHANGED',
  });
  const admin = () => {
    throw new ApiError('admin', 403);
  };
  assert.throws(
    () => assertProjectCapabilities(p, member, 'restore', {}, admin),
    { status: 403 },
  );
  assert.throws(
    () => assertProjectCapabilities(p, member, 'command', {}, () => {}),
    /속성별/,
  );
  assert.doesNotThrow(() =>
    assertProjectCapabilities(
      p,
      member,
      'command',
      { syncClientVersion: 1 },
      () => {},
    ),
  );
  assert.doesNotThrow(() =>
    assertProjectCapabilities(p, member, 'history', {}, () => {}),
  );
});
test('server lifetime exposes the same server/port and waits for drain/checkpoint before closing the store', async () => {
  const calls = [],
    gate = defer(),
    entered = defer(),
    server = http.createServer((req, res) => res.end('ok'));
  const running = await startServerLifetime(server, '127.0.0.1', 0, {
    maintain: async () => {},
    exportDirty: () => {},
    closeMultiplayer: () => calls.push('ws'),
    closeEvents: () => calls.push('sse'),
    flushDiagnostics: async () => calls.push('diagnostics'),
    drain: async () => {
      assert.equal(server.listening, false);
      calls.push('drain');
      entered.resolve();
      await gate.promise;
    },
    waitCheckpoints: async () => calls.push('wait-checkpoints'),
    checkpointDirty: async () => calls.push('checkpoint-dirty'),
    closeStore: () => calls.push('store'),
  });
  assert.equal(running.server, server);
  assert.ok(running.port > 0);
  assert.equal(server.requestTimeout, 15000);
  assert.equal(server.headersTimeout, 10000);
  const closing = running.close();
  await entered.promise;
  assert.equal(calls.includes('store'), false);
  gate.resolve();
  await closing;
  assert.deepEqual(calls, [
    'ws',
    'sse',
    'diagnostics',
    'drain',
    'wait-checkpoints',
    'checkpoint-dirty',
    'store',
  ]);
});

test('server shutdown attempts all cleanup and releases the store even when diagnostics or checkpoint export fails', async () => {
  const calls = [],
    server = http.createServer((req, res) => res.end());
  const running = await startServerLifetime(server, '127.0.0.1', 0, {
    maintain: async () => {},
    exportDirty: () => {},
    closeMultiplayer: () => calls.push('multiplayer'),
    closeEvents: () => calls.push('events'),
    flushDiagnostics: async () => {
      calls.push('diagnostics');
      throw Error('diagnostic failure');
    },
    drain: async () => {
      calls.push('drain');
    },
    waitCheckpoints: async () => {
      calls.push('wait');
    },
    checkpointDirty: async () => {
      calls.push('checkpoint');
      throw Error('checkpoint failure');
    },
    closeStore: () => {
      calls.push('store');
    },
  });
  const first = running.close(),
    second = running.close();
  assert.equal(first, second);
  await assert.rejects(first, /diagnostic failure/);
  assert.deepEqual(calls, [
    'multiplayer',
    'events',
    'diagnostics',
    'drain',
    'wait',
    'checkpoint',
    'store',
  ]);
  assert.equal(server.listening, false);
});
