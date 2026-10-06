import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const run = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const windowsOnly = { skip: process.platform !== 'win32', timeout: 60_000 };
const powershell = (script, args = []) =>
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(project, script),
      ...args,
    ],
    {
      windowsHide: true,
      timeout: 45_000,
    },
  );

test(
  'host diagnostic decisions protect existing processes and private data',
  windowsOnly,
  async () => {
    const { stdout } = await powershell('tests/internet-host-diagnostics.ps1', [
      '-ProjectDirectory',
      project,
    ]);
    assert.match(stdout, /Passed \d+ host diagnostic assertions/);
  },
);

test(
  'one-click launcher reports invalid metadata without leaking its contents',
  windowsOnly,
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'game-canvas-host-invalid-'),
    );
    const privateText = 'PRIVATE_JSON_MUST_NOT_APPEAR';
    await writeFile(
      path.join(directory, 'runtime.json'),
      `{broken:${privateText}`,
    );
    const error = await powershell('tools/internet-host/connect.ps1', [
      '-StateDirectory',
      directory,
      '-CheckOnly',
      '-NoPrompt',
      '-Json',
    ]).catch((value) => value);
    assert.equal(error.code, 1);
    assert.equal(error.stderr, '');
    const report = JSON.parse(error.stdout);
    assert.equal(report.code, 'GC-HOST-005');
    assert.equal(error.stdout.includes(privateText), false);
    const saved = await readFile(
      path.join(directory, 'connection-report.json'),
      'utf8',
    );
    assert.equal(saved.includes(privateText), false);
    assert.equal(JSON.parse(saved.replace(/^\uFEFF/, '')).code, report.code);
    assert.equal(
      await readFile(path.join(directory, 'runtime.json'), 'utf8'),
      `{broken:${privateText}`,
    );
  },
);

test(
  'one-click launcher refuses a healthy but unmanaged server without stopping it',
  windowsOnly,
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'game-canvas-host-port-'),
    );
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ name: 'Game Canvas Collaboration', protocol: 1 }),
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const error = await powershell('tools/internet-host/connect.ps1', [
        '-StateDirectory',
        directory,
        '-Port',
        String(port),
        '-CheckOnly',
        '-NoPrompt',
        '-Json',
      ]).catch((value) => value);
      assert.equal(error.code, 1);
      assert.equal(error.stderr, '');
      const report = JSON.parse(error.stdout);
      assert.equal(report.code, 'GC-HOST-006');
      assert.ok(report.listenerPids.includes(process.pid));
      assert.equal(report.checks.localHealthy, true);
      assert.equal(
        (await fetch(`http://127.0.0.1:${port}/health`)).status,
        200,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  'legacy starter exposes sanitized startup phase codes',
  windowsOnly,
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'game-canvas-host-stage-'),
    );
    const failure = path.join(directory, 'failure.json');
    const privateText = 'PRIVATE_FAILURE_MUST_NOT_APPEAR';
    await writeFile(
      path.join(directory, 'runtime.json'),
      `{broken:${privateText}`,
    );
    const error = await powershell('tools/internet-host/host.ps1', [
      '-Action',
      'Start',
      '-StateDirectory',
      directory,
      '-FailureReport',
      failure,
    ]).catch((value) => value);
    assert.equal(error.code, 1);
    assert.equal(error.stderr, '');
    assert.equal(error.stdout.includes(privateText), false);
    const saved = await readFile(failure, 'utf8');
    assert.equal(JSON.parse(saved.replace(/^\uFEFF/, '')).code, 'GC-HOST-005');
    assert.equal(saved.includes(privateText), false);
  },
);

test(
  'failed new tunnel startup cleans up only its isolated server',
  windowsOnly,
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'game-canvas-host-start-'),
    );
    const reserve = createServer();
    await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
    const { port } = reserve.address();
    await new Promise((resolve) => reserve.close(resolve));
    // Use a real executable which rejects cloudflared's arguments. Never create
    // a public tunnel, replace the live host, or use the user's saved data/key.
    const fakeTunnel = path.join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const error = await powershell('tools/internet-host/connect.ps1', [
      '-StateDirectory',
      directory,
      '-Port',
      String(port),
      '-CloudflaredPath',
      fakeTunnel,
      '-NoPrompt',
      '-Json',
    ]).catch((value) => value);
    assert.equal(error.code, 1);
    assert.equal(error.stderr, '');
    const report = JSON.parse(error.stdout);
    assert.equal(report.code, 'GC-HOST-012');
    assert.equal(report.port, port);
    assert.equal(report.checks.localHealthy, false);
    assert.equal(report.checks.serverOwnership, 'absent');
    assert.equal(report.checks.tunnelOwnership, 'absent');
    assert.equal(report.publicUrl, '');
    assert.ok(!report.listenerPids.includes(report.serverPid));
  },
);
