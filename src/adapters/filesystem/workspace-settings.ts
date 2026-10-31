import fs from 'node:fs/promises';
import { atomicJson, canonical } from '../../trash-files.ts';

export async function relocateWorkspaceSettings(
  filename: string,
  from: string,
  to: string,
) {
  const settings = await fs
    .readFile(filename, 'utf8')
    .then(JSON.parse)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (
    typeof settings?.workspaceRoot === 'string' &&
    canonical(settings.workspaceRoot) === canonical(from)
  )
    await atomicJson(filename, { ...settings, workspaceRoot: to });
}
