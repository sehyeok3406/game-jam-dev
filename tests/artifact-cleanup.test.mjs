import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  applyCleanupPlan,
  blockingProcesses,
  createCleanupPlan,
  planId,
  safeArtifactPath,
} from '../scripts/artifact-cleanup.mjs';

const exec = promisify(execFile);
const future = () => Date.now() + 10 * 86_400_000;
const idle = async () => {};

test('process guard blocks active tests, packaged apps, and unreadable workers', () => {
  const root = path.resolve('workspace');
  const processList = [
    {
      ProcessId: 1,
      ParentProcessId: 2,
      Name: 'node.exe',
      CommandLine: 'node scripts/cleanup-artifacts.mjs',
    },
    {
      ProcessId: 2,
      ParentProcessId: 0,
      Name: 'node.exe',
      CommandLine: 'npm run artifacts:apply',
    },
    {
      ProcessId: 3,
      Name: 'electron.exe',
      CommandLine: 'electron tests/sync-ui.electron.mjs',
    },
    {
      ProcessId: 4,
      Name: 'Game Canvas.exe',
      ExecutablePath: path.join(root, 'out/app/Game Canvas.exe'),
      CommandLine: 'Game Canvas.exe',
    },
    { ProcessId: 5, Name: 'node.exe', CommandLine: null },
    {
      ProcessId: 6,
      Name: 'Game Canvas.exe',
      ExecutablePath: path.resolve('installed/app/Game Canvas.exe'),
      CommandLine: 'Game Canvas.exe',
    },
  ];
  assert.deepEqual(
    blockingProcesses(root, processList, 1).map((item) => item.ProcessId),
    [3, 4, 5],
  );
  assert.throws(() => blockingProcesses(root, [], 1), /inventory/);
});

