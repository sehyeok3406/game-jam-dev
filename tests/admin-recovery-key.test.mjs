import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import store from '../tools/internet-host/recovery-key-store.cjs';

const currentKey = 'A'.repeat(43);
const oldKey = 'B'.repeat(43);
const decrypt = (bytes) => bytes.toString();
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'game-jam-key-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('game-jam-key-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const profile = path.join(root, 'profile');
  const host = path.join(root, 'host');
  await mkdir(profile, { recursive: true });
  await mkdir(host, { recursive: true });
  const save = (name, value) =>
    writeFile(path.join(profile, name), JSON.stringify(value));
  async function project(id, key = currentKey) {
    const checkpoint = randomUUID();
    const directory = path.join(host, 'projects', id);
    await mkdir(path.join(directory, 'checkpoints', checkpoint), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, 'head.json'),
      JSON.stringify({ checkpoint }),
    );
    await writeFile(
      path.join(directory, 'checkpoints', checkpoint, 'state.json'),
      JSON.stringify({
        id,
        name: 'Game Jam fixture',
        recoveryHash: createHash('sha256').update(key).digest('hex'),
      }),
    );
  }
  return {
    root,
    profile,
    host,
    save,
    project,
    find: () => store.findRecoveryKeys(profile, host, decrypt),
  };
}

test('finds current session key when the separate backup is expired; reports contain no keys', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.project(id);
  await f.save('admin-recovery.enc', { projectId: id, recoveryKey: oldKey });
  await f.save('collaboration-session.enc', {
    credentials: {
      projectId: id,
      recoveryKey: currentKey,
      token: 'PRIVATE_TOKEN',
    },
  });
  const records = await f.find();
  assert.equal(store.copyValue(records, id), currentKey);
  const report = JSON.stringify(records.map(store.publicInfo));
  assert.ok(!report.includes(currentKey));
  assert.ok(!report.includes(oldKey));
  assert.ok(!JSON.stringify(records).includes('PRIVATE_TOKEN'));
});

test('expired and unrelated host keys are rejected instead of copied', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.project(id);
  await f.save('projects.enc', [
    { credentials: { projectId: id, recoveryKey: oldKey } },
    { credentials: { projectId: randomUUID(), recoveryKey: currentKey } },
  ]);
  const records = await f.find();
  assert.deepEqual(records, []);
  assert.throws(() => store.copyValue(records, id), /PROJECT_NOT_FOUND/);
});

test('reads another source after decryption failure and supports project selection and copy modes', async (t) => {
  const f = await fixture(t);
  const first = randomUUID();
  const second = randomUUID();
  await f.project(first);
  await f.project(second, oldKey);
  await writeFile(path.join(f.profile, 'collaboration-session.enc'), 'broken');
  await f.save('projects.enc', [
    { credentials: { projectId: first, recoveryKey: currentKey } },
    { credentials: { projectId: second, recoveryKey: oldKey } },
  ]);
  const records = await f.find();
  assert.equal(records.length, 2);
  assert.equal(store.copyValue(records, second), oldKey);
  assert.equal(store.copyValue(records, second, 'ProjectId'), second);
  assert.equal(
    store.copyValue(records, first, 'Both'),
    `프로젝트: ${first}\n복구 키: ${currentKey}`,
  );
  assert.throws(
    () => store.copyValue(records, first, 'Invalid'),
    /INVALID_COPY_MODE/,
  );
});

test('rechecks rotated checkpoint keys and does not follow malformed checkpoint paths', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.project(id);
  await f.save('admin-recovery.enc', {
    projectId: id,
    recoveryKey: currentKey,
  });
  assert.equal((await f.find()).length, 1);
  await f.project(id, oldKey);
  assert.equal((await f.find()).length, 0);
  await writeFile(
    path.join(f.host, 'projects', id, 'head.json'),
    JSON.stringify({ checkpoint: '../../../other' }),
  );
  assert.equal((await f.find()).length, 0);
});

test('project ID and current address remain available when the saved key has expired', async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.project(id);
  await f.save('admin-recovery.enc', {
    projectId: id,
    recoveryKey: oldKey,
    serverUrl: 'https://outdated.trycloudflare.com',
  });
  const records = await store.findRecoveryKeys(f.profile, f.host, decrypt, {
    includeUnavailable: true,
  });
  assert.equal(records.length, 1);
  assert.equal(store.publicInfo(records[0]).recoveryKeyAvailable, false);
  const url = 'https://current.trycloudflare.com';
  assert.equal(
    store.copyValue(records, id, 'Info', url),
    `프로젝트 ID: ${id}\n서버 주소: ${url}`,
  );
  assert.equal(store.copyValue(records, id, 'ServerUrl', url), url);
  assert.throws(
    () => store.copyValue(records, id, 'All', url),
    /KEY_NOT_FOUND/,
  );
  assert.throws(
    () => store.copyValue(records, id, 'ServerUrl'),
    /SERVER_URL_UNAVAILABLE/,
  );
});

