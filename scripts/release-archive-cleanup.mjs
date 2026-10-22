import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  assertWorkspaceIdle,
  planId,
  safeArtifactPath,
} from './artifact-cleanup.mjs';

const exec = promisify(execFile);
const DAY = 86_400_000;
const POLICY = 'public-release-binaries-v1';
const REPOSITORY = 'sehyeok3406/game-jam-dev';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const headers = {
  'User-Agent': 'GameJam-release-archive-audit',
  Accept: 'application/vnd.github+json',
};

async function publicJson(url, request) {
  const response = await request(url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw Error(`Public GitHub API returned ${response.status}`);
  return response.json();
}

async function releaseInventory(request) {
  const repo = await publicJson(API, request);
  if (repo.private !== false || repo.full_name !== REPOSITORY)
    throw Error('Expected public repository is not available');
  const releases = [];
  for (let page = 1; page <= 10; page++) {
    const items = await publicJson(
      `${API}/releases?per_page=100&page=${page}`,
      request,
    );
    if (!Array.isArray(items)) throw Error('Invalid public release inventory');
    releases.push(...items);
    if (items.length < 100) return releases;
  }
  throw Error('Release inventory exceeded the supported page limit');
}

async function fileIdentity(root, relative) {
  if (!/^[A-Za-z0-9_. !-]+$/.test(path.posix.basename(relative)))
    throw Error('Unexpected artifact filename');
  const parent = await safeArtifactPath(root, path.posix.dirname(relative));
  const target = path.join(parent, path.posix.basename(relative));
  const before = await fs.lstat(target);
  if (!before.isFile() || before.isSymbolicLink())
    throw Error('Artifact is not a plain file');
  const sha256 = createHash('sha256'),
    sha1 = createHash('sha1');
  for await (const chunk of createReadStream(target)) {
    sha256.update(chunk);
    sha1.update(chunk);
  }
  const after = await fs.lstat(target);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs ||
    after.ino !== before.ino
  )
    throw Error('Artifact changed during verification');
  return {
    bytes: before.size,
    sha256: sha256.digest('hex'),
    sha1: sha1.digest('hex'),
    modified: before.mtimeMs,
    changed: before.ctimeMs,
    inode: before.ino,
  };
}

function assetUrl(tag, asset) {
  if (
    !TAG.test(tag) ||
    !/^[A-Za-z0-9_. !-]+$/.test(asset.name) ||
    asset.state !== 'uploaded'
  )
    throw Error('Unexpected public release asset');
  const expected = `https://github.com/${REPOSITORY}/releases/download/${tag}/${encodeURIComponent(asset.name)}`;
  if (new URL(asset.browser_download_url).href !== new URL(expected).href)
    throw Error('Asset URL does not belong to the expected release');
  return expected;
}

async function openPublicAsset(url, range, request) {
  for (const suffix of ['', '?download=1']) {
    const response = await request(url + suffix, {
      headers: range ? { Range: 'bytes=0-0' } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 200 || (range && response.status === 206))
      return { response, url: url + suffix };
    await response.body?.cancel();
  }
  throw Error('Public download is not accessible without authentication');
}

async function smallPublicFile(tag, asset, request) {
  if (asset.size > 65_536) throw Error('Unexpectedly large RELEASES file');
  const opened = await openPublicAsset(assetUrl(tag, asset), false, request);
  const chunks = [];
  let size = 0;
  for await (const chunk of opened.response.body) {
    size += chunk.length;
    if (size > 65_536 || size > asset.size)
      throw Error('Invalid public RELEASES size');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (size !== asset.size) throw Error('Truncated public RELEASES');
  return data;
}

async function verifyBinary(tag, asset, identity, request) {
  if (asset.size !== identity.bytes)
    throw Error('Local and GitHub asset sizes differ');
  const url = assetUrl(tag, asset);
  const opened = await openPublicAsset(url, true, request);
  const response = opened.response;
  const status = response.status;
  const length = Number(response.headers.get('content-length'));
  const range = response.headers.get('content-range');
  const sizeMatches =
    status === 206
      ? range === `bytes 0-0/${identity.bytes}` && length === 1
      : length === identity.bytes;
  await response.body?.cancel();
  if (!sizeMatches)
    throw Error('Public download size or byte range does not match');
  let method;
  if (asset.digest != null) {
    if (asset.digest !== `sha256:${identity.sha256}`)
      throw Error('Local and GitHub SHA-256 differ');
    method = 'github-sha256-and-public-range';
  } else {
    // Only missing GitHub hashes require a full streaming download.
    const full = await openPublicAsset(url, false, request);
    const digest = createHash('sha256');
    let bytes = 0;
    for await (const chunk of full.response.body) {
      bytes += chunk.length;
      if (bytes > identity.bytes) throw Error('Unexpected public binary size');
      digest.update(chunk);
    }
    if (bytes !== identity.bytes || digest.digest('hex') !== identity.sha256)
      throw Error('Full public download does not match the local file');
    method = 'full-public-download-sha256';
  }
  return {
    assetId: asset.id,
    url,
    githubDigest: asset.digest ?? null,
    method,
    publicStatus: status,
  };
}

async function localDirectories(root) {
  const result = [];
  const out = await safeArtifactPath(root, 'out');
  const entries = await fs.readdir(out, { withFileTypes: true });
  if (entries.some((item) => item.name === 'releases')) {
    const directory = await safeArtifactPath(root, 'out/releases');
    for (const item of await fs.readdir(directory, { withFileTypes: true }))
      if (item.isDirectory() && !item.isSymbolicLink() && TAG.test(item.name))
        result.push({ tag: item.name, path: `out/releases/${item.name}` });
  }
  for (const item of entries) {
    const tag = item.name.replace(/-release-assets$/, '');
    if (
      item.isDirectory() &&
      !item.isSymbolicLink() &&
      item.name.endsWith('-release-assets') &&
      TAG.test(tag)
    )
      result.push({ tag, path: `out/${item.name}` });
  }
  return result.sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true }),
  );
}

