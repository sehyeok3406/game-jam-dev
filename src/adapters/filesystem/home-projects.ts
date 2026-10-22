import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HomeLocalProjects } from '../../application/ports/home-projects.ts';
import { localProjectName, saveProjectName } from '../../project-metadata.ts';
import { localProjectTimestamps } from '../../project-timestamps.ts';
import { projectPath, historyId, saveHistory } from '../../project-store.ts';
import matter from '../../markdown.ts';

/** Existing project.md compare/replace and history format; grouping never moves this directory. */
export const filesystemHomeProjects: HomeLocalProjects = {
  name: localProjectName,
  timestamps: localProjectTimestamps,
  async directory(root) {
    const real = await fs.realpath(root);
    if (!(await fs.stat(real)).isDirectory())
      throw Error('프로젝트 폴더를 찾을 수 없습니다.');
    return real;
  },
  async create(parent, name) {
    const target = path.join(await fs.realpath(parent), name);
    try {
      await fs.mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw Error(
          '같은 이름의 폴더가 이미 있습니다. 다른 프로젝트 이름을 입력하거나 기존 폴더를 열어주세요.',
        );
      throw error;
    }
    return target;
  },
  async rename(inputRoot, name, expectedName) {
    const root = await fs.realpath(inputRoot);
    const filename = await projectPath(root, 'project.md');
    const raw = await fs
      .readFile(filename, 'utf8')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
    const previousName = await localProjectName(root);
    if (
      expectedName !== undefined &&
      expectedName !== previousName &&
      name !== previousName
    )
      throw Error(
        '프로젝트 이름이 바뀌었습니다. 목록을 새로고침하고 다시 확인해주세요.',
      );
    if (raw !== null) {
      const parsed = matter(raw);
      parsed.data.project_name = name;
      parsed.data.title = name;
      const next = matter.stringify(parsed.content, parsed.data);
      if (next !== raw) {
        const temporary = `${filename}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, next, { flag: 'wx' });
          if ((await fs.readFile(filename, 'utf8')) !== raw)
            throw Error(
              '프로젝트 문서가 변경되었습니다. 목록을 새로고침하고 다시 시도해주세요.',
            );
          await fs.rename(temporary, filename);
        } finally {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
        await saveHistory(
          root,
          { 'project.md': raw },
          { 'project.md': next },
          {
            id: historyId(),
            label: `프로젝트 이름 변경 · ${previousName} → ${name}`,
            kind: 'user',
            status: 'completed',
            createdAt: Date.now(),
            finishedAt: Date.now(),
          },
        );
      }
    }
    await saveProjectName(root, name);
  },
};
