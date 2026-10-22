import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import http from 'node:http';
import { body, bearerToken } from '../src/server/http/request.ts';
import { ApiError } from '../src/server/http/errors.ts';
import { reply } from '../src/server/http/response.ts';
import { createHttpHandler } from '../src/server/http/router.ts';
import { healthRoute } from '../src/server/http/routes/health.ts';
import { eventsRoute } from '../src/server/http/routes/events.ts';
import { ProjectEvents } from '../src/server/services/project-events.ts';
import { serverCapabilities } from '../src/server/capabilities.ts';

class Response extends EventEmitter {
  chunks = [];
  writableNeedDrain = false;
  ended = false;
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }
  write(chunk) {
    this.chunks.push(chunk);
  }
  end(chunk) {
    if (chunk !== undefined) this.chunks.push(chunk);
    this.ended = true;
    this.emit('close');
  }
}
const request = (method, url, headers = {}) => ({ method, url, headers });
const id = '00000000-0000-0000-0000-000000000001';

test('HTTP body joins split UTF-8 bytes and retains empty-object and byte-limit semantics', async () => {
  const raw = Buffer.from(JSON.stringify({ text: '한글 초안 🎮' }));
  assert.deepEqual(
    await body(Readable.from([...raw].map((x) => Buffer.from([x])))),
    { text: '한글 초안 🎮' },
  );
  assert.deepEqual(await body(Readable.from([])), {});
  for (const value of ['[]', 'null', 'false', '1', '"text"', '{']) {
    await assert.rejects(body(Readable.from([value])), {
      status: 400,
      message: '요청 형식이 올바르지 않습니다.',
    });
  }
  // Use padding to exercise the original limit without changing production limits.
  const prefix = Buffer.from('{"x":"'),
    suffix = Buffer.from('"}');
  const padding = Buffer.alloc(22000000 - prefix.length - suffix.length, 32);
  assert.equal(
    (await body(Readable.from([prefix, padding, suffix]))).x.length,
    padding.length,
  );
  await assert.rejects(
    body(Readable.from([prefix, padding, suffix, Buffer.from(' ')])),
    { status: 413 },
  );
});

test('router rejects Origin before dispatch, preserves health wire fields and lets unmatched requests fall through', async () => {
  let fallbacks = 0;
  const handler = createHttpHandler(
    [healthRoute('fixture')],
    async (_q, r, u) => {
      fallbacks++;
      reply(r, 404, { path: u.pathname });
    },
  );
  const response = new Response();
  await handler(request('GET', '/health'), response);
  assert.deepEqual(JSON.parse(response.chunks.join('')), {
    name: 'Game Canvas Collaboration',
    ...serverCapabilities(),
    protocol: 1,
    version: 'fixture',
  });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  const blocked = new Response();
  await handler(
    request('GET', '/health', { origin: 'https://example.test' }),
    blocked,
  );
  assert.equal(blocked.status, 403);
  const other = new Response();
  await handler(request('POST', '/health'), other);
  assert.equal(other.status, 404);
  assert.equal(fallbacks, 1);
});

test('HTTP error translation preserves lifecycle status/code and structured failure', async () => {
  const error = new ApiError('삭제됨', 410);
  error.code = 'PROJECT_PURGED';
  error.lifecycle = { projectId: id, status: 'purged', version: 7 };
  const handler = createHttpHandler([], async () => {
    throw error;
  });
  const response = new Response();
  await handler(request('POST', '/projects'), response);
  const value = JSON.parse(response.chunks.join(''));
  assert.equal(response.status, 410);
  assert.equal(value.code, 'PROJECT_PURGED');
  assert.deepEqual(value.lifecycle, error.lifecycle);
  assert.ok(value.failure.code);
  assert.ok(value.error.includes('삭제됨'));
  const bad = new Response();
  await createHttpHandler([], async () => {
    throw new Error('invalid');
  })(request('GET', '/unknown'), bad);
  assert.equal(bad.status, 400);
});