export async function createReleaseArchivePlan(
  root,
  { now = Date.now(), request = fetch } = {},
) {
  root = await fs.realpath(root);
  const releases = await releaseInventory(request);
  const stable = releases.filter(
    (item) =>
      !item.draft &&
      !item.prerelease &&
      item.published_at &&
      TAG.test(item.tag_name),
  );
  stable.sort((a, b) =>
    b.tag_name.localeCompare(a.tag_name, undefined, { numeric: true }),
  );
  if (stable.length < 2)
    throw Error('Cannot establish two retained stable releases');
  const current = JSON.parse(
    await fs.readFile(path.join(root, 'package.json'), 'utf8'),
  ).version;
  const retained = [
    ...new Set([
      ...stable.slice(0, 2).map((item) => item.tag_name),
      `v${current}`,
    ]),
  ];
  const { stdout } = await exec('git', ['ls-files', '-z', '--', 'out'], {
    cwd: root,
    windowsHide: true,
  });
  const tracked = new Set(stdout.split('\0'));
  const directories = await localDirectories(root);
  const results = [];
  // Limit concurrent public downloads and local hashing to four versions.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < directories.length) {
        const directory = directories[cursor++];
        try {
          if (retained.includes(directory.tag))
            throw Error('Retained current or recent stable release');
          const release = stable.find(
            (item) => item.tag_name === directory.tag,
          );
          if (!release)
            throw Error('Matching published stable release is missing');
          await safeArtifactPath(root, directory.path);
          const names = await fs.readdir(path.join(root, directory.path));
          const binaries = names.filter(
            (name) => /Setup\.exe$/i.test(name) || name.endsWith('-full.nupkg'),
          );
          if (
            binaries.length !== 2 ||
            !binaries.some((name) => /Setup\.exe$/i.test(name)) ||
            !binaries.includes(
              `game_canvas-${directory.tag.slice(1)}-full.nupkg`,
            )
          )
            throw Error('Expected exactly one Setup.exe and one full nupkg');
          const releaseAsset = release.assets.find(
            (item) => item.name === 'RELEASES',
          );
          if (!releaseAsset) throw Error('Public RELEASES asset is missing');
          const localReleases = await fileIdentity(
            root,
            `${directory.path}/RELEASES`,
          );
          const remoteReleases = await smallPublicFile(
            directory.tag,
            releaseAsset,
            request,
          );
          if (
            createHash('sha256').update(remoteReleases).digest('hex') !==
              localReleases.sha256 ||
            (releaseAsset.digest != null &&
              releaseAsset.digest !== `sha256:${localReleases.sha256}`)
          )
            throw Error('Local and public RELEASES differ');
          const candidates = [];
          for (const name of binaries.sort()) {
            const relative = `${directory.path}/${name}`;
            if (tracked.has(relative))
              throw Error('Release binary is Git tracked');
            const asset = release.assets.find((item) => item.name === name);
            if (!asset)
              throw Error(`Matching GitHub asset is missing: ${name}`);
            const identity = await fileIdentity(root, relative);
            const proof = await verifyBinary(
              directory.tag,
              asset,
              identity,
              request,
            );
            if (name.endsWith('.nupkg')) {
              const valid = remoteReleases
                .toString('utf8')
                .trim()
                .split(/\r?\n/)
                .some((line) => {
                  const match = /^([a-f0-9]{40})\s+(\S+)\s+(\d+)$/i.exec(line);
                  if (!match) return false;
                  const packageName = match[2].startsWith('https:')
                    ? decodeURIComponent(
                        new URL(match[2]).pathname.split('/').at(-1),
                      )
                    : match[2];
                  return (
                    packageName === name &&
                    match[1].toLowerCase() === identity.sha1 &&
                    Number(match[3]) === identity.bytes
                  );
                });
              if (!valid)
                throw Error('RELEASES package name, SHA-1 or size differs');
            }
            candidates.push({
              path: relative,
              tag: directory.tag,
              ...identity,
              ...proof,
              releasesSha256: localReleases.sha256,
            });
          }
          results.push({ ...directory, candidates });
        } catch (error) {
          results.push({ ...directory, reason: error.message });
        }
      }
    }),
  );
  results.sort((a, b) => a.path.localeCompare(b.path));
  const candidates = results.flatMap((item) => item.candidates ?? []);
  const plan = {
    schema: 1,
    policy: POLICY,
    root,
    repository: REPOSITORY,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DAY).toISOString(),
    retainedTags: retained,
    candidates,
    deferred: results.filter((item) => item.reason),
    totalBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
  };
  return { ...plan, id: planId(plan) };
}

