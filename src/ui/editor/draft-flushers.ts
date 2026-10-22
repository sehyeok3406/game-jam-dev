/** One workspace session owns its draft callbacks; old cleanup cannot remove a replacement. */
export class DraftFlusherRegistry {
  private callbacks = new Map<string, () => Promise<void>>();
  register(key: string, callback: () => Promise<void>) {
    this.callbacks.set(key, callback);
    return () => {
      if (this.callbacks.get(key) === callback) this.callbacks.delete(key);
    };
  }
  async flush() {
    await Promise.all(
      [...this.callbacks.values()].map((callback) => callback()),
    );
  }
}
