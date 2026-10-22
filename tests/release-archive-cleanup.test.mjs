import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  createReleaseArchivePlan,
  applyReleaseArchivePlan,
} from '../scripts/release-archive-cleanup.mjs';

const exec = promisify(execFile);
const repository = 'sehyeok3406/game-jam-dev';
const api = `https://api.github.com/repos/${repository}`;
const hash = (data, algorithm = 'sha256') =>
  createHash(algorithm).update(data).digest('hex');
const idle = async () => {};

async function fixture(t, { tag = 'v0.24.0', badSha1 = false } = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'release-cleanup-')),
  );
  await exec('git', ['init', '-q', root], { windowsHide: true });
  const directory = `out/releases/${tag}`;
  await fs.mkdir(path.join(root, directory), { recursive: true });
  await fs.mkdir(path.join(root, 'out/artifact-cleanup'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '0.34.0' }),
  );
  const binaries = new Map([
    [`Game.Jam-${tag.slice(1)}.Setup.exe`, Buffer.from('installer-fixture')],
    [`game_canvas-${tag.slice(1)}-full.nupkg`, Buffer.from('nupkg-fixture')],
  ]);
  const nupkg = [...binaries].find(([name]) => name.endsWith('.nupkg'));
  const releases = Buffer.from(
    `${badSha1 ? '0'.repeat(40) : hash(nupkg[1], 'sha1')} ${nupkg[0]} ${nupkg[1].length}\n`,
  );
  const assets = [...binaries, ['RELEASES', releases]].map(
    ([name, data], i) => ({
      id: i + 1,
      name,
      size: data.length,
      state: 'uploaded',
      digest: `sha256:${hash(data)}`,
      browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`,
    }),
  );
  for (const [name, data] of [...binaries, ['RELEASES', releases]])
    await fs.writeFile(path.join(root, directory, name), data);
  await fs.writeFile(
    path.join(root, directory, 'verification.json'),
    'preserve',
  );
  const control = {
    private: false,
    missing: false,
    wrongHash: false,
    noDigest: false,
    requests: [],
  };
  const request = async (url, options = {}) => {
    control.requests.push({ url, options });
    assert.equal(new Headers(options.headers).has('authorization'), false);
    if (url === api)
      return Response.json({ private: control.private, full_name: repository });
    if (url.startsWith(api + '/releases?'))
      return Response.json([
        {
          tag_name: 'v0.34.0',
          published_at: '2026-10-22T00:00:00Z',
          draft: false,
          prerelease: false,
          assets: [],
        },
        {
          tag_name: 'v0.33.0',
          published_at: '2026-10-20T00:00:00Z',
          draft: false,
          prerelease: false,
          assets: [],
        },
        {
          tag_name: tag,
          published_at: '2026-10-15T00:00:00Z',
          draft: false,
          prerelease: false,
          assets: assets.map((a) => ({
            ...a,
            digest: control.noDigest
              ? null
              : control.wrongHash
                ? 'sha256:' + '0'.repeat(64)
                : a.digest,
          })),
        },
      ]);
    if (control.missing) return new Response('missing', { status: 404 });
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    const data = name === 'RELEASES' ? releases : binaries.get(name);
    assert.ok(data, 'Unexpected download URL');
    if (new Headers(options.headers).get('range'))
      return new Response(data.subarray(0, 1), {
        status: 206,
        headers: {
          'content-length': '1',
          'content-range': `bytes 0-0/${data.length}`,
        },
      });
    return new Response(data, {
      status: 200,
      headers: { 'content-length': String(data.length) },
    });
  };
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('release-cleanup-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, directory, binaries, assets, control, request };
}

test('public audit verifies exact bytes and only proposes the two release binaries', async (t) => {
  const f = await fixture(t);
  const plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 2);
  assert.deepEqual(plan.retainedTags, ['v0.34.0', 'v0.33.0']);
  assert.equal(plan.deferred.length, 0);
  assert.ok(
    plan.candidates.every((c) => c.method === 'github-sha256-and-public-range'),
  );
  assert.equal(
    f.control.requests.filter((r) =>
      new Headers(r.options.headers).has('range'),
    ).length,
    2,
  );
  assert.equal(
    f.control.requests.filter(
      (r) =>
        r.url.endsWith('.exe') && !new Headers(r.options.headers).has('range'),
    ).length,
    0,
  );
  assert.equal(
    await fs.readFile(
      path.join(f.root, f.directory, 'verification.json'),
      'utf8',
    ),
    'preserve',
  );
});

test('published assets missing or digest mismatch preserve the whole version', async (t) => {
  const f = await fixture(t);
  f.control.missing = true;
  let plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 0);
  assert.match(plan.deferred[0].reason, /accessible/);
  f.control.missing = false;
  f.control.wrongHash = true;
  plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 0);
  assert.match(plan.deferred[0].reason, /RELEASES differ/);
});

test('missing GitHub digest falls back to full streaming verification', async (t) => {
  const f = await fixture(t);
  f.control.noDigest = true;
  const plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 2);
  assert.ok(
    plan.candidates.every((c) => c.method === 'full-public-download-sha256'),
  );
});

test('wrong RELEASES package SHA-1 blocks even matching public and local files', async (t) => {
  const f = await fixture(t, { badSha1: true });
  const plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 0);
  assert.match(plan.deferred[0].reason, /SHA-1/);
});

test('retained versions and private repositories are never eligible', async (t) => {
  const f = await fixture(t, { tag: 'v0.33.0' });
  const plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 0);
  assert.match(plan.deferred[0].reason, /Retained/);
  f.control.private = true;
  await assert.rejects(
    createReleaseArchivePlan(f.root, { request: f.request }),
    /public repository/,
  );
});

test('tracked release binaries, pins and linked directories are preserved', async (t) => {
  const f = await fixture(t);
  const name = [...f.binaries.keys()][0];
  await exec('git', ['add', `${f.directory}/${name}`], {
    cwd: f.root,
    windowsHide: true,
  });
  let plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 0);
  assert.match(plan.deferred[0].reason, /Git tracked/);
  await fs.writeFile(path.join(f.root, f.directory, '.cleanup-keep'), '');
  plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.match(plan.deferred[0].reason, /Pinned/);
  await fs.rename(
    path.join(f.root, f.directory),
    path.join(f.root, 'out/linked-target'),
  );
  await fs.symlink(
    path.join(f.root, 'out/linked-target'),
    path.join(f.root, f.directory),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  plan = await createReleaseArchivePlan(f.root, { request: f.request });
  assert.equal(plan.candidates.length, 0);
});

test('apply requires approval and rechecks remote recovery and changed local files', async (t) => {
  const f = await fixture(t);
  const now = Date.now();
  const options = { request: f.request, assertIdle: idle, now };
  const plan = await createReleaseArchivePlan(f.root, options);
  await assert.rejects(
    applyReleaseArchivePlan(f.root, plan, 'wrong', options),
    /identity/,
  );
  await assert.rejects(
    applyReleaseArchivePlan(f.root, plan, plan.id, {
      ...options,
      now: now + 86400001,
    }),
    /expired/,
  );
  f.control.missing = true;
  await assert.rejects(
    applyReleaseArchivePlan(f.root, plan, plan.id, options),
    /recoverable/,
  );
  f.control.missing = false;
  await fs.writeFile(path.join(f.root, plan.candidates[1].path), 'changed');
  await assert.rejects(
    applyReleaseArchivePlan(f.root, plan, plan.id, options),
    /recoverable/,
  );
  assert.equal(
    await fs.readFile(path.join(f.root, plan.candidates[0].path), 'utf8'),
    'installer-fixture',
  );
});

test('approved deletion removes only verified binaries and preserves all evidence', async (t) => {
  const f = await fixture(t);
  const options = { request: f.request, assertIdle: idle };
  const plan = await createReleaseArchivePlan(f.root, options);
  const receipt = await applyReleaseArchivePlan(f.root, plan, plan.id, options);
  assert.equal(receipt.deleted.length, 2);
  for (const name of f.binaries.keys())
    await assert.rejects(fs.stat(path.join(f.root, f.directory, name)), {
      code: 'ENOENT',
    });
  assert.ok(await fs.stat(path.join(f.root, f.directory, 'RELEASES')));
  assert.equal(
    await fs.readFile(
      path.join(f.root, f.directory, 'verification.json'),
      'utf8',
    ),
    'preserve',
  );
  const saved = JSON.parse(
    await fs.readFile(
      path.join(f.root, `out/artifact-cleanup/release-${plan.id}.receipt.json`),
      'utf8',
    ),
  );
  assert.ok(saved.completedAt);
});
