import { randomUUID } from 'node:crypto';
import { gameBuildTask } from '../../src/task-plan.ts';
import { gameBuildCodec as codec } from '../../src/adapters/node/game-build-codec.ts';
import { createGameBuildRevision } from '../../src/core/projects/game-build-publication.ts';
import {
  appendGameBuild,
  readGameBuildIndex,
} from '../../src/core/projects/game-build.ts';

/** Protocol fixture only. Actual compilation is covered by the portable-runtime suite. */
export function withGameBuildResult(files, taskPath, artifacts) {
  if (!gameBuildTask(files[taskPath])) return artifacts;
  const output = Object.keys(artifacts).find((p) => p.endsWith('.html'));
  const built = {
    plan: {
      version: 1,
      entry: 'main.js',
      html: 'index.html',
      files: ['main.js', 'index.html'],
      assets: [],
    },
    sources: {
      'main.js': 'document.body.dataset.fixture="ready";',
      'index.html':
        '<!doctype html><html><body><canvas></canvas><script type="module" src="./main.js"></script></body></html>',
    },
    html: artifacts[output],
    lock: { version: 1, roots: {}, packages: [] },
    notices: { version: 1, packages: [] },
    profile: 'standalone-browser-v1',
    toolsetSha256: codec.digest('fixture-tool'),
  };
  const artifactId =
      readGameBuildIndex(files).artifacts.find((a) => a.path === output)
        ?.artifactId ?? randomUUID(),
    buildId = randomUUID();
  const r = createGameBuildRevision(
    {
      built,
      artifactId,
      buildId,
      output,
      documents: [],
      instructionsVersion: 'fixture-v2',
      assetHashes: {},
    },
    codec,
  );
  const bundle = {
    ...Object.fromEntries(
      Object.entries(built.sources).map(([p, s]) => [
        `${r.prefix}/source/${p}`,
        s,
      ]),
    ),
    [`${r.prefix}/manifest.json`]: JSON.stringify(r.manifest),
    [`${r.prefix}/dependencies.lock.json`]: r.lock,
    [`${r.prefix}/notices.json`]: r.notices,
  };
  const result = appendGameBuild(
    { ...files, ...artifacts },
    bundle,
    { artifactId, buildId, path: output },
    built.html,
    codec,
  );
  return {
    ...artifacts,
    ...Object.fromEntries(
      Object.entries(result).filter(
        ([p, v]) => p.startsWith('.game-builds/') && files[p] !== v,
      ),
    ),
  };
}
