export const sameContentRevision = (
  a: readonly unknown[],
  b: readonly unknown[],
) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

type Cached = { revision: readonly unknown[]; value: unknown; bytes: number };

/** Recent prepared values, not document state or a DOM cache. Costs are estimates. */
export class CanvasContentCache {
  private entries = new Map<string, Cached>();
  private listeners = new Map<string, Set<() => void>>();
  private versions = new Map<string, number>();
  private sequence = 0;
  private bytes = 0;
  private builds = 0;
  private pins = new Map<string, Set<symbol>>();
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(maxEntries = 128, maxBytes = 32 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  peek<T>(key: string, revision: readonly unknown[]): T | undefined {
    const entry = this.entries.get(key);
    return entry && sameContentRevision(entry.revision, revision)
      ? (entry.value as T)
      : undefined;
  }

  touch(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
  }

  put<T>(key: string, revision: readonly unknown[], value: T, bytes: number) {
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(key);
    }
    const cost = Number.isFinite(bytes)
      ? Math.max(0, bytes)
      : this.maxBytes + 1;
    this.builds++;
    if (cost <= this.maxBytes) {
      this.entries.set(key, { revision: [...revision], value, bytes: cost });
      this.bytes += cost;
    }
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldKey =
        [...this.entries.keys()].find((key) => !this.pins.has(key)) ??
        this.entries.keys().next().value!;
      const entry = this.entries.get(oldKey)!;
      this.entries.delete(oldKey);
      this.bytes -= entry.bytes;
      this.signal(oldKey);
    }
    this.signal(key);
  }

  version(key: string) {
    return this.versions.get(key) ?? 0;
  }
  pin(key: string) {
    const owner = Symbol(key);
    let owners = this.pins.get(key);
    if (!owners) this.pins.set(key, (owners = new Set()));
    owners.add(owner);
    return () => {
      owners.delete(owner);
      if (!owners.size && this.pins.get(key) === owners) this.pins.delete(key);
    };
  }
  signal(key: string) {
    this.versions.set(key, ++this.sequence);
    for (const callback of this.listeners.get(key) ?? []) callback();
    if (!this.listeners.has(key) && !this.entries.has(key))
      this.versions.delete(key);
  }
  subscribe(key: string, callback: () => void) {
    let listeners = this.listeners.get(key);
    if (!listeners) this.listeners.set(key, (listeners = new Set()));
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
      if (!listeners.size && this.listeners.get(key) === listeners) {
        this.listeners.delete(key);
        if (!this.entries.has(key)) this.versions.delete(key);
      }
    };
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
    for (const key of this.listeners.keys()) this.signal(key);
    for (const key of this.versions.keys())
      if (!this.listeners.has(key)) this.versions.delete(key);
  }
  getStatus() {
    return {
      entries: this.entries.size,
      estimatedBytes: this.bytes,
      builds: this.builds,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }
}
