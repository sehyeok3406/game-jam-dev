type Waiter = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
type Pending = { operation: () => Promise<unknown>; waiters: Waiter[] };
/** Keep an in-flight operation immutable and compact only unsent property changes. */
export class PropertyQueue {
  private pending = new Map<string, Pending>();
  private running = new Map<string, Promise<void>>();
  submit(key: string, operation: () => Promise<unknown>): Promise<unknown> {
    const promise = new Promise((resolve, reject) => {
      const pending = this.pending.get(key);
      this.pending.set(key, {
        operation,
        waiters: [...(pending?.waiters ?? []), { resolve, reject }],
      });
    });
    if (!this.running.has(key)) this.start(key);
    return promise;
  }
  private start(key: string) {
    const drain = async () => {
      while (this.pending.has(key)) {
        const item = this.pending.get(key)!;
        this.pending.delete(key);
        try {
          const value = await item.operation();
          for (const waiter of item.waiters) waiter.resolve(value);
        } catch (error) {
          for (const waiter of item.waiters) waiter.reject(error);
        }
      }
    };
    const running = Promise.resolve()
      .then(drain)
      .finally(() => {
        this.running.delete(key);
        if (this.pending.has(key)) this.start(key);
      });
    this.running.set(key, running);
  }
  async flush() {
    while (this.running.size) await Promise.all(this.running.values());
  }
}