export function renderReleaseArchivePlan(plan) {
  return [
    '# GitHub 복구를 확인한 이전 배포 파일 정리 승인 목록',
    '',
    `계획 ID: \`${plan.id}\``,
    `생성: ${plan.createdAt} / 만료: ${plan.expiresAt}`,
    '',
    `후보 ${plan.candidates.length}개 파일, ${(plan.totalBytes / 1024 ** 3).toFixed(3)} GiB. 현재·최근 보존 버전: ${plan.retainedTags.join(', ')}.`,
    '',
    '**보고서만 생성했으며 삭제하지 않았습니다. 사람의 명시적 승인 후에만 적용합니다.**',
    '',
    '각 버전의 공개 안정 릴리스, 로컬/GitHub SHA-256·크기, 인증 없는 공개 다운로드 접근, RELEASES의 공개 바이트와 nupkg 이름·SHA-1·크기를 확인했습니다. GitHub SHA-256이 없을 때만 전체 다운로드로 비교합니다.',
    '',
    '삭제 대상은 아래 Setup.exe와 full.nupkg 파일뿐입니다. 폴더·RELEASES·검증 JSON·로그·스크린샷·소스·서버 런타임·테스트 캐시는 보존합니다. 삭제 전 공개 복구 가능성과 로컬 파일을 다시 검증합니다.',
    '',
    '| 버전 | 로컬 파일 | MiB | 공개 다운로드 |',
    '|---|---|---:|---|',
    ...plan.candidates.map(
      (item) =>
        `| ${item.tag} | ${item.path} | ${(item.bytes / 1024 ** 2).toFixed(1)} | [다운로드](${item.url}) |`,
    ),
    '',
    '## 보류',
    '',
    ...plan.deferred.map((item) => `- ${item.path}: ${item.reason}`),
    '',
  ].join('\n');
}

export async function applyReleaseArchivePlan(
  root,
  plan,
  approval,
  { now = Date.now(), request = fetch, assertIdle = assertWorkspaceIdle } = {},
) {
  root = await fs.realpath(root);
  if (
    plan.schema !== 1 ||
    plan.policy !== POLICY ||
    plan.root !== root ||
    plan.id !== approval ||
    planId(plan) !== approval
  )
    throw Error('Release plan identity or approval does not match');
  const created = Date.parse(plan.createdAt),
    expires = Date.parse(plan.expiresAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    created > now ||
    expires <= now ||
    expires - created !== DAY
  )
    throw Error('Release plan expired');
  await assertIdle(root);
  const fresh = await createReleaseArchivePlan(root, { now, request });
  const current = new Map(fresh.candidates.map((item) => [item.path, item]));
  const seen = new Set();
  for (const item of plan.candidates) {
    if (
      seen.has(item.path) ||
      JSON.stringify(current.get(item.path)) !== JSON.stringify(item)
    )
      throw Error(
        `Release candidate changed or is no longer recoverable: ${item.path}`,
      );
    seen.add(item.path);
  }
  const directory = await safeArtifactPath(root, 'out/artifact-cleanup');
  const file = path.join(directory, `release-${plan.id}.receipt.json`);
  const receipt = {
    planId: plan.id,
    deleted: [],
    startedAt: new Date(now).toISOString(),
  };
  await fs.writeFile(file, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  const save = async () => {
    await safeArtifactPath(root, 'out/artifact-cleanup');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error('Unsafe release receipt');
    await fs.writeFile(file, JSON.stringify(receipt, null, 2));
  };
  try {
    for (const item of plan.candidates) {
      await assertIdle(root);
      const identity = await fileIdentity(root, item.path);
      for (const key of Object.keys(identity))
        if (identity[key] !== item[key])
          throw Error(`Release binary changed: ${item.path}`);
      const parent = await safeArtifactPath(
        root,
        path.posix.dirname(item.path),
      );
      // Only one fully resolved, approved plain file is unlinked; never a folder.
      await fs.unlink(path.join(parent, path.posix.basename(item.path)));
      receipt.deleted.push({
        path: item.path,
        bytes: item.bytes,
        sha256: item.sha256,
        downloadUrl: item.url,
      });
      await save();
    }
    receipt.completedAt = new Date().toISOString();
  } catch (error) {
    receipt.error = error.message;
    throw error;
  } finally {
    await save();
  }
  return receipt;
}
