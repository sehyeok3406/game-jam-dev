import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCollaborationTransport } from '../src/adapters/http/collaboration-transport.ts';
const transport = (response) =>
  createCollaborationTransport({
    fetch: async () => response,
    signal: () => new AbortController().signal,
  });
test('HTTP transport preserves POST, redirect rejection, auth/key headers, payload and injected timeout signal', async () => {
  let captured;
  const signal = new AbortController().signal;
  const send = createCollaborationTransport({
    signal: () => signal,
    fetch: async (...args) => {
      captured = args;
      return Response.json({ state: { revision: 1 } });
    },
  });
  assert.equal(
    (
      await send(
        'https://example.test',
        '/projects',
        { name: '한글' },
        'token',
        'key',
      )
    ).state.revision,
    1,
  );
  assert.equal(captured[0], 'https://example.test/projects');
  const options = captured[1];
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer token');
  assert.equal(options.headers['X-Server-Key'], 'key');
  assert.equal(options.body, JSON.stringify({ name: '한글' }));
  assert.equal(options.signal, signal);
});
test('HTTP transport distinguishes timeout/network failures without exposing credentials', async () => {
  for (const [error, code] of [
    [
      Object.assign(Error('private-token'), { name: 'TimeoutError' }),
      'GC-NET-001',
    ],
    [new TypeError('private-token'), 'GC-NET-002'],
  ]) {
    const send = createCollaborationTransport({
      fetch: async () => {
        throw error;
      },
      signal: () => new AbortController().signal,
    });
    await assert.rejects(
      send('https://example.test', '/state', {}, 'private-token'),
      (e) => e.code === code && !e.message.includes('private-token'),
    );
  }
});
test('HTTP transport maps 429 before body decoding and retains malformed/5xx response errors', async () => {
  await assert.rejects(
    transport(new Response('bad', { status: 429 }))('x', '/state', {}),
    { code: 'GC-NET-004' },
  );
  await assert.rejects(
    transport(new Response('bad', { status: 200 }))('x', '/state', {}),
    { code: 'GC-NET-003' },
  );
  await assert.rejects(
    transport(Response.json({ error: 'private internal' }, { status: 503 }))(
      'x',
      '/state',
      {},
    ),
    (e) => e.code === 'GC-NET-003' && !e.message.includes('private internal'),
  );
});
test('HTTP history-read permits string/null while ordinary successful endpoints still require objects', async () => {
  for (const value of [null, '과거 한글']) {
    assert.equal(
      await transport(Response.json(value))(
        'x',
        '/projects/p/history-read',
        {},
      ),
      value,
    );
    await assert.rejects(
      transport(Response.json(value))('x', '/projects/p/state', {}),
      { code: 'GC-NET-003' },
    );
  }
  assert.deepEqual(
    await transport(Response.json([]))('x', '/projects/p/history', {}),
    [],
  );
});
test('HTTP domain failures retain original status/code/failure/lifecycle contract', async () => {
  const error = {
    error: '삭제됨',
    code: 'PROJECT_TRASHED',
    failure: { message: '실패' },
    lifecycle: { projectId: 'p', status: 'trashed', version: 2 },
  };
  await assert.rejects(
    transport(Response.json(error, { status: 410 }))(
      'x',
      '/projects/p/state',
      {},
    ),
    (e) =>
      e.status === 410 &&
      e.code === 'PROJECT_TRASHED' &&
      e.lifecycle.version === 2 &&
      e.failure.message === '실패',
  );
});
