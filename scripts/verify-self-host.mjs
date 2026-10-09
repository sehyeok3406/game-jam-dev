// Explicit online QA: synthetic data in a separate temporary host, never the live user server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { SelfHostService } from '../src/features/self-host/service.ts';
import { ProjectLibrary } from '../src/project-library.ts';
import { CollaborationClient } from '../src/collaboration-client.ts';
import { parseConnectionInfo } from '../src/connection-info.ts';
import { buildSelfHostRuntime } from './build-self-host-runtime.mjs';

if (process.platform !== 'win32') throw new Error('Windows QA only');
await buildSelfHostRuntime();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-host-online-'));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const library = new ProjectLibrary(path.join(root, 'registry'), {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(text),
  decryptString: (bytes) => bytes.toString(),
});
await library.load();
const service = new SelfHostService({
  directory: path.join(root, 'host'),
  runtimeSource: path.resolve('out/self-host-runtime'),
  library,
  port,
  activeProject: () => undefined,
  changed: () => {},
  appVersion: 'qa',
  appPath: path.resolve('.'),
});
const reports = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  reports.push(name);
  console.log(`PASS: ${name}`);
};
const clients = [];
const previousPath = process.env.PATH;
let stopped = false;
try {
  await service.init();
  // Prove the installed flow does not find node.exe or cloudflared.exe through PATH.
  process.env.PATH = path.join(process.env.SystemRoot, 'System32');
  let state = await service.run('check');
  check(
    'bundled runtime is available without Node.js on PATH',
    state.checks?.nodeReady === true,
  );
  state = await service.run('prepare');
  check(
    'official Cloudflare download passes checksum verification',
    state.checks?.cloudflaredReady === true,
  );
  state = await service.run('start');
  check(
    `dedicated server and public route start (${state.code || 'ready'})`,
    state.stage === 'ready',
  );
  const firstUrl = state.publicUrl;
  const key = await service.creationKey(firstUrl);
  const created = await CollaborationClient.create(
    firstUrl,
    key,
    'QA host',
    'Self-host QA',
    {
      'project.md':
        '---\nid: qa-project\ntitle: QA\ntype: project\n---\n# Synthetic QA project\n',
    },
  );
  await library.rememberShared(
    created.credentials,
    'Self-host QA',
    'admin',
    null,
  );
  const joined = await CollaborationClient.join(
    firstUrl,
    created.result.code,
    'QA participant',
  );
  const owner = new CollaborationClient(created.credentials, () => {});
  const participant = new CollaborationClient(joined.credentials, () => {});
  clients.push(owner, participant);
  owner.accept(created.result);
  participant.accept(joined.result);
  await participant.command('documents:create-idea', { x: 0, y: 0 });
  await owner.refresh();
  check(
    'independent client joins and shared edits cross the public route',
    Object.keys(owner.files).some((name) => name.startsWith('ideas/')),
  );
  state = await service.run('start');
  check(
    'repeated start reuses the existing public address',
    state.stage === 'ready' && state.publicUrl === firstUrl,
  );
  const runtimeState = path.join(
    root,
    'host/projects',
    created.credentials.projectId,
    'runtime.json',
  );
  const savedRuntime = await fs.readFile(runtimeState);
  await fs.writeFile(
    runtimeState,
    JSON.stringify({ job: { id: 'qa-only-blocker' } }),
  );
  state = await service.run('stop');
  check('active AI marker refuses termination', state.code === 'GC-HOST-AI');
  await fs.writeFile(runtimeState, savedRuntime);
  state = await service.run('restart');
  check(
    `explicit restart returns a healthy public route (${state.code || 'ready'})`,
    state.stage === 'ready',
  );
  const saved = library.get(`shared:${created.credentials.projectId}`);
  check(
    'host registry updates the address and preserves the admin session',
    saved.serverUrl === state.publicUrl &&
      saved.credentials.token === created.credentials.token,
  );
  const info = parseConnectionInfo(await service.info(saved.id, 'connection'));
  check(
    'reconnect payload contains a project and URL without credentials',
    info.projectId === created.credentials.projectId &&
      !JSON.stringify(info).includes(created.credentials.token),
  );
  participant.credentials.serverUrl = info.serverUrl;
  await participant.refresh();
  check(
    'participant reconnects after restart with its original membership',
    participant.state.connected &&
      participant.state.memberId === joined.result.state.memberId,
  );
  await service.setCloseBehavior('background');
  await service.init();
  check(
    'background choice survives reload',
    service.state.closeBehavior === 'background',
  );
  await fs.mkdir('out/qa', { recursive: true });
  await fs.writeFile(
    'out/qa/self-host-online.json',
    JSON.stringify(
      {
        passed: reports,
        scope:
          'independent clients on this PC through a real public tunnel; no physical second PC',
      },
      null,
      2,
    ),
  );
} finally {
  clients.forEach((client) => client.stop());
  process.env.PATH = previousPath;
  const state = await service.run('stop');
  stopped = state.stage === 'off';
  if (stopped) {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('gamejam-host-online-'));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  } else
    console.error(
      `QA cleanup needs attention: ${state.code}; isolated data at ${root}`,
    );
}
assert.ok(stopped, 'owned test processes must be stopped');
