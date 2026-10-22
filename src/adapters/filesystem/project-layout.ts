import fs from 'node:fs/promises';
import path from 'node:path';
import { RESULT_CATEGORIES } from '../../preview-output.ts';
import { initializeProjectDocument } from '../../project-metadata.ts';
import { OUTPUT_STRUCTURE_README } from '../../result-files.ts';

/** Initialize the existing desktop layout at the captured root. */
export async function ensureProjectLayout(
  root: string,
  assertCurrent: () => void = () => {},
) {
  assertCurrent();
  await Promise.all(
    [
      'ideas',
      'docs',
      '.ai/tasks',
      'sections',
      'output',
      ...Object.keys(RESULT_CATEGORIES).map((category) => `output/${category}`),
    ].map((folder) => fs.mkdir(path.join(root, folder), { recursive: true })),
  );
  assertCurrent();
  await initializeProjectDocument(root);
  assertCurrent();
  try {
    await fs.writeFile(
      path.join(root, 'output/README.md'),
      OUTPUT_STRUCTURE_README,
      { flag: 'wx' },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  assertCurrent();
}