async function fixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-cleanup-')),
  );
  await exec('git', ['init', '-q', root], { windowsHide: true });
  const write = async (relative, value = 'fixture') => {
    await fs.mkdir(path.dirname(path.join(root, relative)), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, relative), value);
  };
  await fs.mkdir(path.join(root, 'out/artifact-cleanup'), { recursive: true });
  t.after(async () => {
    // Only the mkdtemp tree owned by this test is removed.
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('artifact-cleanup-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, write };
}

test('plans only known stale caches and preserves runtime, releases, data and unknown output', async (t) => {
  const { root, write } = await fixture(t);
  const cache = 'out/sync-ui/profile/Cache';
  await write(`${cache}/data`, 'old-cache');
  await write('out/sync-ui/profile/Local Storage/leveldb/data');
  await write('out/sync-ui/profile/Network/Cookies');
  await write('out/unknown/profile/Cache/data');
  await write('out/self-host-runtime/node.exe');
  await write('out/releases/v0.1.0/installer.exe');
  await write('out/release-source-v0.1.0/.git/HEAD');
  await write('out/manual-game.html');
  const plan = await createCleanupPlan(root, { now: future() });
  assert.deepEqual(
    plan.candidates.map((item) => item.path),
    [cache],
  );
  assert.equal(plan.totalBytes, 9);
  assert.equal(
    await fs.readFile(path.join(root, cache, 'data'), 'utf8'),
    'old-cache',
  );
  const fresh = await createCleanupPlan(root);
  assert.equal(fresh.candidates.length, 0);
  assert.match(fresh.deferred[0].reason, /5 days/);
});

test('cache becomes a candidate at five days, with younger caches retained', async (t) => {
  const { root, write } = await fixture(t);
  const cache = 'out/sync-ui/profile/Cache';
  await write(`${cache}/data`, 'cache');
  const stats = await Promise.all(
    [cache, `${cache}/data`].map((relative) =>
      fs.lstat(path.join(root, relative)),
    ),
  );
  const latest = Math.max(
    ...stats.flatMap((stat) => [stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs]),
  );
  const cutoff = latest + 5 * 86_400_000;
  const young = await createCleanupPlan(root, { now: cutoff - 1 });
  assert.equal(young.candidates.length, 0);
  const eligible = await createCleanupPlan(root, { now: cutoff });
  assert.equal(eligible.minAgeDays, 5);
  assert.deepEqual(
    eligible.candidates.map((item) => item.path),
    [cache],
  );
});

test('pins, tracked files and nested repositories cannot be cleaned', async (t) => {
  const { root, write } = await fixture(t);
  await write('out/sync-ui/vite-cache/.cleanup-keep');
  await write('out/sync-ui/vite-cache/data');
  await write('out/sync-ui/profile/Cache/tracked');
  await exec('git', ['add', 'out/sync-ui/profile/Cache/tracked'], {
    cwd: root,
    windowsHide: true,
  });
  await write('out/sync-ui/profile/Code Cache/.git/HEAD');
  const plan = await createCleanupPlan(root, { now: future() });
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.deferred.length, 3);
});

test('rejects traversal, junctions, and links within a candidate', async (t) => {
  const { root, write } = await fixture(t);
  await write('out/preserved/data', 'keep');
  await fs.mkdir(path.join(root, 'out/sync-ui/profile'), { recursive: true });
  await fs.symlink(
    path.join(root, 'out/preserved'),
    path.join(root, 'out/sync-ui/profile/Cache'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await fs.mkdir(path.join(root, 'out/sync-ui/vite-cache'), {
    recursive: true,
  });
  await fs.symlink(
    path.join(root, 'out/preserved'),
    path.join(root, 'out/sync-ui/vite-cache/link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const relative of [
    'out/../src',
    '../out',
    'out\\sync-ui',
    'out/C:/temp',
  ])
    await assert.rejects(safeArtifactPath(root, relative), /Unsafe/);
  await assert.rejects(
    safeArtifactPath(root, 'out/sync-ui/profile/Cache'),
    /Link/,
  );
  const plan = await createCleanupPlan(root, { now: future() });
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.deferred.length, 2);
});

test('requires exact approval, fresh plan, unchanged contents and an idle workspace', async (t) => {
  const { root, write } = await fixture(t);
  await write('out/sync-ui/vite-cache/data', 'before');
  const now = future();
  const plan = await createCleanupPlan(root, { now });
  await assert.rejects(
    applyCleanupPlan(root, plan, 'wrong', { now, assertIdle: idle }),
    /identity/,
  );
  await assert.rejects(
    applyCleanupPlan(root, plan, plan.id, {
      now: now + 86_400_001,
      assertIdle: idle,
    }),
    /expired/,
  );
  await assert.rejects(
    applyCleanupPlan(root, plan, plan.id, {
      now,
      assertIdle: async () => {
        throw Error('busy');
      },
    }),
    /busy/,
  );
  await write('out/sync-ui/vite-cache/data', 'after!');
  await assert.rejects(
    applyCleanupPlan(root, plan, plan.id, { now, assertIdle: idle }),
    /changed/,
  );
  assert.equal(
    await fs.readFile(path.join(root, 'out/sync-ui/vite-cache/data'), 'utf8'),
    'after!',
  );
});

test('forged protected targets and changed later candidates stop the whole preflight', async (t) => {
  const { root, write } = await fixture(t);
  await write('out/sync-ui/vite-cache/data');
  await write('out/sync-ui/profile/Cache/data');
  await write('out/self-host-runtime/node.exe');
  const now = future();
  const plan = await createCleanupPlan(root, { now });
  const forged = structuredClone(plan);
  forged.candidates[0].path = 'out/self-host-runtime';
  forged.id = planId(forged);
  await assert.rejects(
    applyCleanupPlan(root, forged, forged.id, { now, assertIdle: idle }),
    /eligible/,
  );
  await write('out/sync-ui/vite-cache/data', 'changed');
  await assert.rejects(
    applyCleanupPlan(root, plan, plan.id, { now, assertIdle: idle }),
    /changed/,
  );
  assert.equal(
    await fs.readFile(
      path.join(root, 'out/sync-ui/profile/Cache/data'),
      'utf8',
    ),
    'fixture',
  );
});

test('approved cleanup removes only cache, preserves profile data, and records receipt', async (t) => {
  const { root, write } = await fixture(t);
  await write('out/sync-ui/profile/Cache/data');
  await write('out/sync-ui/profile/Local Storage/important', 'keep');
  const now = future();
  const plan = await createCleanupPlan(root, { now });
  const receipt = await applyCleanupPlan(root, plan, plan.id, {
    now,
    assertIdle: idle,
  });
  assert.equal(receipt.deleted.length, 1);
  await assert.rejects(fs.stat(path.join(root, 'out/sync-ui/profile/Cache')), {
    code: 'ENOENT',
  });
  assert.equal(
    await fs.readFile(
      path.join(root, 'out/sync-ui/profile/Local Storage/important'),
      'utf8',
    ),
    'keep',
  );
  const saved = JSON.parse(
    await fs.readFile(
      path.join(root, `out/artifact-cleanup/${plan.id}.receipt.json`),
      'utf8',
    ),
  );
  assert.equal(saved.planId, plan.id);
  assert.ok(saved.completedAt);
});

test('retains the two newest UUID profiles even when their caches are old', async (t) => {
  const { root, write } = await fixture(t);
  for (const id of [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ])
    await write(`out/workspace-panels-ui/profiles/${id}/Cache/data`);
  await write('out/workspace-panels-ui/profiles/not-a-uuid/Cache/data');
  const plan = await createCleanupPlan(root, { now: future() });
  assert.equal(plan.candidates.length, 1);
  assert.match(
    plan.candidates[0].path,
    /^out\/workspace-panels-ui\/profiles\/[a-f0-9-]+\/Cache$/,
  );
});
