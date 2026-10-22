import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { materialize } from '../../project-store.ts';
import type { Project } from '../project-state.ts';

/** File recovery export has no authority over the committed SQLite project. */
export function createCheckpointStore(root: string) {
  const folder = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new Error('프로젝트 ID가 올바르지 않습니다.');
    return path.join(root, id);
  };
  return {
    async exists(id: string) {
      try {
        await fs.stat(path.join(folder(id), 'head.json'));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    async runtime(project: Project) {
      const directory = folder(project.id);
      await fs.mkdir(directory, { recursive: true });
      const temporary = path.join(directory, 'runtime.tmp');
      await fs.writeFile(
        temporary,
        JSON.stringify({
          revision: project.revision,
          job: project.job
            ? { id: project.job.id, expiresAt: project.job.expiresAt }
            : null,
        }),
        { mode: 0o600 },
      );
      await fs.rename(temporary, path.join(directory, 'runtime.json'));
    },
    async write(project: Project) {
      if (project.lifecycle && project.lifecycle.status !== 'active') return;
      const directory = folder(project.id),
        checkpoint = randomUUID();
      const target = path.join(directory, 'checkpoints', checkpoint);
      await fs.mkdir(path.join(target, 'files'), { recursive: true });
      await materialize(path.join(target, 'files'), project.files);
      await fs.writeFile(
        path.join(target, 'state.json'),
        JSON.stringify(project),
        { mode: 0o600 },
      );
      const temporary = path.join(directory, `head-${checkpoint}.tmp`);
      await fs.writeFile(temporary, JSON.stringify({ checkpoint }), {
        mode: 0o600,
      });
      await fs.rename(temporary, path.join(directory, 'head.json'));
    },
    async recover(id: string): Promise<Project> {
      const directory = folder(id);
      const head = JSON.parse(
        await fs.readFile(path.join(directory, 'head.json'), 'utf8'),
      );
      if (!/^[a-f0-9-]{36}$/.test(head.checkpoint))
        throw new Error('Invalid checkpoint');
      const project: Project = JSON.parse(
        await fs.readFile(
          path.join(directory, 'checkpoints', head.checkpoint, 'state.json'),
          'utf8',
        ),
      );
      if (
        project.id !== id ||
        (project.lifecycle && project.lifecycle.status !== 'active')
      )
        throw new Error(
          '프로젝트 복구 자료의 식별자나 수명이 올바르지 않습니다.',
        );
      const stat = await fs.stat(directory);
      project.createdAt ??= stat.birthtimeMs > 0 ? stat.birthtimeMs : undefined;
      project.modifiedAt ??=
        project.history.at(-1)?.entry.finishedAt ??
        project.history.at(-1)?.entry.createdAt ??
        project.createdAt;
      return project;
    },
  };
}
