import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import {
  DependencyPreparationLimits as L,
  type PreparedDependenciesV1,
} from '../../../contracts/dependency-preparation.ts';
import type { GameBuildDependenciesV1 } from '../../../contracts/game-build.ts';
import {
  parseDependencyRequest,
  isRegistryPackageName,
  validateDependencyLock,
} from '../../../core/ai/dependency-preparation.ts';

type Meta = {
  name: string;
  version: string;
  description?: string;
  license?: string;
  dist: { tarball: string; integrity: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  bundledDependencies?: string[];
  bundleDependencies?: string[];
  homepage?: string;
  repository?: { url?: string };
  types?: string;
  typings?: string;
};
type Input = {
  request: unknown;
  jobRoot: string;
  cacheRoot: string;
  toolsetSha256: string;
  registryOrigin?: string;
};
const runtimeRequire = createRequire(
  new URL('./npm/bin/npm-cli.js', import.meta.url),
);
const semver = runtimeRequire('semver') as {
  validRange(v: string): string | null;
  valid(v: string): string | null;
  satisfies(v: string, range: string): boolean;
  maxSatisfying(v: string[], range: string): string | null;
};
const tar = runtimeRequire('tar') as {
  x(options: Record<string, unknown>): Promise<void>;
};
const sha = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
function error(code: string, message: string): never {
  throw Object.assign(Error(message), { code });
}
const publicOrigin = 'https://registry.npmjs.org';
const safeReference = (value: unknown) =>
  typeof value === 'string' &&
  /^https:\/\/[a-z0-9.-]+\/[^\s]*$/i.test(value) &&
  value.length < 2048
    ? value
    : null;
function references(meta: Meta) {
  return [
    ...new Set(
      [meta.homepage, meta.repository?.url?.replace(/^git\+/, '')]
        .map(safeReference)
        .filter((v): v is string => !!v),
    ),
  ];
}
function safePackageFile(relative: string) {
  return (
    !!relative &&
    relative.length <= 500 &&
    relative
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '..' &&
          part !== '.' &&
          !/[<>:"|?*\\]/.test(part) &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
          ![...part].some((c) => c.charCodeAt(0) < 32),
      )
  );
}
async function main(input: Input) {
  const request = parseDependencyRequest(input.request);
  if (request.action === 'done')
    error('REQUEST', '완료 확인은 실행 서비스가 처리합니다.');
  if (
    !path.isAbsolute(input.jobRoot) ||
    !path.isAbsolute(input.cacheRoot) ||
    path.dirname(input.jobRoot) !== input.cacheRoot ||
    !path.basename(input.jobRoot).startsWith('.work-')
  )
    error('PATH', '준비 작업 폴더가 올바르지 않습니다.');
  const registryOrigin = input.registryOrigin ?? publicOrigin;
  if (
    registryOrigin !== publicOrigin &&
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(registryOrigin)
  )
    error('REGISTRY', '지원하지 않는 registry입니다.');
  let downloaded = 0,
    extracted = 0,
    files = 0;
  const packuments = new Map<
    string,
    {
      versions: Record<string, Meta>;
      'dist-tags': Record<string, string>;
      description?: string;
    }
  >();
  async function bytes(url: string, limit: number) {
    const parsed = new URL(url);
    if (
      parsed.origin !== publicOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      error('SOURCE', '공개 npm registry 외 출처는 지원하지 않습니다.');
    const response = await fetch(
      registryOrigin + parsed.pathname + parsed.search,
      {
        redirect: 'error',
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (!response.ok || !response.body)
      error(
        'NETWORK',
        `라이브러리 자료를 받지 못했습니다 (HTTP ${response.status}).`,
      );
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > limit) error('LIMIT', '라이브러리 다운로드 크기 한도 초과');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      downloaded += chunk.length;
      if (size > limit || downloaded > L.downloadBytes) {
        await response.body.cancel().catch(() => {});
        error('LIMIT', '라이브러리 다운로드 크기 한도 초과');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function packument(name: string) {
    if (!isRegistryPackageName(name))
      error('SOURCE', '지원하지 않는 패키지 이름');
    if (!packuments.has(name))
      packuments.set(
        name,
        JSON.parse(
          (
            await bytes(
              `${publicOrigin}/${encodeURIComponent(name)}`,
              L.metadataBytes,
            )
          ).toString('utf8'),
        ),
      );
    const data = packuments.get(name)!;
    if (!data.versions || !data['dist-tags'])
      error('METADATA', `패키지 정보를 확인해주세요: ${name}`);
    return data;
  }
  async function select(name: string, spec: string) {
    if (!semver.validRange(spec) && !/^[a-z][a-z0-9-]*$/.test(spec))
      error('SOURCE', `git·URL·file·alias 의존성은 지원하지 않습니다: ${name}`);
    const data = await packument(name);
    const pinned =
      request.action === 'prepare' &&
      !request.upgrades?.includes(name) &&
      semver.validRange(spec)
        ? request.previousLock?.packages.find(
            (p) => p.name === name && semver.satisfies(p.version, spec),
          )
        : undefined;
    const version =
      pinned?.version ??
      data['dist-tags'][spec] ??
      semver.maxSatisfying(Object.keys(data.versions), spec);
    const meta = version ? data.versions[version] : undefined;
    if (!meta || !semver.valid(meta.version) || meta.name !== name)
      error('VERSION', `요청한 버전을 찾지 못했습니다: ${name}@${spec}`);
    return meta;
  }
  if (request.action === 'research') {
    const packages = [];
    for (const name of request.names) {
      const meta = await select(name, 'latest');
      packages.push({
        name,
        description: String(meta.description ?? '').slice(0, 2000),
        latest: meta.version,
        references: references(meta),
      });
    }
    return { result: { version: 1, action: 'research', packages } };
  }
  const warnings: string[] = [];
  const compatible = (list: string[] | undefined, actual: string) =>
    !list?.length ||
    (!list.includes(`!${actual}`) &&
      (!list.some((s) => !s.startsWith('!')) ||
        list.includes(actual) ||
        list.includes('any')));
  function inspect(meta: Meta) {
    if (
      !compatible(meta.os, process.platform) ||
      !compatible(meta.cpu, process.arch)
    )
      error(
        'PLATFORM',
        `현재 Windows/아키텍처를 지원하지 않습니다: ${meta.name}`,
      );
    if (
      ['preinstall', 'install', 'postinstall'].some(
        (key) => meta.scripts?.[key],
      )
    )
      error(
        'INSTALL_SCRIPT',
        `설치 스크립트가 있는 배포본은 현재 준비 방식에서 지원하지 않습니다: ${meta.name}`,
      );
    if (meta.bundledDependencies?.length || meta.bundleDependencies?.length)
      error(
        'BUNDLED',
        `별도 의존성 graph로 확인할 수 없는 bundled dependencies: ${meta.name}`,
      );
    if (
      !meta.dist ||
      !/^https:\/\/registry\.npmjs\.org\/[^?#\s\\]+$/.test(meta.dist.tarball) ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(meta.dist.integrity)
    )
      error(
        'INTEGRITY',
        `공개 registry sha512 배포본이 필요합니다: ${meta.name}`,
      );
  }
  let lock: GameBuildDependenciesV1;
  const metadata = new Map<string, Meta>();
  const prior = request.previousLock;
  const sameRoots =
    prior &&
    Object.keys(prior.roots).sort().join('\n') ===
      request.packages
        .map((p) => p.name)
        .sort()
        .join('\n');
  if (sameRoots && !request.upgrades?.length) {
    lock = structuredClone(prior);
    if (
      request.packages.some(
        (p) =>
          semver.validRange(p.version) &&
          !semver.satisfies(
            lock.packages.find((item) => item.key === lock.roots[p.name])!
              .version,
            p.version,
          ),
      )
    )
      error('LOCK_CHANGE', '버전 변경에는 upgrades 대상을 명시해주세요.');
    warnings.push('명시적 업그레이드 없이 기존 exact lock을 유지했습니다.');
    for (const p of lock.packages) {
      metadata.set(p.key, {
        name: p.name,
        version: p.version,
        license: p.license,
        dist: { tarball: p.resolved, integrity: p.integrity },
      });
    }
  } else {
    if (prior && !request.upgrades?.length)
      error('LOCK_CHANGE', '기존 고정 의존성 변경 대상을 명시해주세요.');
    lock = { version: 1, roots: {}, packages: [] };
    async function add(
      name: string,
      spec: string,
      parent = '',
    ): Promise<string> {
      let ancestor = parent;
      let shadowed = false;
      for (;;) {
        const key = `${ancestor ? ancestor + '/' : ''}node_modules/${name}`,
          placed = lock.packages.find((p) => p.key === key);
        if (placed) {
          if (
            semver.satisfies(
              placed.version,
              semver.validRange(spec) ? spec : '*',
            )
          )
            return key;
          shadowed = true;
          break;
        }
        if (!ancestor) break;
        ancestor = ancestor.includes('/node_modules/')
          ? ancestor.slice(0, ancestor.lastIndexOf('/node_modules/'))
          : '';
      }
      const meta = await select(name, spec);
      inspect(meta);
      let key = `node_modules/${name}`;
      if (shadowed || lock.packages.some((p) => p.key === key))
        key = `${parent}/node_modules/${name}`;
      if (
        key.length > 240 ||
        lock.packages.length >= L.packages ||
        lock.packages.some((p) => p.key === key)
      )
        error('LIMIT', '의존성 graph 개수/깊이 한도 초과');
      const item = {
        key,
        name,
        version: meta.version,
        resolved: meta.dist.tarball,
        integrity: meta.dist.integrity,
        license: typeof meta.license === 'string' ? meta.license : 'UNKNOWN',
        dependencies: [] as string[],
      };
      lock.packages.push(item);
      metadata.set(key, meta);
      return key;
    }
    for (const p of request.packages) {
      const previous = prior?.packages.find(
        (item) => item.key === prior.roots[p.name],
      );
      lock.roots[p.name] = await add(
        p.name,
        previous && !request.upgrades?.includes(p.name)
          ? previous.version
          : p.version,
      );
    }
    for (let i = 0; i < lock.packages.length; i++) {
      const item = lock.packages[i],
        meta = metadata.get(item.key)!;
      const deps = { ...meta.dependencies };
      for (const [name, range] of Object.entries(meta.peerDependencies ?? {}))
        if (!meta.peerDependenciesMeta?.[name]?.optional) {
          const host = lock.packages.find(
            (p) => p.key === `node_modules/${name}`,
          );
          if (
            host &&
            (!semver.validRange(range) ||
              !semver.satisfies(host.version, range))
          )
            error(
              'PEER_CONFLICT',
              `공통 peer 버전이 충돌합니다: ${item.name} → ${name}`,
            );
          item.dependencies.push(await add(name, range));
        }
      for (const [name, spec] of Object.entries(deps).sort()) {
        if (meta.optionalDependencies?.[name]) {
          warnings.push(
            `선택 의존성은 자동 설치하지 않았습니다: ${item.name} → ${name}`,
          );
          continue;
        }
        item.dependencies.push(await add(name, spec, item.key));
      }
      for (const name of Object.keys(meta.optionalDependencies ?? {}))
        warnings.push(`선택 의존성 미포함: ${item.name} → ${name}`);
    }
  }
  validateDependencyLock(lock);
  const workspace = path.join(input.jobRoot, 'workspace');
  await fs.mkdir(workspace);
  const archiveRoot = path.join(input.cacheRoot, 'archives');
  await fs.mkdir(archiveRoot, { recursive: true });
  if (
    (await fs.lstat(archiveRoot)).isSymbolicLink() ||
    path.dirname(await fs.realpath(archiveRoot)) !== input.cacheRoot
  )
    error('CACHE_PATH', '캐시 폴더의 외부 링크는 허용하지 않습니다.');
  const notices: PreparedDependenciesV1['notices'] = {
    version: 1,
    packages: [],
  };
  for (const p of lock.packages) {
    const archive = path.join(archiveRoot, `${sha(p.integrity)}.tgz`);
    const valid = (data: Buffer) =>
      `sha512-${createHash('sha512').update(data).digest('base64')}` ===
      p.integrity;
    const cachedStat = await fs.lstat(archive).catch(() => null);
    if (cachedStat?.isSymbolicLink())
      error('CACHE_PATH', '캐시 파일의 링크는 허용하지 않습니다.');
    let compressed =
      cachedStat?.isFile() && cachedStat.size <= L.tarballBytes
        ? await fs.readFile(archive)
        : null;
    if (!compressed || !valid(compressed)) {
      compressed = await bytes(p.resolved, L.tarballBytes);
      if (!valid(compressed))
        error('INTEGRITY', `배포본 hash 또는 다운로드 한도 오류: ${p.name}`);
      const scratch = archive + `.${randomUUID()}.tmp`;
      await fs.writeFile(scratch, compressed);
      try {
        await fs.rename(scratch, archive);
      } catch (e) {
        const current = await fs.readFile(archive).catch(() => null);
        if (!current || !valid(current)) throw e;
      } finally {
        await fs.rm(scratch, { force: true });
      }
    }
    const directory = path.join(workspace, p.key);
    await fs.mkdir(directory, { recursive: true });
    const seen = new Set<string>(),
      spellings = new Map<string, string>();
    await tar.x({
      file: archive,
      cwd: directory,
      strip: 1,
      strict: true,
      preservePaths: false,
      maxMetaEntrySize: 1_000_000,
      filter(entryPath: string, entry: { type: string; size: number }) {
        const relative = entryPath.replace(/\/$/, '').replace(/^package\//, '');
        if (entryPath === 'package' || entryPath === 'package/')
          return entry.type === 'Directory';
        if (
          !entryPath.startsWith('package/') ||
          !safePackageFile(relative) ||
          relative.split('/').some((s) => s.toLowerCase() === 'node_modules') ||
          !['File', 'OldFile', 'Directory'].includes(entry.type)
        )
          error('ARCHIVE_PATH', `허용하지 않는 archive 경로/링크: ${p.name}`);
        const segments = relative.split('/');
        if (++files > L.files) error('LIMIT', '압축 해제 항목 수 한도 초과');
        for (let n = 1; n <= segments.length; n++) {
          const prefix = segments.slice(0, n).join('/'),
            key = prefix.toLowerCase();
          if (spellings.has(key) && spellings.get(key) !== prefix)
            error('ARCHIVE_PATH', '폴더 대소문자 충돌');
          spellings.set(key, prefix);
        }
        if (entry.type !== 'Directory') {
          if (seen.has(relative.toLowerCase()))
            error('ARCHIVE_PATH', '대소문자/중복 archive 경로');
          seen.add(relative.toLowerCase());
          extracted += entry.size;
          if (
            !Number.isSafeInteger(entry.size) ||
            entry.size < 0 ||
            entry.size > L.fileBytes ||
            files > L.files ||
            extracted > L.extractedBytes
          )
            error('LIMIT', '압축 해제 파일/크기 한도 초과');
        }
        return true;
      },
    });
    const installed = JSON.parse(
      await fs.readFile(path.join(directory, 'package.json'), 'utf8'),
    ) as Meta;
    if (installed.name !== p.name || installed.version !== p.version)
      error('INTEGRITY', '배포본 package.json의 이름/버전 불일치');
    inspect({ ...installed, dist: metadata.get(p.key)!.dist });
    if (
      p.license === 'UNKNOWN' &&
      !(sameRoots && !request.upgrades?.length) &&
      typeof installed.license === 'string'
    )
      p.license = installed.license;
    if (installed.license !== p.license)
      error('LICENSE', 'registry와 배포본의 license 정보가 일치하지 않습니다.');
    metadata.set(p.key, { ...installed, dist: metadata.get(p.key)!.dist });
    const licenses = (await fs.readdir(directory))
      .filter((name) =>
        /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(name),
      )
      .sort();
    if (!licenses.length || p.license === 'UNKNOWN')
      error(
        'LICENSE',
        `라이선스 고지 원문이 필요합니다: ${p.name}@${p.version}`,
      );
    let text = '';
    for (const name of licenses) {
      const stat = await fs.stat(path.join(directory, name));
      if (!stat.isFile()) continue;
      if (stat.size > 200_000) error('LIMIT', '라이선스 고지 크기 초과');
      text += `${name}\n${await fs.readFile(path.join(directory, name), 'utf8')}\n`;
    }
    if (!text.trim()) error('LICENSE', '라이선스 고지 원문이 비어 있습니다.');
    notices.packages.push({ key: p.key, license: p.license, text });
  }
  const materials: PreparedDependenciesV1['materials'] = [];
  let materialBytes = 0;
  for (const [specifier, key] of Object.entries(lock.roots)) {
    const p = lock.packages.find((item) => item.key === key)!,
      meta = metadata.get(key)!,
      directory = path.join(workspace, key),
      documents: PreparedDependenciesV1['materials'][number]['documents'] = [];
    const readme = (await fs.readdir(directory)).find((name) =>
      /^readme(?:\.md|\.txt)?$/i.test(name),
    );
    for (const name of [readme, meta.types ?? meta.typings].filter(
      (s): s is string => !!s,
    )) {
      const relative = name.replace(/^\.\//, '');
      if (!safePackageFile(relative)) continue;
      const filename = path.join(directory, relative);
      const stat = await fs.stat(filename).catch(() => null);
      if (!stat?.isFile()) continue;
      const original = await fs.readFile(filename);
      const text = new StringDecoder('utf8').write(
        original.subarray(0, Math.min(32_000, L.materialBytes - materialBytes)),
      );
      materialBytes += Buffer.byteLength(text);
      if (text)
        documents.push({
          source: `npm:${p.name}@${p.version}/${relative}`,
          sha256: sha(text),
          sourceSha256: sha(original),
          truncated: original.length > Buffer.byteLength(text),
          text,
        });
      if (original.length > Buffer.byteLength(text))
        warnings.push(`API 자료 일부만 전달했습니다: ${p.name}/${relative}`);
    }
    materials.push({
      specifier,
      version: p.version,
      documents,
      references: references(meta),
    });
  }
  const result: PreparedDependenciesV1 = {
    version: 1,
    action: 'prepared',
    lock,
    lockSha256: sha(JSON.stringify(lock)),
    notices,
    target: { platform: process.platform, arch: process.arch },
    toolsetSha256: input.toolsetSha256,
    selection: request.packages.map((p) => ({
      name: p.name,
      version: lock.packages.find((item) => item.key === lock.roots[p.name])!
        .version,
      reason: p.reason,
    })),
    materials,
    warnings: [...new Set(warnings)],
  };
  if (Buffer.byteLength(JSON.stringify(result)) > L.resultBytes)
    error('LIMIT', '준비 결과/고지 크기 한도 초과');
  return { result };
}
let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk.toString();
  if (Buffer.byteLength(raw) > 2_000_000) error('LIMIT', '준비 요청 크기 초과');
}
try {
  process.stdout.write(JSON.stringify(await main(JSON.parse(raw))));
} catch (cause) {
  const e = cause as Error & { code?: string };
  process.stdout.write(
    JSON.stringify({
      error: {
        code: e.code ?? 'PREPARATION',
        message: e.message.slice(0, 2000),
      },
    }),
  );
  process.exitCode = 1;
}
