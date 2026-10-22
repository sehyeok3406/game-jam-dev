import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from '../../trash-files.ts';

export type LifecycleMarker = { status: string; version: number };
/** Recovery guards supplement DB tombstones; failed writes remain retryable. */
export async function createLifecycleStore(root: string) {
  const markers = new Map<string, LifecycleMarker>();
  const pending = new Map<string, LifecycleMarker>();
  const jobs = new Map<string, Promise<void>>();
  const folder = path.join(root, '.project-lifecycle');
  const entries = await fs
    .readdir(folder)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  for (const file of entries) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    const marker = JSON.parse(
      await fs.readFile(path.join(folder, file), 'utf8'),
    );
    if (
      typeof marker.status !== 'string' ||
      !Number.isSafeInteger(marker.version)
    )
      throw new Error('프로젝트 수명 복구 표식이 올바르지 않습니다.');
    markers.set(file.slice(0, -5), marker);
  }
  const write = (id: string, marker: LifecycleMarker) => {
    const job = (jobs.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (pending.get(id) !== marker) return;
        await atomicJson(path.join(folder, `${id}.json`), marker);
        if (pending.get(id) === marker) pending.delete(id);
      });
    jobs.set(id, job);
    void job
      .finally(() => {
        if (jobs.get(id) === job) jobs.delete(id);
      })
      .catch(() => undefined);
    return job;
  };
  return {
    get: (id: string) => markers.get(id),
    async save(id: string, status: string, version: number) {
      if (!/^[a-f0-9-]{36}$/.test(id))
        throw new Error('프로젝트 ID가 올바르지 않습니다.');
      const marker = { status, version };
      markers.set(id, marker);
      pending.set(id, marker);
      await write(id, marker);
    },
    async flush() {
      for (const [id, marker] of pending) await write(id, marker);
    },
    pending: () => pending.size,
    waitAll: async () => {
      await Promise.allSettled(jobs.values());
    },
  };
}
