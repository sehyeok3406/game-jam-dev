import type { Snapshot } from '../../contracts/project.ts';
import type {
  GameBuildManifestV1,
  GameBuildIndexV1,
} from '../../contracts/game-build.ts';
import { readGameBuildIndex } from './game-build.ts';
import { readFileNames } from '../documents/name-registry.ts';

/** Historical manifests stay immutable; the current name registry owns renamed paths. */
export function currentGameBuildDocumentPath(
  files: Snapshot,
  document: { path: string; id: string },
) {
  return (
    readFileNames(files).entries.find(
      (e) => e.kind === 'markdown' && e.id === document.id,
    )?.path ?? document.path
  );
}

/** Follow only this result's durable references, never every project's document. */
export function gameBuildEditingInputs(
  files: Snapshot,
  path: string | undefined,
  read: (raw: string) => { data: Record<string, unknown> },
): string[] {
  if (!path) return [];
  const artifact = readGameBuildIndex(files).artifacts.find(
    (a) => a.path === path,
  );
  if (!artifact) return files[path] === undefined ? [] : [path];
  const manifest = JSON.parse(
    files[`.game-builds/${artifact.buildId}/manifest.json`],
  ) as GameBuildManifestV1;
  return [
    ...new Set([
      path,
      ...manifest.assets.map((a) => a.path),
      ...manifest.documents.flatMap((d) => {
        const current = currentGameBuildDocumentPath(files, d);
        return files[current] && read(files[current]).data.id === d.id
          ? [current]
          : [];
      }),
    ]),
  ];
}

/** Finish cannot silently replace the selected game's dependency graph. */
export function assertGameBuildEditingLock(
  before: Snapshot,
  after: Snapshot,
  basePath: string | undefined,
  output: string,
) {
  const prior = readGameBuildIndex(before).artifacts.find(
    (a) => a.path === basePath,
  );
  if (!prior) return;
  const next = readGameBuildIndex(after).artifacts.find(
    (a) => a.path === output,
  );
  if (
    !next ||
    JSON.stringify(
      JSON.parse(
        before[`.game-builds/${prior.buildId}/dependencies.lock.json`],
      ),
    ) !==
      JSON.stringify(
        JSON.parse(
          after[`.game-builds/${next.buildId}/dependencies.lock.json`],
        ),
      )
  )
    throw Error('기존 게임의 고정 라이브러리 버전을 유지해야 합니다.');
}

/** The global index is shared by games; restoring one record must preserve later games. */
export function rebaseGameBuildRestoration(
  current: Snapshot,
  changes: Record<string, string | null>,
  before: Snapshot,
  after: Snapshot,
) {
  const key = '.game-builds/index.json';
  if (!Object.hasOwn(changes, key)) return changes;
  const old = readGameBuildIndex(before),
    next = readGameBuildIndex(after);
  const affected = new Set(
    [...old.artifacts, ...next.artifacts]
      .filter(
        (a) =>
          JSON.stringify(
            old.artifacts.find((b) => b.artifactId === a.artifactId),
          ) !==
          JSON.stringify(
            next.artifacts.find((b) => b.artifactId === a.artifactId),
          ),
      )
      .map((a) => a.artifactId),
  );
  const target =
    changes[key] === null
      ? []
      : readGameBuildIndex({ [key]: changes[key] }).artifacts;
  const index: GameBuildIndexV1 = {
    version: 1,
    artifacts: [
      ...readGameBuildIndex(current).artifacts.filter(
        (a) => !affected.has(a.artifactId),
      ),
      ...target.filter((a) => affected.has(a.artifactId)),
    ],
  };
  const result: Record<string, string | null> = {
    ...changes,
    [key]: JSON.stringify(index),
  };
  // Restoring before the game's creation also removes later revisions of that game.
  for (const [path, raw] of Object.entries(current)) {
    if (!/^\.game-builds\/[^/]+\/manifest\.json$/.test(path)) continue;
    const manifest = JSON.parse(raw) as GameBuildManifestV1;
    if (
      affected.has(manifest.artifactId) &&
      !index.artifacts.some((a) => a.artifactId === manifest.artifactId)
    ) {
      const prefix = path.slice(0, -'manifest.json'.length);
      for (const p of Object.keys(current))
        if (p.startsWith(prefix)) result[p] = null;
    }
  }
  return result;
}
