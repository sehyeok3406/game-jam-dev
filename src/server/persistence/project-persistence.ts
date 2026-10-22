import type { CollaborationProjectRepository } from '../../application/ports/collaboration-project-repository.ts';
import type { Project } from '../project-state.ts';
import type { createCheckpointStore } from './checkpoint-store.ts';
import type { createLifecycleStore } from './lifecycle-store.ts';

type Ports = {
  repository: CollaborationProjectRepository<Project>;
  projects: Map<string, Project>;
  checkpoints: ReturnType<typeof createCheckpointStore>;
  lifecycle: Awaited<ReturnType<typeof createLifecycleStore>>;
  committed: (id: string) => void;
  recoveryError: (id: string, phase: string) => void;
};
/** Publish after commit. Recovery export errors cannot turn a durable success
 * into a failed command (or cause a caller to retry it with another ID).
 */
export function createProjectPersistence(ports: Ports) {
  const dirty = new Set<string>();
  const jobs = new Map<string, Promise<void>>();
  const failures = new Map<string, string>();
  const recover = async (project: Project, initial: boolean) => {
    if (project.lifecycle && project.lifecycle.status !== 'active') return;
    await ports.checkpoints.runtime(project);
    if (initial && (await ports.checkpoints.exists(project.id))) return;
    await ports.checkpoints.write(project);
    if (ports.projects.get(project.id) === project) {
      dirty.delete(project.id);
      failures.delete(project.id);
    }
  };
  const enqueue = (project: Project, initial = false) => {
    const pending = (jobs.get(project.id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => recover(project, initial));
    jobs.set(project.id, pending);
    void pending
      .finally(() => {
        if (jobs.get(project.id) === pending) jobs.delete(project.id);
      })
      .catch(() => undefined);
    return pending;
  };
  const exportCheckpoint = (project: Project) => enqueue(project);
  const report = (id: string, phase: string) => {
    failures.set(id, phase);
    ports.recoveryError(id, phase);
  };
  return {
    async persist(project: Project) {
      await ports.repository.commit(project);
      ports.projects.set(project.id, project);
      if (project.lifecycle) {
        try {
          await ports.lifecycle.save(
            project.id,
            project.lifecycle.status,
            project.lifecycle.version,
          );
        } catch {
          report(project.id, 'lifecycle');
        }
      }
      if (project.lifecycle && project.lifecycle.status !== 'active') {
        dirty.delete(project.id);
      } else {
        dirty.add(project.id);
        try {
          await enqueue(project, true);
        } catch {
          report(project.id, 'checkpoint');
        }
      }
      ports.committed(project.id);
    },
    exportCheckpoint,
    wait: async (id: string) => {
      await jobs.get(id)?.catch(() => undefined);
    },
    track: (project: Project) => {
      if (!project.lifecycle || project.lifecycle.status === 'active')
        dirty.add(project.id);
    },
    forget: (id: string) => {
      dirty.delete(id);
      failures.delete(id);
    },
    exportDirty() {
      void ports.lifecycle.flush().catch(() => report('pending', 'lifecycle'));
      for (const id of dirty) {
        const project = ports.projects.get(id);
        if (project && !jobs.has(id))
          void exportCheckpoint(project).catch(() => report(id, 'checkpoint'));
      }
    },
    waitAll: async () => {
      await Promise.allSettled(jobs.values());
    },
    quiesce: async () => {
      await Promise.allSettled(jobs.values());
      await ports.lifecycle.waitAll();
    },
    async flush() {
      await ports.lifecycle.flush();
      for (const id of dirty) {
        const project = ports.projects.get(id);
        if (project) await exportCheckpoint(project);
      }
    },
    failures: () => new Map(failures),
  };
}
