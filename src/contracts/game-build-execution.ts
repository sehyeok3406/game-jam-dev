import type { Snapshot } from './project.ts';
export const GAME_ASSET_ORIGIN = 'gamejam-media://game-assets';
export const GAME_ASSET_BOOTSTRAP =
  '<script id="gamejam-project-assets"></script>';
import type {
  GameBuildDependenciesV1,
  GameBuildNoticesV1,
  GameBuildAssetReference,
} from './game-build.ts';

/** Private AI exchange, distinct from public Markdown/HTML expected_outputs. */
export type GameBuildSourceV1 = {
  version: 1;
  entry: string;
  html: string;
  files: string[];
  assets: { key: string; path: string }[];
};
export type GeneratedGameSource = {
  plan: GameBuildSourceV1;
  sources: Snapshot;
};
export type CompiledGame = {
  html: string;
  toolsetSha256: string;
  profile: 'standalone-browser-v1' | 'local-assets-browser-v1';
  projectAssets?: GameBuildAssetReference[];
};
export type BuiltGameArtifact = GeneratedGameSource &
  CompiledGame & {
    lock: GameBuildDependenciesV1;
    notices: GameBuildNoticesV1;
  };
