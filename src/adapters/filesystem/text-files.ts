import fs from 'node:fs/promises';
import type { ProjectTextFiles } from '../../application/ports/text-files.ts';
import { projectPath } from '../../project-store.ts';
import { filesystemProjectRepository } from './local-project-repository.ts';
export function filesystemTextFiles(
  root: string,
  assertCurrent: () => void,
): ProjectTextFiles {
  return {
    read: async (relative) => {
      assertCurrent();
      const absolute = await projectPath(root, relative);
      const raw = await fs.readFile(absolute, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      assertCurrent();
      return raw;
    },
    replace: (relative, expected, raw) =>
      filesystemProjectRepository(root, assertCurrent).apply(
        expected === null ? {} : { [relative]: expected },
        { [relative]: raw },
      ),
  };
}
