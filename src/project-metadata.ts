import fs from 'node:fs/promises';
import path from 'node:path';
import matter from './markdown.ts';
import { projectPath } from './project-store.ts';

const metadataPath = '.canvas/project.json';

export async function saveProjectName(root: string, name: string) {
  const absolute = await projectPath(root, metadataPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, JSON.stringify({ name }), 'utf8');
}

export async function localProjectName(root: string) {
  try {
    const data = matter(
      await fs.readFile(await projectPath(root, 'project.md'), 'utf8'),
    ).data;
    if (typeof data.project_name === 'string' && data.project_name.trim())
      return data.project_name.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    const data = JSON.parse(
      await fs.readFile(await projectPath(root, metadataPath), 'utf8'),
    );
    if (typeof data.name === 'string' && data.name.trim()) return data.name;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return path.basename(root);
}

/** The marker separates first-time setup from reopening after document deletion. */
export async function initializeProjectDocument(root: string) {
  try {
    await fs.access(await projectPath(root, metadataPath));
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const name = await localProjectName(root);
  const projectFile = await projectPath(root, 'project.md');
  try {
    await fs.access(projectFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(
      projectFile,
      matter.stringify(
        `\n# ${name}\n\n게임 아이디어를 자유롭게 기록해보세요.\n`,
        {
          id: 'project',
          title: name,
          type: 'overview',
          status: 'draft',
          x: 80,
          y: 80,
          width: 360,
          height: 320,
          sources: [],
        },
      ),
      'utf8',
    );
  }
  await saveProjectName(root, name);
}
