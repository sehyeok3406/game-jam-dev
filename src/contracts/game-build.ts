import { ServerLimits } from './server-limits.ts';
/** Durable UTF-8 project data. Download caches and executable tools are never snapshots. */
export const GAME_BUILDS_DIRECTORY = '.game-builds';
export const GAME_BUILD_INDEX = '.game-builds/index.json';
export const GameBuildLimits = Object.freeze({
  storageVersion: 1,
  files: ServerLimits.files,
  htmlBytes: ServerLimits.htmlBytes,
  assetEncodedBytes: ServerLimits.assetEncodedBytes,
  sourceBytes: 2_000_000,
  sourceFiles: 64,
  sourceBundleBytes: 16_000_000,
  metadataBytes: 2_000_000,
  snapshotBytes: 64_000_000,
  requestBytes: 72_000_000,
});
export type GameBuildIndexV1 = {
  version: 1;
  artifacts: { artifactId: string; buildId: string; path: string }[];
};
export type GameBuildManifestV1 = {
  version: 1;
  artifactId: string;
  buildId: string;
  entry: string;
  /** Set by source builder v1; absent on early storage-only revisions. */
  htmlTemplate?: string;
  sources: { path: string; bytes: number; sha256: string }[];
  /** Asset hashes cover the existing encoded snapshot representation. */
  assets: { key: string; path: string; sha256: string }[];
  /** Historical input facts; users can subsequently edit/delete the documents. */
  documents: {
    path: string;
    id: string;
    sha256: string;
    designSha256?: string;
  }[];
  dependenciesSha256: string;
  noticesSha256: string;
  output: { pathAtCreation: string; bytes: number; sha256: string };
  instructionsVersion: string;
  tool: { name: string; version: string; sha256: string; profile: string };
};
export type GameBuildDependenciesV1 = {
  version: 1;
  roots: Record<string, string>;
  packages: {
    key: string;
    name: string;
    version: string;
    resolved: string;
    integrity: string;
    dependencies: string[];
    license: string;
  }[];
};
export type GameBuildNoticesV1 = {
  version: 1;
  packages: { key: string; license: string; text: string }[];
};
/** Self-host policy, independent of technical transport limits and future billing. */
export type ProjectStoragePolicy = { maxProjectBytes?: number };
