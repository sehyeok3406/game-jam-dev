import type {
  GameBuildDependenciesV1,
  GameBuildNoticesV1,
} from './game-build.ts';
export type GameDependencyChange =
  | { action: 'add' | 'update'; name: string; version?: string }
  | { action: 'remove'; name: string };

export const DependencyPreparationLimits = Object.freeze({
  rounds: 3,
  timeoutMs: 180_000,
  roots: 12,
  packages: 256,
  metadataBytes: 8_000_000,
  tarballBytes: 20_000_000,
  downloadBytes: 80_000_000,
  extractedBytes: 256_000_000,
  files: 20_000,
  fileBytes: 16_000_000,
  materialBytes: 160_000,
  resultBytes: 2_000_000,
});
export type DependencyRequestV1 =
  | { version: 1; action: 'research'; names: string[] }
  | {
      version: 1;
      action: 'prepare';
      packages: { name: string; version: string; reason: string }[];
      previousLock?: GameBuildDependenciesV1;
      upgrades?: string[];
      changes?: GameDependencyChange[];
    }
  | { version: 1; action: 'done'; lockSha256: string | null };
export type DependencyResearchV1 = {
  version: 1;
  action: 'research';
  packages: {
    name: string;
    description: string;
    latest: string;
    references: string[];
  }[];
};
export type PreparedDependenciesV1 = {
  version: 1;
  action: 'prepared';
  lock: GameBuildDependenciesV1;
  lockSha256: string;
  notices: GameBuildNoticesV1;
  target: { platform: string; arch: string };
  toolsetSha256: string;
  selection: { name: string; version: string; reason: string }[];
  materials: {
    specifier: string;
    version: string;
    documents: {
      source: string;
      sha256: string;
      sourceSha256: string;
      truncated: boolean;
      text: string;
    }[];
    references: string[];
  }[];
  warnings: string[];
};
export type DependencyExchangeRequestV1 = {
  version: 1;
  runId: string;
  sequence: number;
  request: DependencyRequestV1;
};
export type DependencyPreparationResult =
  | DependencyResearchV1
  | PreparedDependenciesV1;
