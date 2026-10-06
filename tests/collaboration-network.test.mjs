import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { CollaborationClient } from '../src/collaboration-client.ts';

test('proxy HTML, rate limits, connection errors and valid history arrays have separate diagnostics', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/html') {
      response.writeHead(502, { 'Content-Type': 'text/html' });
      response.end('<html>Bad gateway</html>');
    } else if (request.url === '/rate') {
      response.writeHead(429);
      response.end('Too many requests');
    } else if (request.url === '/array') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('[]');
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('null');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const [endpoint, code] of [
    ['/html', 'GC-NET-003'],
    ['/rate', 'GC-NET-004'],
    ['/null', 'GC-NET-003'],
  ]) {
    await assert.rejects(
      CollaborationClient.fetch(url, endpoint, {}, 'private-token'),
      (error) => {
        assert.equal(error.code, code);
        assert.ok(!JSON.stringify(error).includes('private-token'));
        return true;
      },
    );
  }
  assert.deepEqual(await CollaborationClient.fetch(url, '/array', {}), []);
  await assert.rejects(
    CollaborationClient.fetch('http://127.0.0.1:1', '/state', {}),
    { code: 'GC-NET-002' },
  );
});

test('polling backs off while disconnected and resumes after successful refresh', async (t) => {
  const client = new CollaborationClient(
    {
      serverUrl: 'http://127.0.0.1:4318',
      projectId: '00000000-0000-0000-0000-000000000000',
      token: 'fixture',
    },
    () => {},
  );
  t.after(() => client.stop());
  client.request = async () => {
    throw new TypeError('offline');
  };
  await assert.rejects(client.refresh(), /offline/);
  const firstDelay = client.nextPollAt - Date.now();
  assert.ok(firstDelay > 1000);
  await assert.rejects(client.refresh(), /offline/);
  assert.ok(client.nextPollAt - Date.now() > firstDelay);
  client.request = async () => ({
    state: {
      active: true,
      connected: true,
      members: [],
      locks: [],
      revision: 1,
    },
    revisions: {},
  });
  await client.refresh();
  assert.equal(client.state.connected, true);
  assert.equal(client.nextPollAt, 0);
  assert.equal(client.failures, 0);
});

test('response body timeout is still a timeout, not a JSON parsing error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    status: 200,
    ok: true,
    json: async () => {
      throw new DOMException('timeout', 'TimeoutError');
    },
  }));
  await assert.rejects(
    CollaborationClient.fetch('http://127.0.0.1:4318', '/state', {}),
    {
      code: 'GC-NET-001',
    },
  );
});
