import { randomUUID } from 'node:crypto';
import { gameBuildCodec as codec } from '../../src/adapters/node/game-build-codec.ts';
import { appendGameBuild } from '../../src/core/projects/game-build.ts';

export const imagePath = 'assets/images/fixture.png';
export const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWRkAAAAASUVORK5CYII=';
export function buildFixture(options = {}) {
  const artifactId = options.artifactId ?? randomUUID(),
    buildId = options.buildId ?? randomUUID();
  const path = options.path ?? 'output/inbox/game/v001/index.html';
  const html =
    options.html ?? '<!doctype html><title>보관 검사</title><canvas></canvas>';
  const source =
    options.source ??
    'export const message = "한글 원본"; // asset binding: hero';
  const prefix = `.game-builds/${buildId}`;
  const lock = JSON.stringify({
    version: 1,
    roots: { 'example-engine': 'engine' },
    packages: [
      {
        key: 'engine',
        name: 'example-engine',
        version: '1.2.3',
        resolved:
          'https://registry.npmjs.org/example-engine/-/example-engine-1.2.3.tgz',
        integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
        dependencies: ['math'],
        license: 'MIT',
      },
      {
        key: 'math',
        name: 'example-math',
        version: '2.0.0',
        resolved:
          'https://registry.npmjs.org/example-math/-/example-math-2.0.0.tgz',
        integrity: `sha512-${Buffer.alloc(64, 2).toString('base64')}`,
        dependencies: [],
        license: 'MIT',
      },
    ],
  });
  const notices = JSON.stringify({
    version: 1,
    packages: ['engine', 'math'].map((key) => ({
      key,
      license: 'MIT',
      text: `${key} fixture license notice`,
    })),
  });
  const manifest = {
    version: 1,
    artifactId,
    buildId,
    entry: 'main.js',
    sources: [
      {
        path: 'main.js',
        bytes: codec.byteLength(source),
        sha256: codec.digest(source),
      },
    ],
    assets: [{ key: 'hero', path: imagePath, sha256: codec.digest(image) }],
    documents: [
      {
        path: 'docs/rules.md',
        id: 'rules',
        sha256: codec.digest('# 최초 규칙'),
      },
    ],
    dependenciesSha256: codec.digest(lock),
    noticesSha256: codec.digest(notices),
    output: {
      pathAtCreation: path,
      bytes: codec.byteLength(html),
      sha256: codec.digest(html),
    },
    instructionsVersion: 'fixture-1',
    tool: {
      name: 'fixture',
      version: '1.0.0',
      sha256: codec.digest('fixture-tool'),
      profile: 'standalone-1',
    },
  };
  const bundle = {
    [`${prefix}/manifest.json`]: JSON.stringify(manifest),
    [`${prefix}/dependencies.lock.json`]: lock,
    [`${prefix}/notices.json`]: notices,
    [`${prefix}/source/main.js`]: source,
  };
  const before = {
    'project.md': '# 프로젝트',
    'docs/rules.md': '# 최초 규칙',
    [imagePath]: image,
    ...options.before,
  };
  const artifact = { artifactId, buildId, path };
  const files = appendGameBuild(before, bundle, artifact, html, codec);
  return { before, files, bundle, artifact, manifest, html, source, prefix };
}
