import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { webSharedProject } from '../src/web-viewer-source.ts';

async function setup(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'gamejam-web-source-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projectId = randomUUID();
  const token = 'test-project-token';
  const calls = [];
  async function server(name, returnedId = projectId) {
    const instance = http.createServer((request, response) => {
      calls.push(name);
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      assert.equal(request.url, `/projects/${projectId}/state`);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          state: {
            projectId: returnedId,
            revision: name === 'local' ? 214 : 163,
          },
          files: { 'docs/versions/v8/UFO-core-loop.md': '# UFO' },
        }),
      );
    });
    await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => instance.close(resolve)));
    return `http://127.0.0.1:${instance.address().port}`;
  }
  const publicUrl = await server('public');
  const credentials = { serverUrl: publicUrl, projectId, token };
  const hosted = async (localUrl) => {
    await fs.mkdir(path.join(directory, 'projects', projectId), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(directory, 'projects', projectId, 'head.json'),
      JSON.stringify({ checkpoint: randomUUID() }),
    );
    await fs.writeFile(
      path.join(directory, 'runtime.json'),
      '\uFEFF' + JSON.stringify({ localUrl }),
    );
  };
  return { directory, projectId, credentials, calls, server, hosted };
}

test('PC-hosted publisher reads current AI documents without depending on the public tunnel', async (t) => {
  const s = await setup(t);
  await s.hosted(await s.server('local'));
  const result = await webSharedProject(s.credentials, s.directory);
  assert.equal(result.state.revision, 214);
  assert.equal(result.files['docs/versions/v8/UFO-core-loop.md'], '# UFO');
  assert.deepEqual(s.calls, ['local']);
});
test('projects hosted elsewhere never send credentials to the local server', async (t) => {
  const s = await setup(t);
  await fs.writeFile(
    path.join(s.directory, 'runtime.json'),
    JSON.stringify({ localUrl: await s.server('local') }),
  );
  await webSharedProject(s.credentials, s.directory);
  assert.deepEqual(s.calls, ['public']);
});
test('wrong project identity at the loopback server falls back to the saved server', async (t) => {
  const s = await setup(t);
  await s.hosted(await s.server('local', randomUUID()));
  const result = await webSharedProject(s.credentials, s.directory);
  assert.equal(result.state.projectId, s.projectId);
  assert.deepEqual(s.calls, ['local', 'public']);
});
test('a non-loopback runtime address is ignored', async (t) => {
  const s = await setup(t);
  await s.hosted('https://untrusted.invalid');
  await webSharedProject(s.credentials, s.directory);
  assert.deepEqual(s.calls, ['public']);
});

test('administrator publisher reads the current owned host checkpoint without rotating sessions or exposing server secrets', async (t) => {
  const s = await setup(t);
  const checkpoint = randomUUID();
  const root = path.join(s.directory, 'projects', s.projectId);
  await fs.mkdir(path.join(root, 'checkpoints', checkpoint), {
    recursive: true,
  });
  const head = JSON.stringify({ checkpoint });
  await fs.writeFile(path.join(root, 'head.json'), head);
  await fs.writeFile(
    path.join(root, 'checkpoints', checkpoint, 'state.json'),
    JSON.stringify({
      id: s.projectId,
      name: 'UFO',
      revision: 214,
      files: { 'docs/versions/v8/UFO-core-loop.md': '# UFO current document' },
      recoveryHash: 'PRIVATE_RECOVERY_HASH',
      members: [{ tokenHash: 'PRIVATE_MEMBER_HASH' }],
    }),
  );
  const result = await webSharedProject(s.credentials, s.directory, true);
  assert.equal(result.state.revision, 214);
  assert.equal(
    result.files['docs/versions/v8/UFO-core-loop.md'],
    '# UFO current document',
  );
  assert.deepEqual(s.calls, []);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  assert.equal(await fs.readFile(path.join(root, 'head.json'), 'utf8'), head);
  // Participants keep using the authenticated API rather than the admin file source.
  const participant = await webSharedProject(s.credentials, s.directory, false);
  assert.equal(participant.state.revision, 163);
  assert.deepEqual(s.calls, ['public']);
});
