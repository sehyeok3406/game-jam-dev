import type { Snapshot } from '../../contracts/project.ts';
import type {
  BuiltGameArtifact,
  CompiledGame,
  GeneratedGameSource,
} from '../../contracts/game-build-execution.ts';
import type { PreparedDependenciesV1 } from '../../contracts/dependency-preparation.ts';
import type {
  GameBuildDependenciesV1,
  GameBuildProjectAsset,
} from '../../contracts/game-build.ts';
import type { PreparedAiRun, AiProcessEvent } from './ai-executor.ts';

export type GameBuildExecutionInput = {
  prepared: PreparedAiRun;
  specification: string;
  inputs: Snapshot;
  projectAssets?: (GameBuildProjectAsset & { name: string })[];
  previousLock?: GameBuildDependenciesV1;
  /** Editable copy of the selected revision; durable originals remain read-only. */
  previousSource?: GeneratedGameSource;
  previousDocuments?: {
    path: string;
    currentPath?: string;
    id: string;
    sha256: string;
    currentSha256: string | null;
    identityMatches: boolean;
  }[];
};
export type GameBuildExecutionPort = {
  execute(
    input: GameBuildExecutionInput,
    signal: AbortSignal,
    emit: (event: AiProcessEvent) => void,
  ): Promise<BuiltGameArtifact>;
};
export type GameDependencySession = {
  run(signal: AbortSignal): Promise<PreparedDependenciesV1 | null>;
  workspace(): string;
  close(): Promise<void>;
};

/** Fixed preparation → source → build sequence; publication remains in AiRunService. */
export function createGameBuildExecution(ports: {
  preparation(input: GameBuildExecutionInput): GameDependencySession;
  generate(
    input: GameBuildExecutionInput,
    dependencies: PreparedDependenciesV1 | null,
    signal: AbortSignal,
    emit: (event: AiProcessEvent) => void,
  ): Promise<GeneratedGameSource>;
  compile(
    source: GeneratedGameSource,
    inputs: Snapshot,
    dependencies: PreparedDependenciesV1 | null,
    dependencyRoot: string | null,
    signal: AbortSignal,
    projectAssets?: readonly GameBuildProjectAsset[],
  ): Promise<CompiledGame>;
  assertCurrent(): void;
  progress(message: string): void;
}): GameBuildExecutionPort {
  return {
    async execute(input, signal, emit) {
      const check = () => {
        signal.throwIfAborted();
        ports.assertCurrent();
      };
      check();
      const session = ports.preparation(input);
      try {
        ports.progress('게임 제작 · 라이브러리 조사와 버전 고정');
        const dependencies = await session.run(signal);
        check();
        if (
          input.previousLock &&
          JSON.stringify(
            dependencies?.lock ?? { version: 1, roots: {}, packages: [] },
          ) !== JSON.stringify(input.previousLock)
        )
          throw Error('기존 게임의 고정 라이브러리 버전을 유지해야 합니다.');
        ports.progress('게임 제작 · 보존할 소스 작성');
        const source = await ports.generate(input, dependencies, signal, emit);
        check();
        ports.progress(
          input.projectAssets?.length
            ? '게임 제작 · 프로젝트 에셋을 연결한 HTML 빌드'
            : '게임 제작 · 라이브러리와 이미지 내장 HTML 빌드',
        );
        const compiled = await ports.compile(
          source,
          input.inputs,
          dependencies,
          dependencies ? session.workspace() : null,
          signal,
          input.projectAssets,
        );
        check();
        return {
          ...source,
          ...compiled,
          lock: dependencies?.lock ?? { version: 1, roots: {}, packages: [] },
          notices: dependencies?.notices ?? { version: 1, packages: [] },
        };
      } finally {
        await session.close();
      }
    },
  };
}
