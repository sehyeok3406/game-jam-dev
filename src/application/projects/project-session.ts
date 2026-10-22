import type { ProjectSessionRef } from '../../contracts/project-session.ts';

export type ProjectContext = {
  ref: ProjectSessionRef;
  mode: 'local' | 'shared';
  projectId: string;
  workspaceId?: string;
  signal: AbortSignal;
};
export type SessionDisposer = () => void | Promise<unknown>;

/** Owns cancellation and subscriptions; released resources cannot be released twice. */
export class ProjectSession {
  private controller = new AbortController();
  private resources = new Map<string, SessionDisposer>();
  private closing?: Promise<void>;
  readonly context: ProjectContext;

  constructor(
    ref: ProjectSessionRef,
    mode: ProjectContext['mode'],
    projectId: string,
  ) {
    this.context = {
      ref: Object.freeze({ ...ref }),
      mode,
      projectId,
      signal: this.controller.signal,
    };
  }
  own(key: string, dispose: SessionDisposer) {
    if (this.controller.signal.aborted)
      throw Error('프로젝트 세션이 종료되었습니다.');
    if (this.resources.has(key))
      throw Error(`프로젝트 자원이 이미 등록되어 있습니다: ${key}`);
    this.resources.set(key, dispose);
  }
  release(key: string) {
    this.resources.delete(key);
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.controller.abort();
    const resources = [...this.resources.values()].reverse();
    this.resources.clear();
    this.closing = (async () => {
      const failures: unknown[] = [];
      for (const dispose of resources) {
        try {
          await dispose();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          '프로젝트 자원을 정리하지 못했습니다.',
        );
    })();
    return this.closing;
  }
}
