import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  isPlayCode,
  playDetails,
  playFailure,
  type PlayFailure,
} from './errors.ts';

export const diagnosticRef = (id?: string) =>
  id ? createHash('sha256').update(id).digest('hex').slice(0, 16) : undefined;
export type PlayDiagnosticRecord = {
  failure: PlayFailure;
  count: number;
  lastAt: string;
};
/** Bounded local records. Never writes messages, stacks, paths, HTML, tokens or states. */
export class PlayDiagnostics {
  private file: string;
  readonly version: string;
  private entries: PlayDiagnosticRecord[] = [];
  private ready: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private pending = false;
  private available = true;
  constructor(file: string, version: string) {
    this.file = file;
    this.version = version;
    this.ready = this.load();
  }
  private async load() {
    try {
      if ((await fs.stat(this.file)).size > 1_000_000) throw Error('Too large');
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!Array.isArray(value.entries)) throw Error('Invalid diagnostics');
      const old = value.entries
        .slice(-200)
        .filter((e: PlayDiagnosticRecord) => isPlayCode(e?.failure?.code))
        .map((e: PlayDiagnosticRecord) => ({
          failure: playFailure(e.failure),
          count:
            Number.isSafeInteger(e.count) && e.count > 0
              ? Math.min(e.count, 1_000_000)
              : 1,
          lastAt: playFailure(e.failure).at,
        }));
      this.entries = [...old, ...this.entries].slice(-200);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.available = false;
        const failure = playFailure({ code: 'GC-MP-028' });
        this.entries.push({ failure, count: 1, lastAt: failure.at });
      }
    }
  }
  record(
    error: unknown,
    fallback: Parameters<typeof playFailure>[1] = 'GC-MP-029',
    details: unknown = {},
  ) {
    const failure = playFailure(error, fallback, details);
    const known = this.entries.find((e) => e.failure.id === failure.id);
    if (known) return known.failure;
    const last = this.entries.at(-1);
    if (
      last &&
      last.failure.code === failure.code &&
      JSON.stringify(last.failure.details) ===
        JSON.stringify(failure.details) &&
      Date.now() - Date.parse(last.lastAt) < 2000
    ) {
      last.count = Math.min(last.count + 1, 1_000_000);
      last.lastAt = failure.at;
      this.schedule();
      return last.failure;
    }
    this.entries.push({ failure, count: 1, lastAt: failure.at });
    if (this.entries.length > 200) this.entries.shift();
    this.schedule();
    return failure;
  }
  private schedule() {
    if (this.pending) return;
    this.pending = true;
    this.queue = this.queue.then(async () => {
      await this.ready;
      this.pending = false;
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = this.file + '.tmp';
        await fs.writeFile(
          temporary,
          JSON.stringify({ schema: 1, entries: this.entries }),
        );
        await fs.rename(temporary, this.file);
        this.available = true;
      } catch {
        if (this.available) {
          const failure = playFailure(
            { code: 'GC-MP-028' },
            'GC-MP-028',
            this.entries.at(-1)?.failure.details,
          );
          this.entries.push({ failure, count: 1, lastAt: failure.at });
          this.entries = this.entries.slice(-200);
        }
        this.available = false;
      }
    });
  }
  async flush() {
    await this.ready;
    let pending;
    do {
      pending = this.queue;
      await pending;
    } while (pending !== this.queue);
  }
  async report(scope: unknown = {}) {
    await this.flush();
    const filter = playDetails(scope);
    const entries = this.entries
      .filter(
        (e) =>
          (e.failure.code === 'GC-MP-028' &&
            Object.keys(e.failure.details).length === 0) ||
          Object.entries(filter).every(([k, v]) => e.failure.details[k] === v),
      )
      .slice(-100);
    return {
      schema: 1,
      appVersion: this.version,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
      storageAvailable: this.available,
      count: entries.length,
      entries,
    };
  }
}
