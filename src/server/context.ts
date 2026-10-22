import type { Project, Lock } from './project-state.ts';
import { ProjectQueue } from './services/project-queue.ts';
/** Per-server transient ownership. Pass each service only its required maps/functions. */
export function createServerContext(now: () => number = Date.now) {
  const projects = new Map<string, Project>();
  const locks = new Map<string, Map<string, Lock>>();
  const online = new Map<string, Map<string, number>>();
  const projectQueue = new ProjectQueue();
  const projectLocks = (id: string) => {
    let map = locks.get(id);
    if (!map) locks.set(id, (map = new Map()));
    for (const [relative, lock] of map)
      if (lock.expiresAt < now()) map.delete(relative);
    return map;
  };
  return { projects, locks, online, projectQueue, projectLocks };
}
