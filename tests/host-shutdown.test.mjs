import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectAiState } from '../tools/internet-host/inspect-ai-state.cjs';
const run = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamejam-stop-'));
  const projects = path.join(root, 'host/projects');
  await fs.mkdir(projects, { recursive: true });
  for (const name of ['.project-trash', '.project-lifecycle']) {
    await fs.mkdir(path.join(projects, name));
    await fs.writeFile(
      path.join(projects, name, 'private.txt'),
      'PRIVATE_DO_NOT_PRINT',
    );
  }
  let db;
  t.after(async () => {
    db?.close();
    assert.equal(path.dirname(root), os.tmpdir());
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  return {
    root,
    projects,
    database() {
      db = new DatabaseSync(path.join(projects, 'sync.sqlite'));
      db.exec(
        'PRAGMA journal_mode=WAL; PRAGMA user_version=1; CREATE TABLE projects(id TEXT PRIMARY KEY,value TEXT NOT NULL)',
      );
      return db;
    },
  };
}
test('shutdown reads authoritative SQLite WAL and ignores stale legacy and management folders', async (t) => {
  const f = await fixture(t),
    db = f.database(),
    id = randomUUID();
  const legacy = path.join(f.projects, id);
  await fs.mkdir(legacy);
  await fs.writeFile(path.join(legacy, 'head.json'), 'PRIVATE_BROKEN_LEGACY');
  const put = (state) =>
    db
      .prepare('INSERT OR REPLACE INTO projects VALUES (?,?)')
      .run(id, JSON.stringify(state));
  put({ job: null });
  assert.equal(inspectAiState(f.projects), false);
  put({ job: { memberId: 'fixture' } });
  assert.equal(inspectAiState(f.projects), true);
  for (const status of ['queued', 'starting', 'running', 'validating']) {
    put({ job: null, aiQueue: [{ status }] });
    assert.equal(inspectAiState(f.projects), true);
  }
  put({
    job: null,
    aiQueue: [
      { status: 'completed' },
      { status: 'failed' },
      { status: 'cancelled' },
    ],
  });
  assert.equal(inspectAiState(f.projects), false);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
});
test('legacy shutdown inspects current runtime state and known management folders safely', async (t) => {
  const f = await fixture(t),
    folder = path.join(f.projects, randomUUID()),
    checkpoint = randomUUID();
  await fs.mkdir(path.join(folder, 'checkpoints', checkpoint), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(folder, 'head.json'),
    JSON.stringify({ checkpoint }),
  );
  await fs.writeFile(
    path.join(folder, 'checkpoints', checkpoint, 'state.json'),
    JSON.stringify({ job: {} }),
  );
  assert.equal(inspectAiState(f.projects), true);
  await fs.writeFile(
    path.join(folder, 'runtime.json'),
    JSON.stringify({ job: null }),
  );
  assert.equal(inspectAiState(f.projects), false);
  await fs.mkdir(path.join(f.projects, 'unexpected'));
  assert.throws(() => inspectAiState(f.projects));
});
test('invalid SQLite state fails closed without printing project content or creating a missing database', async (t) => {
  const f = await fixture(t),
    db = f.database();
  db.prepare('INSERT INTO projects VALUES (?,?)').run(
    randomUUID(),
    'PRIVATE_INVALID_JSON',
  );
  const r = await run(process.execPath, [
    '--no-warnings',
    'tools/internet-host/inspect-ai-state.cjs',
    f.projects,
  ]).catch((e) => e);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, 'unavailable');
  assert.equal(r.stderr, '');
  db.exec('DELETE FROM projects; PRAGMA user_version=999');
  assert.throws(() => inspectAiState(f.projects));
  const empty = path.join(f.root, 'absent');
  assert.equal(inspectAiState(empty), false);
  await assert.rejects(fs.stat(empty), { code: 'ENOENT' });
});
test(
  'Windows bridge refuses busy WAL state then stops only owned processes with management folders present',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const f = await fixture(t),
      db = f.database(),
      id = randomUUID();
    const runtime = path.join(f.root, 'runtime');
    await fs.mkdir(runtime);
    for (const [from, to] of [
      ['src/features/self-host/bridge.ps1', 'bridge.ps1'],
      ...['host.ps1', 'diagnostics.ps1', 'inspect-ai-state.cjs'].map((n) => [
        'tools/internet-host/' + n,
        n,
      ]),
    ])
      await fs.copyFile(from, path.join(runtime, to));
    await fs.copyFile(process.execPath, path.join(runtime, 'node.exe'));
    const serverFile = path.join(runtime, 'server.mjs'),
      tunnelFile = path.join(runtime, 'tunnel.mjs');
    await fs.writeFile(
      serverFile,
      `import http from 'node:http';const s=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({name:'Game Canvas Collaboration',protocol:1}));});s.listen(0,'127.0.0.1',()=>process.send(s.address().port));`,
    );
    await fs.writeFile(
      tunnelFile,
      `setInterval(()=>{},1000);process.send('ready');`,
    );
    const start = async (file) => {
      const child = spawn(process.execPath, [file], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      t.after(() => {
        if (child.exitCode === null) child.kill();
      });
      const ready = await new Promise((r, j) => {
        child.once('message', r);
        child.once('error', j);
        child.once('exit', () => j(Error('fixture exited')));
      });
      return { child, ready };
    };
    const server = await start(serverFile),
      tunnel = await start(tunnelFile),
      unrelated = await start(tunnelFile);
    const state = path.dirname(f.projects),
      key = path.join(state, 'creation-key.clixml');
    await fs.writeFile(key, 'encrypted-fixture-sentinel');
    const recordFile = path.join(f.root, 'record.ps1');
    await fs.writeFile(
      recordFile,
      `param([int]$ServerId,[int]$TunnelId,[string]$ServerMarker,[string]$TunnelMarker,[int]$Port,[string]$OutFile)
  function Record([int]$ProcessNumber,[string]$Marker){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessNumber";return @{pid=$ProcessNumber;createdAt=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;marker=$Marker}}
  @{server=(Record $ServerId $ServerMarker);tunnel=(Record $TunnelId $TunnelMarker);localUrl="http://127.0.0.1:$Port";publicUrl=''} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutFile -Encoding UTF8`,
    );
    const ps = path.join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    await run(
      ps,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        recordFile,
        '-ServerId',
        String(server.child.pid),
        '-TunnelId',
        String(tunnel.child.pid),
        '-ServerMarker',
        serverFile,
        '-TunnelMarker',
        tunnelFile,
        '-Port',
        String(server.ready),
        '-OutFile',
        path.join(state, 'runtime.json'),
      ],
      { windowsHide: true, timeout: 20000 },
    );
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(runtime, 'bridge.ps1'),
      '-Action',
      'Stop',
      '-StateDirectory',
      state,
      '-RuntimeDirectory',
      runtime,
      '-Port',
      String(server.ready),
    ];
    const stop = () =>
      run(ps, args, { windowsHide: true, timeout: 30000 }).catch((e) => e);
    db.prepare('INSERT INTO projects VALUES (?,?)').run(
      id,
      JSON.stringify({ job: null, aiQueue: [{ status: 'running' }] }),
    );
    let r = await stop();
    assert.equal(JSON.parse(r.stdout).code, 'GC-HOST-AI');
    assert.equal(server.child.exitCode, null);
    assert.equal(tunnel.child.exitCode, null);
    const failureFile = path.join(f.root, 'restart-failure.json');
    const restart = await run(
      ps,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(runtime, 'host.ps1'),
        '-Action',
        'RestartServer',
        '-StateDirectory',
        state,
        '-NodePath',
        path.join(runtime, 'node.exe'),
        '-ServerEntry',
        serverFile,
        '-FailureReport',
        failureFile,
      ],
      { windowsHide: true, timeout: 30000 },
    ).catch((e) => e);
    assert.equal(restart.code, 1);
    assert.equal(
      JSON.parse(
        (await fs.readFile(failureFile, 'utf8')).replace(/^\uFEFF/, ''),
      ).code,
      'GC-HOST-AI',
    );
    assert.equal(server.child.exitCode, null);
    assert.equal(tunnel.child.exitCode, null);
    db.prepare('UPDATE projects SET value=?').run('PRIVATE_BAD_STATE');
    r = await stop();
    assert.equal(JSON.parse(r.stdout).code, 'GC-HOST-016');
    assert.equal(r.stdout.includes('PRIVATE_BAD_STATE'), false);
    assert.equal(server.child.exitCode, null);
    db.prepare('UPDATE projects SET value=?').run(
      JSON.stringify({ job: null, aiQueue: [] }),
    );
    r = await stop();
    assert.equal(JSON.parse(r.stdout).status, 'stopped');
    await new Promise((r) => setTimeout(r, 150));
    assert.notEqual(server.child.exitCode, null);
    assert.notEqual(tunnel.child.exitCode, null);
    assert.equal(unrelated.child.exitCode, null);
    assert.equal(await fs.readFile(key, 'utf8'), 'encrypted-fixture-sentinel');
    assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 1);
    assert.equal(
      await fs.readFile(
        path.join(f.projects, '.project-trash/private.txt'),
        'utf8',
      ),
      'PRIVATE_DO_NOT_PRINT',
    );
  },
);
