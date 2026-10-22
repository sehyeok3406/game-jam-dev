/** Per-project FIFO. Callers observe failures; a failed job never poisons its tail. */
export class ProjectQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.tails.get(projectId) ?? Promise.resolve()).then(
      operation,
    );
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(projectId, tail);
    void tail.then(() => {
      // A completed job must not release a successor already queued for this project.
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId);
    });
    return next;
  }

  /** Drain the accepted tails, as at the existing server shutdown boundary. */
  async drain(): Promise<void> {
    await Promise.all(this.tails.values());
  }
}
