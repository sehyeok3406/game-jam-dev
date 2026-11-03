import fs from 'node:fs/promises';
import path from 'node:path';
import type { AiExecutor } from '../../src/application/ai/ai-executor.ts';
import type { GameBuildExecutionPort } from '../../src/application/ai/game-build-execution.ts';
import { expectedArtifacts } from '../../src/ai-artifacts.ts';

/** Main/IPC compatibility harness only; portable and packaged suites use the real compiler. */
export function desktopGameBuildExecution(options: {
  executor: AiExecutor;
  assertCurrent(): void;
}): GameBuildExecutionPort {
  return {
    async execute(input, signal, emit) {
      signal.throwIfAborted();
      options.assertCurrent();
      const result = await options.executor.run(input.prepared, signal, emit);
      if (result.code !== 0 || result.error)
        throw result.error ?? Error('mock source execution failed');
      options.assertCurrent();
      signal.throwIfAborted();
      const output = expectedArtifacts(input.specification).find((p) =>
        p.endsWith('.html'),
      )!;
      const html = await fs.readFile(
        path.join(input.prepared.stage, output),
        'utf8',
      );
      return {
        plan: {
          version: 1,
          entry: 'main.js',
          html: 'index.html',
          files: ['main.js', 'index.html'],
          assets: [],
        },
        sources: {
          'main.js': 'document.body.dataset.mock="ready";',
          'index.html':
            '<!doctype html><html><body><canvas></canvas><script type="module" src="./main.js"></script></body></html>',
        },
        html,
        lock: { version: 1, roots: {}, packages: [] },
        notices: { version: 1, packages: [] },
        profile: 'standalone-browser-v1',
        toolsetSha256: 'f'.repeat(64),
      };
    },
  };
}
