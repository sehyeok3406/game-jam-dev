import type { Snapshot } from '../../contracts/project.ts';
import { projectDirectoryName } from './project-name.ts';
import { PROJECT_LAYOUT_PATH } from '../../contracts/project-layout.ts';

export function initialProjectSnapshot(input: string): Snapshot {
  projectDirectoryName(input);
  return {
    [PROJECT_LAYOUT_PATH]: JSON.stringify({ version: 2, aliases: {} }),
  };
}
