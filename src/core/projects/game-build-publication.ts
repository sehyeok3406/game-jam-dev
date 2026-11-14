import type { Snapshot } from '../../contracts/project.ts';
import type { BuiltGameArtifact } from '../../contracts/game-build-execution.ts';
import type { GameBuildManifestV1 } from '../../contracts/game-build.ts';
import { GAME_BUILD_INDEX } from '../../contracts/game-build.ts';
import {
  isGameBuildPath,
  readGameBuildIndex,
  validateGameBuilds,
  assertGameBuildMutation,
  type GameBuildCodec,
} from './game-build.ts';

export function createGameBuildRevision(
  input: {
    built: BuiltGameArtifact;
    artifactId: string;
    buildId: string;
    output: string;
    documents: GameBuildManifestV1['documents'];
    instructionsVersion: string;
    assetHashes: Record<string, string>;
  },
  codec: GameBuildCodec,
) {
  const { built, artifactId, buildId, output } = input,
    prefix = `.game-builds/${buildId}`;
  const lock = JSON.stringify(built.lock),
    notices = JSON.stringify(built.notices);
  const manifest: GameBuildManifestV1 = {
    version: 1,
    artifactId,
    buildId,
    entry: built.plan.entry,
    htmlTemplate: built.plan.html,
    sources: Object.entries(built.sources).map(([path, text]) => ({
      path,
      bytes: codec.byteLength(text),
      sha256: codec.digest(text),
    })),
    assets: built.plan.assets.map((a) => ({
      ...a,
      sha256: input.assetHashes[a.path],
      ...built.projectAssets?.find((asset) => asset.key === a.key),
    })),
    documents: input.documents,
    dependenciesSha256: codec.digest(lock),
    noticesSha256: codec.digest(notices),
    output: {
      pathAtCreation: output,
      bytes: codec.byteLength(built.html),
      sha256: codec.digest(built.html),
    },
    instructionsVersion: input.instructionsVersion,
    tool: {
      name: 'gamejam-standalone-builder',
      version: '1',
      sha256: built.toolsetSha256,
      profile: built.profile,
    },
  };
  return { manifest, prefix, lock, notices };
}

/** Only a fresh revision for the task's one HTML may enter the existing publication path. */
export function gameBuildPublicationPaths(
  before: Snapshot,
  after: Snapshot,
  outputs: string[],
  codec: GameBuildCodec,
): string[] {
  const changed = Object.keys({ ...before, ...after }).filter(
    (p) => isGameBuildPath(p) && before[p] !== after[p],
  );
  if (!changed.length) throw Error('게임 제작 원본이 누락되었습니다.');
  validateGameBuilds(after, codec);
  assertGameBuildMutation(before, after);
  const old = readGameBuildIndex(before),
    next = readGameBuildIndex(after);
  const target = next.artifacts.filter((a) => outputs.includes(a.path));
  if (target.length !== 1 || !changed.includes(GAME_BUILD_INDEX))
    throw Error('게임 제작 원본의 출력 연결이 일치하지 않습니다.');
  const artifact = target[0],
    prefix = `.game-builds/${artifact.buildId}/`;
  if (
    before[`${prefix}manifest.json`] !== undefined ||
    !changed.includes(`${prefix}manifest.json`) ||
    old.artifacts.some(
      (a) => a.artifactId === artifact.artifactId && a.path !== artifact.path,
    )
  )
    throw Error('새 제작 버전과 대상 게임의 식별자가 일치하지 않습니다.');
  if (
    old.artifacts.some((a) => a.buildId === artifact.buildId) ||
    changed.some(
      (p) =>
        p !== GAME_BUILD_INDEX &&
        (!p.startsWith(prefix) || before[p] !== undefined),
    ) ||
    next.artifacts.length !==
      old.artifacts.filter((a) => a.artifactId !== artifact.artifactId).length +
        1 ||
    old.artifacts.some(
      (a) =>
        a.artifactId !== artifact.artifactId &&
        !next.artifacts.some((b) => JSON.stringify(a) === JSON.stringify(b)),
    ) ||
    old.artifacts.some(
      (a) => a.path === artifact.path && a.artifactId !== artifact.artifactId,
    )
  )
    throw Error('다른 게임의 원본이나 기존 제작 버전을 변경할 수 없습니다.');
  return changed;
}
