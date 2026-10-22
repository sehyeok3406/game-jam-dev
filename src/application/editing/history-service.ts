import type { LocalProjectRepository } from '../ports/local-project-repository.ts';

export class LocalHistoryService {
  private repository: LocalProjectRepository;
  private pause: () => Promise<() => Promise<void>>;
  constructor(
    repository: LocalProjectRepository,
    pause: () => Promise<() => Promise<void>>,
  ) {
    this.repository = repository;
    this.pause = pause;
  }
  list() {
    return this.repository.history();
  }
  read(id: string, relative: string, version: 'before' | 'after') {
    return this.repository.readHistory(id, relative, version);
  }
  async restore(id: string, relative?: string, version?: 'before' | 'after') {
    const resume = await this.pause();
    try {
      return await this.repository.restoreHistory(id, relative, version);
    } finally {
      await resume();
    }
  }
}
