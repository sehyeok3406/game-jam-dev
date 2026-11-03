import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  GeneratedGameSource,
  CompiledGame,
} from '../../../contracts/game-build-execution.ts';
import type { PreparedDependenciesV1 } from '../../../contracts/dependency-preparation.ts';
import type { Snapshot } from '../../../contracts/project.ts';
import { GameBuildLimits } from '../../../contracts/game-build.ts';
import { verifyGameBuildRuntime } from './engine.ts';
import { runGameTool } from './tool-process.ts';
import { decodeAsset, isAssetPath } from '../../../file-assets.ts';
import { validateGameBuildSource } from '../../../core/ai/game-build-source.ts';

export async function compileStandaloneGame(
  options: { runtime: string; cacheRoot: string; assertCurrent(): void },
  source: GeneratedGameSource,
  inputs: Snapshot,
  dependencies: PreparedDependenciesV1 | null,
  dependencyRoot: string | null,
  signal: AbortSignal,
): Promise<CompiledGame> {
  signal.throwIfAborted();
  options.assertCurrent();
  validateGameBuildSource(
    source.plan,
    source.sources,
    inputs,
    Buffer.byteLength,
  );
  const runtime = await verifyGameBuildRuntime(options.runtime, signal);
  if (dependencies && dependencies.toolsetSha256 !== runtime.sha256)
    throw Error('준비 단계와 빌드 단계의 도구 묶음이 다릅니다.');
  await fs.mkdir(options.cacheRoot, { recursive: true });
  if ((await fs.lstat(options.cacheRoot)).isSymbolicLink())
    throw Error('빌드 캐시의 링크는 허용하지 않습니다.');
  const cache = await fs.realpath(options.cacheRoot),
    directory = await fs.mkdtemp(path.join(cache, '.work-'));
  const cleanup = async () => {
    if (
      path.dirname(directory) !== cache ||
      (await fs.lstat(directory)).isSymbolicLink() ||
      (await fs.realpath(directory)) !== directory
    )
      throw Error('빌드 폴더 정리 경로가 변경되었습니다.');
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  };
  try {
    const assets = Object.fromEntries(
      source.plan.assets.map((a) => {
        if (!isAssetPath(a.path)) throw Error('빌드 이미지 경로 오류');
        decodeAsset(a.path, inputs[a.path]);
        return [a.key, inputs[a.path]];
      }),
    );
    await fs.writeFile(
      path.join(directory, 'build-input.json'),
      JSON.stringify({
        source,
        assets,
        dependencyRoot,
        lock: dependencies?.lock ?? { version: 1, roots: {}, packages: [] },
        notices: dependencies?.notices ?? { version: 1, packages: [] },
        toolsetSha256: runtime.sha256,
      }),
    );
    const response = JSON.parse(
      await runGameTool(
        {
          runtime: runtime.directory,
          worker: 'builder.mjs',
          jobRoot: directory,
          payload: {},
          outputBytes:
            GameBuildLimits.htmlBytes * 2 + GameBuildLimits.metadataBytes,
          timeoutMs: 60_000,
        },
        signal,
      ),
    ) as { result?: CompiledGame; error?: { message: string } };
    signal.throwIfAborted();
    options.assertCurrent();
    if (response.error) throw Error(response.error.message);
    if (
      !response.result ||
      response.result.profile !== 'standalone-browser-v1' ||
      response.result.toolsetSha256 !== runtime.sha256 ||
      typeof response.result.html !== 'string' ||
      Buffer.byteLength(response.result.html) > GameBuildLimits.htmlBytes
    )
      throw Error('게임 빌드 결과 형식·한도 오류');
    return response.result;
  } finally {
    await cleanup();
  }
}
