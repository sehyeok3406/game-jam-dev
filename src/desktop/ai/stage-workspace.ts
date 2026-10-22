import fs from 'node:fs/promises';
import path from 'node:path';
import type { AiStageWorkspace } from '../../application/ai/stage-workspace.ts';
import {
  captureProject,
  materialize,
  projectPath,
} from '../../project-store.ts';
import { geminiRunSettings } from '../../adapters/node/ai/gemini.ts';

/** Keep the existing history workspace/input format and per-run Gemini settings. */
export async function fileStageWorkspace(
  root: string,
  runId: string,
): Promise<AiStageWorkspace> {
  const directory = await projectPath(root, `.history/${runId}/workspace`);
  const input = await projectPath(root, `.history/${runId}/input`);
  return {
    directory,
    async initialize(files) {
      await fs.mkdir(directory, { recursive: true });
      await fs.mkdir(input, { recursive: true });
      await materialize(directory, files);
      await materialize(input, files);
    },
    capture: () => captureProject(directory),
    async write(relative, content) {
      await fs.writeFile(
        await projectPath(directory, relative),
        content,
        'utf8',
      );
    },
    async configure(provider, model, effort) {
      if (provider !== 'gemini-cli') return;
      await fs.mkdir(path.join(directory, '.gemini'), { recursive: true });
      await fs.writeFile(
        path.join(directory, '.gemini', 'settings.json'),
        JSON.stringify(geminiRunSettings(model, effort)),
      );
    },
  };
}
