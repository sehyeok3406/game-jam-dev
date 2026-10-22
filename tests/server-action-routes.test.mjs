import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createHttpHandler } from '../src/server/http/router.ts';
import { ApiError } from '../src/server/services/errors.ts';
import {
  projectsRoute,
  projectsActionRoute,
} from '../src/server/http/routes/projects.ts';
import { projectActionRoute } from '../src/server/http/routes/project-actions.ts';
import { commandsRoute } from '../src/server/http/routes/commands.ts';
import { membersRoute } from '../src/server/http/routes/members.ts';
import { historyRoute } from '../src/server/http/routes/history.ts';
import { approvalsRoute } from '../src/server/http/routes/approvals.ts';
import { aiRoute } from '../src/server/http/routes/ai.ts';
import { multiplayerRoute } from '../src/server/http/routes/multiplayer.ts';
async function fixture(t) {
  const p = {
      id: randomUUID(),
      revision: 1,
      files: { 'project.md': '한글' },
      revisions: {},
      history: [],
    },
    calls = [],
    limits = [],
    records = [];
  const authenticate = (project, token) => {
    calls.push('auth');
    if (token !== 'valid') throw new ApiError('auth', 403);
    return { id: 'real', role: 'admin' };
  };
  const limit = (...args) => limits.push(args);
  const ports = {
    get: (id) => (id === p.id ? p : undefined),
    unavailable: () => {
      throw new ApiError('missing', 404);
    },
    authenticate,
    limit,
    run: async (id, token, action, input) => {
      calls.push({ id, token, action, input });
      if (action === 'unknown') throw new ApiError('unsupported', 404);
      if (action === 'history-read') return '과거 내용';
      return {
        state: { revision: p.revision },
        files: p.files,
        revisions: p.revisions,
      };
    },
  };
  const server = http.createServer(
    createHttpHandler(
      [
        multiplayerRoute({
          get: ports.get,
          authenticate,
          assertActive: () => {},
          limit,
          control: (id, token, input) => ({
            id,
            tokenMatches: token === 'valid',
            action: input.action,
          }),
          record: (error, code, context) => {
            records.push(context);
            return { code, message: '거부' };
          },
        }),
        projectsRoute({
          limit,
          validKey: (key) => key === 'key',
          create: async (input) => ({ created: input }),
          join: async (input) => ({ joined: input }),
          recover: async (input) => ({ recovered: input }),
        }),
        projectsActionRoute(ports),
        commandsRoute(ports),
        membersRoute(ports),
        historyRoute(ports),
        approvalsRoute(ports),
        aiRoute(ports),
        projectActionRoute(() => true, ports),
      ],
      async () => {
        throw new ApiError('fallback', 404);
      },
    ),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const url = 'http://127.0.0.1:' + server.address().port;
  const request = (route, input = {}, headers = {}) =>
    fetch(url + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid',
        ...headers,
      },
      body: typeof input === 'string' ? input : JSON.stringify(input),
    });
  return { p, calls, limits, records, request, url };
}

test('HTTP namespace routes preserve every project action and unknown actions still enter the common dispatcher', async (t) => {
  const f = await fixture(t);
  for (const action of [
    'state',
    'lock',
    'unlock',
    'command',
    'offline-sync',
    'invite',
    'role',
    'leave',
    'rename',
    'lifecycle',
    'trash-status',
    'history',
    'history-read',
    'restore',
    'requests-list',
    'requests-start',
    'ai-progress',
  ]) {
    const response = await f.request('/projects/' + f.p.id + '/' + action, {
      memberId: 'spoof',
      role: 'viewer',
    });
    assert.equal(response.status, 200, action);
    await response.json();
    assert.equal(f.calls.at(-1).action, action);
    assert.equal(f.calls.at(-1).token, 'valid');
  }
  const denied = await f.request('/projects/' + f.p.id + '/unknown');
  assert.equal(denied.status, 404);
  assert.equal(f.calls.at(-1).action, 'unknown');
});
test('HTTP creation key and project authentication reject before malformed body parsing and do not trust proxy headers', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request('/projects', '{', { 'X-Server-Key': 'bad' })).status,
    403,
  );
  assert.equal(
    (await f.request('/projects', '{', { 'X-Server-Key': 'key' })).status,
    400,
  );
  assert.equal(
    (
      await f.request('/projects/' + f.p.id + '/state', '{', {
        Authorization: 'Bearer invalid',
        'X-Forwarded-For': 'spoofed',
      })
    ).status,
    403,
  );
  assert.ok(f.limits.every(([identity]) => identity !== 'spoofed'));
  assert.equal(f.calls.filter((c) => typeof c === 'object').length, 0);
});
test('HTTP project transport preserves origin guard, scalar history reads and negotiated empty delta', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request('/join', {}, { Origin: 'https://other.test' })).status,
    403,
  );
  assert.equal((await fetch(f.url + '/projects')).status, 404);
  assert.equal(
    await (await f.request('/projects/' + f.p.id + '/history-read')).json(),
    '과거 내용',
  );
  const value = await (
    await f.request('/projects/' + f.p.id + '/state', {
      deltaVersion: 1,
      knownRevision: 1,
    })
  ).json();
  assert.deepEqual(value.delta, { from: 1, changes: {} });
  assert.equal(value.files, undefined);
  assert.equal((await f.request('/recover', { id: 'i' })).status, 200);
});
test('HTTP multiplayer keeps its diagnostic failure envelope and authenticated control separate from project actions', async (t) => {
  const f = await fixture(t);
  const result = await (
    await f.request('/projects/' + f.p.id + '/play', { action: 'list' })
  ).json();
  assert.equal(result.tokenMatches, true);
  assert.equal(result.action, 'list');
  assert.equal(f.calls.filter((x) => typeof x === 'object').length, 0);
  const denied = await f.request('/projects/' + f.p.id + '/play', '{', {
    Authorization: 'Bearer private-token',
  });
  assert.equal(denied.status, 403);
  const failure = await denied.json();
  assert.equal(failure.code, 'GC-MP-020');
  assert.equal(f.records[0].side, 'server');
  assert.ok(!JSON.stringify(f.records).includes('private-token'));
});