test('event route authenticates header actor and limits before opening; payload/query never grant identity', async () => {
  const calls = [];
  const route = eventsRoute(
    {
      authenticate: (project, token) => {
        calls.push([project, token]);
        return { id: 'real-member' };
      },
      limit: (...args) => calls.push(args),
    },
    { open: (...args) => calls.push(args) },
  );
  const response = new Response();
  const url = new URL(
    `http://localhost/projects/${id}/events?memberId=owner&role=admin`,
  );
  assert.equal(
    await route(
      request('GET', url.pathname, { authorization: 'Bearer original' }),
      response,
      url,
    ),
    true,
  );
  assert.deepEqual(calls.slice(0, 2), [
    [id, 'original'],
    [`${id}:real-member`, 'stream', 30],
  ]);
  assert.deepEqual(calls[2], [id, 'real-member', response]);
  assert.equal(
    await route(request('POST', url.pathname), response, url),
    false,
  );
  assert.equal(
    bearerToken(request('GET', '/', { authorization: 'bearer lower' })),
    'bearer lower',
  );
  assert.equal(bearerToken(request('GET', '/')), '');
  const denied = eventsRoute(
    {
      authenticate: () => {
        throw new ApiError('denied', 403);
      },
      limit: () => assert.fail(),
    },
    { open: () => assert.fail() },
  );
  assert.throws(() => denied(request('GET', url.pathname), response, url), {
    status: 403,
  });
});

function eventFixture(t) {
  let revision = 1,
    active = true;
  const events = new ProjectEvents({
    summary: () => ({ revision }),
    memberActive: () => active,
  });
  t.after(() => events.close());
  return {
    events,
    setRevision: (v) => (revision = v),
    revoke: () => (active = false),
  };
}

test('SSE keeps initial/lobby names, per-project revisions and fresh committed summary', (t) => {
  const { events, setRevision } = eventFixture(t);
  const a = new Response(),
    b = new Response();
  events.open(id, 'a', a);
  events.open('other', 'b', b);
  assert.equal(a.headers['Content-Type'], 'text/event-stream');
  assert.equal(a.chunks[0], 'data: {}\n\n');
  const initial = JSON.parse(a.chunks[1].split('data: ')[1]);
  assert.equal(initial.revision, 0);
  events.announcePlayLobby(id);
  const lobby = JSON.parse(a.chunks.at(-1).split('data: ')[1]);
  assert.equal(lobby.serverEpoch, initial.serverEpoch);
  assert.equal(lobby.revision, 1);
  assert.equal(b.chunks.length, 2);
  setRevision(9);
  events.announce(id);
  assert.equal(a.chunks.at(-1), 'data: {"revision":9}\n\n');
});

test('SSE heartbeat checks current membership and releases revoked/disconnected timers', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { events, revoke } = eventFixture(t);
  const a = new Response();
  events.open(id, 'a', a);
  t.mock.timers.tick(10000);
  assert.equal(a.chunks.at(-1), ': heartbeat\n\n');
  revoke();
  t.mock.timers.tick(10000);
  assert.equal(a.ended, true);
  const length = a.chunks.length;
  t.mock.timers.tick(30000);
  events.announce(id);
  assert.equal(a.chunks.length, length);
});

test('SSE connection limit, backpressure and purge release connections without changing other projects', (t) => {
  const { events } = eventFixture(t);
  const clients = Array.from({ length: 80 }, () => new Response());
  for (const r of clients) events.open(id, 'a', r);
  assert.throws(() => events.open(id, 'a', new Response()), { status: 429 });
  clients[0].end();
  const replacement = new Response();
  events.open(id, 'a', replacement);
  replacement.writableNeedDrain = true;
  events.announce(id);
  assert.equal(replacement.ended, true);
  const other = new Response();
  events.open('other', 'b', other);
  events.purge(id);
  assert.equal(
    clients[1].chunks.at(-1),
    'data: {"lifecycle":{"status":"purged"}}\n\n',
  );
  assert.ok(clients.every((x) => x.ended));
  assert.equal(other.ended, false);
  events.close();
  assert.equal(other.ended, true);
  events.close();
});

test('composed HTTP handler runs on a real socket with original health, JSON and error responses', async (t) => {
  const handler = createHttpHandler([healthRoute('socket')], async (q, r) => {
    if (q.method !== 'POST')
      throw new ApiError('지원하지 않는 요청입니다.', 404);
    reply(r, 200, await body(q));
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(url + '/health')).json()).version, 'socket');
  const posted = await fetch(url + '/echo', {
    method: 'POST',
    body: JSON.stringify({ text: '한글' }),
  });
  assert.deepEqual(await posted.json(), { text: '한글' });
  assert.equal(
    (await fetch(url + '/echo', { method: 'POST', body: '[]' })).status,
    400,
  );
  assert.equal((await fetch(url + '/unknown')).status, 404);
  assert.equal(
    (
      await fetch(url + '/health', {
        headers: { Origin: 'https://example.test' },
      })
    ).status,
    403,
  );
});
