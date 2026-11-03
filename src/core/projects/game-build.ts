import type { Snapshot } from '../../contracts/project.ts';
import {
  GAME_BUILD_INDEX,
  GAME_BUILDS_DIRECTORY,
  GameBuildLimits,
  type GameBuildIndexV1,
  type GameBuildManifestV1,
  type GameBuildDependenciesV1,
  type GameBuildNoticesV1,
} from '../../contracts/game-build.ts';

export type GameBuildCodec = {
  byteLength: (text: string) => number;
  digest: (text: string) => string;
  isHtmlPath: (path: string) => boolean;
  isAssetPath: (path: string) => boolean;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
function requireBuild(condition: unknown, detail: string): asserts condition {
  if (!condition) throw Error(`게임 제작 원본을 확인해주세요: ${detail}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function safePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 240 &&
    !value.includes('..') &&
    value
      .split('/')
      .every(
        (part) =>
          !!part &&
          part.toLowerCase() !== 'node_modules' &&
          !/[<>:"|?*\\\s]/.test(part) &&
          ![...part].some((character) => character.charCodeAt(0) < 32) &&
          !part.startsWith('.') &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}
export function isGameBuildSourcePath(value: unknown): value is string {
  return safePath(value) && /\.(?:js|css|json|html)$/.test(value);
}
export function isGameBuildPath(path: string) {
  if (path.length > 240) return false;
  if (path === GAME_BUILD_INDEX) return true;
  const parts = path.split('/');
  return (
    parts[0] === GAME_BUILDS_DIRECTORY &&
    uuid.test(parts[1] ?? '') &&
    ((parts.length === 3 &&
      ['manifest.json', 'dependencies.lock.json', 'notices.json'].includes(
        parts[2],
      )) ||
      (parts[2] === 'source' &&
        isGameBuildSourcePath(parts.slice(3).join('/'))))
  );
}
export function hasGameBuilds(files: Snapshot) {
  return Object.keys(files).some(
    (key) =>
      key === GAME_BUILDS_DIRECTORY ||
      key.startsWith(`${GAME_BUILDS_DIRECTORY}/`),
  );
}
export function readGameBuildIndex(files: Snapshot): GameBuildIndexV1 {
  if (!hasGameBuilds(files)) return { version: 1, artifacts: [] };
  const value: unknown = JSON.parse(files[GAME_BUILD_INDEX] ?? 'null');
  requireBuild(
    record(value) && value.version === 1 && Array.isArray(value.artifacts),
    '지원하지 않는 원본 목록 버전',
  );
  const ids = new Set<string>(),
    paths = new Set<string>();
  for (const artifact of value.artifacts) {
    requireBuild(
      record(artifact) &&
        typeof artifact.artifactId === 'string' &&
        uuid.test(artifact.artifactId) &&
        typeof artifact.buildId === 'string' &&
        uuid.test(artifact.buildId) &&
        typeof artifact.path === 'string',
      '결과 식별자',
    );
    requireBuild(
      !ids.has(artifact.artifactId) && !paths.has(artifact.path.toLowerCase()),
      '중복된 결과',
    );
    ids.add(artifact.artifactId);
    paths.add(artifact.path.toLowerCase());
  }
  return value as GameBuildIndexV1;
}
function parse(files: Snapshot, path: string): Record<string, unknown> {
  requireBuild(typeof files[path] === 'string', `누락 파일 ${path}`);
  const value: unknown = JSON.parse(files[path]);
  requireBuild(
    record(value) && value.version === 1,
    `지원하지 않는 형식 ${path}`,
  );
  return value;
}
function string(value: unknown, limit = 240): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit;
}
function checkLock(files: Snapshot, prefix: string) {
  const lock = parse(files, `${prefix}/dependencies.lock.json`);
  const notices = parse(files, `${prefix}/notices.json`);
  requireBuild(
    record(lock.roots) &&
      Array.isArray(lock.packages) &&
      lock.packages.length <= 1000 &&
      Array.isArray(notices.packages),
    '의존성 목록',
  );
  const packages = new Map<string, Record<string, unknown>>();
  for (const item of lock.packages) {
    requireBuild(
      record(item) &&
        string(item.key) &&
        !packages.has(item.key) &&
        string(item.name) &&
        string(item.version) &&
        /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i.test(
          item.version,
        ) &&
        string(item.resolved, 2048) &&
        /^https:\/\/[a-z0-9.-]+(?::443)?\/[^?#\s\\]+$/i.test(item.resolved) &&
        typeof item.integrity === 'string' &&
        /^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity) &&
        string(item.license, 1024) &&
        Array.isArray(item.dependencies) &&
        item.dependencies.every((key) => string(key)),
      'exact 의존성·출처·무결성',
    );
    packages.set(item.key, item);
  }
  for (const [specifier, key] of Object.entries(lock.roots))
    requireBuild(
      string(specifier) && typeof key === 'string' && packages.has(key),
      '직접 의존성 연결',
    );
  for (const item of packages.values())
    for (const key of item.dependencies as string[])
      requireBuild(packages.has(key), '간접 의존성 연결');
  const seen = new Set<string>();
  for (const item of notices.packages) {
    requireBuild(
      record(item) &&
        string(item.key) &&
        packages.has(item.key) &&
        !seen.has(item.key) &&
        item.license === packages.get(item.key)!.license &&
        string(item.text, GameBuildLimits.metadataBytes),
      '라이선스 고지',
    );
    seen.add(item.key);
  }
  requireBuild(seen.size === packages.size, '누락된 라이선스 고지');
  return {
    lock: lock as GameBuildDependenciesV1,
    notices: notices as GameBuildNoticesV1,
  };
}

/** Complete bundles only; staging fragments and caches are deliberately rejected. */
export function validateGameBuilds(files: Snapshot, codec: GameBuildCodec) {
  if (hasGameBuilds(files)) {
    const values = Object.values(files);
    requireBuild(
      values.length <= GameBuildLimits.files &&
        values.every((v) => typeof v === 'string') &&
        values.reduce((sum, v) => sum + codec.byteLength(v), 0) <=
          GameBuildLimits.snapshotBytes,
      '프로젝트 전송 한도 64MB·500개 파일',
    );
  }
  const index = readGameBuildIndex(files);
  if (!hasGameBuilds(files)) return index;
  const keys = Object.keys(files).filter((key) =>
    key.startsWith(`${GAME_BUILDS_DIRECTORY}/`),
  );
  const canonical = new Set<string>();
  const spellings = new Map<string, string>();
  const fileKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const key of keys) {
    requireBuild(
      isGameBuildPath(key) && !canonical.has(key.toLowerCase()),
      `허용되지 않은 경로 ${key}`,
    );
    canonical.add(key.toLowerCase());
    const segments = key.split('/');
    for (let count = 1; count <= segments.length; count++) {
      const prefix = segments.slice(0, count).join('/'),
        folded = prefix.toLowerCase();
      requireBuild(
        !spellings.has(folded) || spellings.get(folded) === prefix,
        `폴더 대소문자 충돌 ${key}`,
      );
      requireBuild(
        count === segments.length || !fileKeys.has(folded),
        `파일·폴더 경로 충돌 ${key}`,
      );
      spellings.set(folded, prefix);
    }
    requireBuild(
      typeof files[key] === 'string' &&
        codec.byteLength(files[key]) <=
          (key.includes('/source/')
            ? GameBuildLimits.sourceBytes
            : GameBuildLimits.metadataBytes),
      `파일 크기 ${key}`,
    );
  }
  const builds = new Set(
    keys
      .filter((key) => key !== GAME_BUILD_INDEX)
      .map((key) => key.split('/')[1]),
  );
  const found = new Set<string>();
  for (const id of builds) {
    const prefix = `${GAME_BUILDS_DIRECTORY}/${id}`;
    const m = parse(files, `${prefix}/manifest.json`);
    requireBuild(
      m.buildId === id &&
        typeof m.artifactId === 'string' &&
        uuid.test(m.artifactId) &&
        isGameBuildSourcePath(m.entry) &&
        m.entry.endsWith('.js') &&
        Array.isArray(m.sources) &&
        m.sources.length > 0 &&
        m.sources.length <= GameBuildLimits.sourceFiles &&
        Array.isArray(m.assets) &&
        Array.isArray(m.documents),
      `manifest ${id}`,
    );
    const artifact = index.artifacts.find(
      (item) => item.artifactId === m.artifactId,
    );
    requireBuild(
      artifact &&
        codec.isHtmlPath(artifact.path) &&
        typeof files[artifact.path] === 'string',
      '연결된 HTML',
    );
    const sourceKeys = new Set<string>();
    let bytes = 0;
    for (const source of m.sources) {
      requireBuild(
        record(source) &&
          isGameBuildSourcePath(source.path) &&
          !sourceKeys.has(source.path.toLowerCase()),
        '소스 목록',
      );
      sourceKeys.add(source.path.toLowerCase());
      const text = files[`${prefix}/source/${source.path}`];
      requireBuild(
        typeof text === 'string' &&
          source.bytes === codec.byteLength(text) &&
          typeof source.sha256 === 'string' &&
          hash.test(source.sha256) &&
          source.sha256 === codec.digest(text),
        `소스 hash ${source.path}`,
      );
      bytes += codec.byteLength(text);
    }
    requireBuild(
      bytes <= GameBuildLimits.sourceBundleBytes &&
        sourceKeys.has(m.entry.toLowerCase()) &&
        (m.htmlTemplate === undefined ||
          (isGameBuildSourcePath(m.htmlTemplate) &&
            m.htmlTemplate.endsWith('.html') &&
            sourceKeys.has(m.htmlTemplate.toLowerCase()))) &&
        keys.filter((key) => key.startsWith(`${prefix}/source/`)).length ===
          m.sources.length,
      '소스 총량·목록',
    );
    const assetKeys = new Set<string>();
    for (const asset of m.assets) {
      requireBuild(
        record(asset) &&
          typeof asset.key === 'string' &&
          /^[a-zA-Z0-9_-]{1,80}$/.test(asset.key) &&
          !assetKeys.has(asset.key) &&
          typeof asset.path === 'string' &&
          asset.path.startsWith('assets/images/') &&
          codec.isAssetPath(asset.path) &&
          typeof asset.sha256 === 'string' &&
          hash.test(asset.sha256) &&
          typeof files[asset.path] === 'string' &&
          codec.digest(files[asset.path]) === asset.sha256,
        '에셋 연결·hash',
      );
      assetKeys.add(asset.key);
    }
    for (const doc of m.documents)
      requireBuild(
        record(doc) &&
          typeof doc.path === 'string' &&
          /^(?:project\.md|(?:docs|ideas)\/.+\.md)$/.test(doc.path) &&
          !doc.path.includes('..') &&
          !doc.path.includes('\\') &&
          string(doc.id) &&
          typeof doc.sha256 === 'string' &&
          hash.test(doc.sha256),
        '문서 baseline',
      );
    for (const doc of m.documents)
      requireBuild(
        doc.designSha256 === undefined ||
          (typeof doc.designSha256 === 'string' && hash.test(doc.designSha256)),
        '문서 baseline',
      );
    checkLock(files, prefix);
    requireBuild(
      m.dependenciesSha256 ===
        codec.digest(files[`${prefix}/dependencies.lock.json`]) &&
        m.noticesSha256 === codec.digest(files[`${prefix}/notices.json`]),
      'lock·고지 hash',
    );
    requireBuild(
      record(m.output) &&
        typeof m.output.pathAtCreation === 'string' &&
        codec.isHtmlPath(m.output.pathAtCreation) &&
        typeof m.output.sha256 === 'string' &&
        hash.test(m.output.sha256) &&
        Number.isSafeInteger(m.output.bytes) &&
        (m.output.bytes as number) > 0 &&
        string(m.instructionsVersion) &&
        record(m.tool) &&
        string(m.tool.name) &&
        string(m.tool.version) &&
        typeof m.tool.sha256 === 'string' &&
        hash.test(m.tool.sha256) &&
        string(m.tool.profile),
      '출력·도구 provenance',
    );
    if (artifact.buildId === id) {
      requireBuild(
        codec.byteLength(files[artifact.path]) <= GameBuildLimits.htmlBytes,
        'HTML 한도 8MB',
      );
      requireBuild(
        codec.digest(files[artifact.path]) === m.output.sha256 &&
          codec.byteLength(files[artifact.path]) === m.output.bytes,
        '현재 HTML hash',
      );
      found.add(m.artifactId);
    }
  }
  requireBuild(found.size === index.artifacts.length, '누락된 제작 버전');
  return index;
}

/** History restoration is an explicit separate operation. Ordinary edits append revisions. */
export function assertGameBuildMutation(before: Snapshot, after: Snapshot) {
  const previous = readGameBuildIndex(before),
    next = readGameBuildIndex(after);
  for (const [key, value] of Object.entries(before)) {
    if (
      !isGameBuildPath(key) ||
      key === GAME_BUILD_INDEX ||
      after[key] === value
    )
      continue;
    const id = key.split('/')[1];
    const manifest = JSON.parse(
      before[`${GAME_BUILDS_DIRECTORY}/${id}/manifest.json`],
    ) as GameBuildManifestV1;
    requireBuild(
      !next.artifacts.some((a) => a.artifactId === manifest.artifactId) &&
        after[key] === undefined,
      '완료된 원본은 새 제작 버전으로 저장해야 합니다',
    );
  }
  requireBuild(
    !hasGameBuilds(before) || typeof after[GAME_BUILD_INDEX] === 'string',
    '원본 저장 형식 marker는 유지해야 합니다',
  );
  for (const artifact of previous.artifacts) {
    const kept = next.artifacts.find(
      (a) => a.artifactId === artifact.artifactId,
    );
    if (!kept)
      requireBuild(
        after[artifact.path] === undefined,
        'HTML과 원본을 함께 삭제해주세요',
      );
  }
}

export function moveGameBuilds(
  files: Snapshot,
  moves: readonly { from: string; to: string }[],
) {
  if (!hasGameBuilds(files)) return files;
  const index = readGameBuildIndex(files);
  return {
    ...files,
    [GAME_BUILD_INDEX]: JSON.stringify({
      ...index,
      artifacts: index.artifacts.map((item) => ({
        ...item,
        path: moves.find((move) => move.from === item.path)?.to ?? item.path,
      })),
    }),
  };
}
export function deleteGameBuilds(
  files: Snapshot,
  paths: ReadonlySet<string>,
): Snapshot {
  if (!hasGameBuilds(files)) return files;
  const index = readGameBuildIndex(files);
  const removed = new Set(
    index.artifacts
      .filter((item) => paths.has(item.path))
      .map((item) => item.artifactId),
  );
  const next: Snapshot = {
    ...files,
    [GAME_BUILD_INDEX]: JSON.stringify({
      ...index,
      artifacts: index.artifacts.filter(
        (item) => !removed.has(item.artifactId),
      ),
    }),
  };
  for (const key of Object.keys(next).filter(
    (key) => key.endsWith('/manifest.json') && isGameBuildPath(key),
  )) {
    const manifest = JSON.parse(next[key]) as GameBuildManifestV1;
    if (removed.has(manifest.artifactId))
      for (const path of Object.keys(next))
        if (path.startsWith(key.slice(0, -'manifest.json'.length)))
          delete next[path];
  }
  return next;
}

/** Trusted builder ingress, not a user-editable arbitrary directory write. */
export function appendGameBuild(
  files: Snapshot,
  bundle: Snapshot,
  artifact: GameBuildIndexV1['artifacts'][number],
  html: string,
  codec: GameBuildCodec,
): Snapshot {
  const index = readGameBuildIndex(files);
  requireBuild(
    !Object.keys(bundle).some(
      (key) =>
        key === GAME_BUILD_INDEX ||
        files[key] !== undefined ||
        !key.startsWith(`${GAME_BUILDS_DIRECTORY}/${artifact.buildId}/`),
    ),
    '새 제작 버전 경로',
  );
  const next = {
    ...files,
    ...bundle,
    [artifact.path]: html,
    [GAME_BUILD_INDEX]: JSON.stringify({
      version: 1,
      artifacts: [
        ...index.artifacts.filter((a) => a.artifactId !== artifact.artifactId),
        artifact,
      ],
    }),
  };
  validateGameBuilds(next, codec);
  assertGameBuildMutation(files, next);
  return next;
}

export function readGameBuild(
  files: Snapshot,
  buildId: string,
  codec: GameBuildCodec,
) {
  validateGameBuilds(files, codec);
  requireBuild(uuid.test(buildId), '제작 버전 식별자');
  const prefix = `${GAME_BUILDS_DIRECTORY}/${buildId}`;
  const manifest = parse(
    files,
    `${prefix}/manifest.json`,
  ) as GameBuildManifestV1;
  return {
    manifest,
    ...checkLock(files, prefix),
    sources: Object.fromEntries(
      manifest.sources.map((s) => [
        s.path,
        files[`${prefix}/source/${s.path}`],
      ]),
    ),
  };
}

export function selectGameBuilds(
  files: Snapshot,
  paths: ReadonlySet<string>,
): Snapshot {
  if (!hasGameBuilds(files)) return {};
  const artifacts = readGameBuildIndex(files).artifacts.filter((a) =>
    paths.has(a.path),
  );
  if (!artifacts.length) return {};
  const selected: Snapshot = {
    [GAME_BUILD_INDEX]: JSON.stringify({ version: 1, artifacts }),
  };
  const ids = new Set(artifacts.map((a) => a.artifactId));
  for (const path of Object.keys(files).filter(
    (key) => isGameBuildPath(key) && key.endsWith('/manifest.json'),
  )) {
    const manifest = JSON.parse(files[path]) as GameBuildManifestV1;
    if (!ids.has(manifest.artifactId)) continue;
    for (const key of Object.keys(files))
      if (key.startsWith(path.slice(0, -'manifest.json'.length)))
        selected[key] = files[key];
    for (const asset of manifest.assets)
      selected[asset.path] = files[asset.path];
  }
  return selected;
}

/** Build-local asset keys remain stable; filesystem asset/document bindings are remapped. */
export function copyGameBuilds(
  source: Snapshot,
  target: Snapshot,
  paths: ReadonlyMap<string, string>,
  ids: ReadonlyMap<string, string>,
  id: () => string,
  codec: GameBuildCodec,
): Snapshot {
  if (!hasGameBuilds(source)) return target;
  const original = validateGameBuilds(source, codec);
  requireBuild(
    original.artifacts.every((a) => paths.has(a.path)),
    '선택 밖 제작 원본',
  );
  const artifactIds = new Map(
    original.artifacts.map((a) => [a.artifactId, id()]),
  );
  const builds = new Map<string, string>();
  for (const key of Object.keys(source).filter(
    (key) => isGameBuildPath(key) && key.endsWith('/manifest.json'),
  ))
    builds.set(key.split('/')[1], id());
  requireBuild(
    new Set(builds.values()).size === builds.size &&
      [...builds.values()].every(
        (fresh) =>
          uuid.test(fresh) &&
          !Object.keys(target).some((key) =>
            key.startsWith(`${GAME_BUILDS_DIRECTORY}/${fresh}/`),
          ),
      ) &&
      new Set(artifactIds.values()).size === artifactIds.size &&
      [...artifactIds.values()].every(
        (fresh) =>
          uuid.test(fresh) &&
          !readGameBuildIndex(target).artifacts.some(
            (a) => a.artifactId === fresh,
          ),
      ),
    '복사 식별자 충돌',
  );
  const next = { ...target };
  for (const [old, fresh] of builds) {
    const prefix = `${GAME_BUILDS_DIRECTORY}/${old}`,
      newPrefix = `${GAME_BUILDS_DIRECTORY}/${fresh}`;
    const m = JSON.parse(
      source[`${prefix}/manifest.json`],
    ) as GameBuildManifestV1;
    for (const key of Object.keys(source))
      if (key.startsWith(`${prefix}/`))
        next[`${newPrefix}${key.slice(prefix.length)}`] = source[key];
    const manifest: GameBuildManifestV1 = {
      ...m,
      artifactId: artifactIds.get(m.artifactId)!,
      buildId: fresh,
      assets: m.assets.map((a) => {
        requireBuild(paths.has(a.path), '에셋 복사 연결');
        return { ...a, path: paths.get(a.path)! };
      }),
      documents: m.documents.map((d) => ({
        ...d,
        // A copy remaps document identity/references; old comparison evidence is unknown.
        ...(paths.has(d.path) || ids.has(d.id)
          ? { designSha256: undefined }
          : {}),
        path: paths.get(d.path) ?? d.path,
        id: ids.get(d.id) ?? d.id,
      })),
    };
    next[`${newPrefix}/manifest.json`] = JSON.stringify(manifest);
  }
  const targetIndex = readGameBuildIndex(target);
  next[GAME_BUILD_INDEX] = JSON.stringify({
    version: 1,
    artifacts: [
      ...targetIndex.artifacts,
      ...original.artifacts.map((a) => ({
        artifactId: artifactIds.get(a.artifactId)!,
        buildId: builds.get(a.buildId)!,
        path: paths.get(a.path)!,
      })),
    ],
  });
  validateGameBuilds(next, codec);
  return next;
}
