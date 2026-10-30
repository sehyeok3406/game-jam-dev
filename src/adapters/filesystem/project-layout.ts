import fs from 'node:fs/promises';
import { initializeProjectDocument } from '../../project-metadata.ts';
import { projectPath } from '../../project-store.ts';

/** Prepare user folders and project metadata without creating a canvas document. */
export async function ensureProjectLayout(
  root: string,
  assertCurrent: () => void = () => {},
) {
  assertCurrent();
  await Promise.all(
    ['docs', 'output', 'assets/images'].map(async (folder) =>
      fs.mkdir(await projectPath(root, folder), { recursive: true }),
    ),
  );
  assertCurrent();
  await initializeProjectDocument(root);
  assertCurrent();
}