test('current address comes from runtime on every read and rejects malformed or credential-bearing URLs', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.host, 'runtime.json');
  assert.equal(await store.currentServerUrl(f.host), '');
  const first = 'https://first.trycloudflare.com';
  const second = 'https://second.trycloudflare.com';
  await writeFile(file, '\uFEFF' + JSON.stringify({ publicUrl: first }));
  assert.equal(await store.currentServerUrl(f.host), first);
  await writeFile(file, JSON.stringify({ publicUrl: second }));
  assert.equal(await store.currentServerUrl(f.host), second);
  for (const url of [
    'https://secret@first.trycloudflare.com',
    'http://first.trycloudflare.com',
    'https://first.trycloudflare.com/?secret=key',
  ]) {
    await writeFile(file, JSON.stringify({ publicUrl: url }));
    assert.equal(await store.currentServerUrl(f.host), '');
  }
});

test(
  'Windows CMD copies an OS-encrypted fixture key and preserves live app data',
  { skip: process.platform !== 'win32', timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    const id = randomUUID();
    await f.project(id);
    const serverUrl = 'https://fixture-current.trycloudflare.com';
    await writeFile(
      path.join(f.host, 'runtime.json'),
      JSON.stringify({ publicUrl: serverUrl }),
    );
    const root = fileURLToPath(new URL('../', import.meta.url));
    const run = promisify(execFile);
    const setup = path.join(f.root, 'encrypt.cjs');
    await writeFile(
      setup,
      `
      const {app,safeStorage}=require('electron');
      const fs=require('node:fs'),path=require('node:path');
      const profile=process.argv[2];
      app.setPath('userData',profile); app.setPath('sessionData',profile);
      app.whenReady().then(()=>{
        fs.writeFileSync(path.join(profile,'admin-recovery.enc'),safeStorage.encryptString(JSON.stringify({
          projectId:${JSON.stringify(id)},recoveryKey:${JSON.stringify(currentKey)}
        })));
        app.quit();
      });
    `,
    );
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    await run(
      path.join(root, 'node_modules/electron/dist/electron.exe'),
      [setup, f.profile],
      { windowsHide: true, timeout: 15000, env: environment },
    );
    // Keep existing clipboard contents in memory; test keys never touch the real registry/server.
    const script = path.join(f.root, 'check.ps1');
    await writeFile(
      script,
      `\uFEFF
      $ErrorActionPreference = 'Stop'
      $previousClipboard = Get-Clipboard -Raw
      try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $env:KEY_TEST_TOOL -ProfileDirectory $env:KEY_TEST_PROFILE -StateDirectory $env:KEY_TEST_HOST -NoPrompt
        if ($LASTEXITCODE -ne 0) { throw 'COPY_FAILED' }
        if ((Get-Clipboard -Raw) -cne ('A' * 43)) { throw 'CLIPBOARD_MISMATCH' }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $env:KEY_TEST_TOOL -ProfileDirectory $env:KEY_TEST_PROFILE -StateDirectory $env:KEY_TEST_HOST -Copy ProjectId -NoPrompt
        if ($LASTEXITCODE -ne 0 -or (Get-Clipboard -Raw) -cne $env:KEY_TEST_ID) { throw 'ID_COPY_FAILED' }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $env:KEY_TEST_TOOL -ProfileDirectory $env:KEY_TEST_PROFILE -StateDirectory $env:KEY_TEST_HOST -Copy All -NoPrompt
        $expectedInfo = '프로젝트 ID: ' + $env:KEY_TEST_ID + [char]10 + '서버 주소: ' + $env:KEY_TEST_URL
        if ($LASTEXITCODE -ne 0 -or (Get-Clipboard -Raw) -cne ($expectedInfo + [char]10 + '복구 키: ' + ('A' * 43))) { throw 'ALL_COPY_FAILED' }
        $headPath = Join-Path $env:KEY_TEST_HOST ('projects/' + $env:KEY_TEST_ID + '/head.json')
        $head = Get-Content -LiteralPath $headPath -Raw | ConvertFrom-Json
        $statePath = Join-Path (Split-Path -Parent $headPath) ('checkpoints/' + $head.checkpoint + '/state.json')
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $state.recoveryHash = $env:KEY_TEST_ROTATED_HASH
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $env:KEY_TEST_TOOL -ProfileDirectory $env:KEY_TEST_PROFILE -StateDirectory $env:KEY_TEST_HOST -Copy Info -NoPrompt
        if ($LASTEXITCODE -ne 0 -or (Get-Clipboard -Raw) -cne $expectedInfo) { throw 'INFO_WITHOUT_KEY_FAILED' }
        Write-Output 'Fixture clipboard verified'
      } finally {
        if ([string]::IsNullOrEmpty($previousClipboard)) {
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.Clipboard]::Clear()
        } else { Set-Clipboard -Value $previousClipboard }
      }
    `,
    );
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      {
        windowsHide: true,
        timeout: 30000,
        env: {
          ...environment,
          KEY_TEST_TOOL: path.join(
            root,
            'tools/internet-host/copy-admin-recovery-key.ps1',
          ),
          KEY_TEST_PROFILE: f.profile,
          KEY_TEST_HOST: f.host,
          KEY_TEST_ID: id,
          KEY_TEST_URL: serverUrl,
          KEY_TEST_ROTATED_HASH: createHash('sha256')
            .update(oldKey)
            .digest('hex'),
        },
      },
    );
    assert.match(stdout, /Fixture clipboard verified/);
    assert.ok(!stdout.includes(currentKey));
    assert.ok(stdout.includes(serverUrl));
    assert.ok(stdout.includes(id));
  },
);
