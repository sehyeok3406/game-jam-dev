import {
  comparePreparation,
  type CanvasDetail,
  type PreparationTarget,
} from '../../core/canvas/preparation-policy.ts';
import type { ViewportClock } from './viewport-store.ts';

export type PreparationStep<T> = (context: {
  signal: AbortSignal;
  level: CanvasDetail;
  revision: unknown;
}) => PreparationSlice<T> | Promise<PreparationSlice<T>>;
export type PreparationSlice<T> =
  | { done: true; value: T }
  | { done: false; next: PreparationStep<T> };
export interface PreparationWork<T> {
  isCurrent?: () => boolean;
  prepare: PreparationStep<T>;
  commit: (value: T, level: CanvasDetail) => void;
  discard?: (value: T) => void;
  error?: (error: unknown) => void;
}
type Entry = {
  key: string;
  nodeId: string;
  revision: unknown;
  work: PreparationWork<unknown>;
  completed?: CanvasDetail;
  failed?: CanvasDetail;
};
type Request = { target: PreparationTarget };
type Job = {
  entry: Entry;
  request: Request;
  controller: AbortController;
  step: PreparationStep<unknown>;
  cancelled: boolean;
};

/** Bounded UI work only. Each step must yield; arbitrary synchronous work cannot be preempted. */
export class CanvasPreparationScheduler {
  private entries = new Map<string, Entry>();
  private nodeEntries = new Map<string, Map<string, Entry>>();
  private requests = new Map<string, Request>();
  private ordered: Request[] = [];
  private queued = new Map<string, Job>();
  private active = new Set<Job>();
  private settled = new Map<
    Job,
    { slice: PreparationSlice<unknown> } | { error: unknown }
  >();
  private planReady = false;
  private frameEpoch = 0;
  private lastFrame: number | null = null;
  private clock: ViewportClock | null = null;
  private current: () => boolean = () => false;
  private frame: number | null = null;
  private moving = false;
  private generation = 0;
  readonly maxPending = 32;
  readonly maxConcurrent = 2;

  connect(clock: ViewportClock, current: () => boolean) {
    this.stop();
    this.clock = clock;
    this.current = current;
    this.refill();
  }

  register<T>(
    id: string,
    revision: unknown,
    work: PreparationWork<T>,
    resource = '',
  ) {
    const key = JSON.stringify([id, resource]);
    const entry: Entry = {
      key,
      nodeId: id,
      revision,
      work: work as PreparationWork<unknown>,
    };
    this.entries.set(key, entry);
    let entries = this.nodeEntries.get(id);
    if (!entries) this.nodeEntries.set(id, (entries = new Map()));
    entries.set(key, entry);
    this.reconcile();
    return () => {
      if (this.entries.get(key) !== entry) return;
      this.entries.delete(key);
      entries.delete(key);
      if (!entries.size && this.nodeEntries.get(id) === entries)
        this.nodeEntries.delete(id);
      this.reconcile();
    };
  }

  setTargets(targets: readonly PreparationTarget[], moving: boolean) {
    const next = new Map<string, Request>();
    for (const target of targets) {
      const previous = this.requests.get(target.id);
      // A harmless pan keeps an in-flight request; leaving and re-entering does not.
      if (previous?.target.level === target.level) {
        previous.target = target;
        next.set(target.id, previous);
      } else next.set(target.id, { target });
    }
    this.requests = next;
    this.ordered = [...next.values()].sort((a, b) =>
      comparePreparation(a.target, b.target),
    );
    this.moving = moving;
    this.planReady = true;
    this.reconcile();
    const settled = [...this.settled];
    this.settled.clear();
    for (const [job, result] of settled)
      if ('slice' in result) this.finish(job, result.slice);
      else this.fail(job, result.error);
  }

  /** A new camera/geometry input precedes its coalesced RAF plan. */
  invalidatePlan() {
    this.planReady = false;
    this.frameEpoch++;
    if (this.frame !== null) this.clock?.cancelFrame(this.frame);
    this.frame = null;
  }

  /** Run one bounded slice batch in the RAF that just produced the latest plan.
   * Waiting for a second RAF would starve work under continuous camera input. */
  flushFrame(timestamp: number) {
    if (this.frame !== null) this.clock?.cancelFrame(this.frame);
    this.frame = null;
    this.frameEpoch++;
    this.runFrame(timestamp);
  }

  getStatus() {
    return {
      pending: this.queued.size,
      active: this.active.size,
      generation: this.generation,
    };
  }

  private valid(job: Job) {
    const id = job.request.target.id;
    return (
      !!this.clock &&
      this.current() &&
      (job.entry.work.isCurrent?.() ?? true) &&
      !job.cancelled &&
      this.entries.get(job.entry.key) === job.entry &&
      this.requests.get(id) === job.request
    );
  }

  private cancel(job: Job) {
    job.cancelled = true;
    job.controller.abort();
  }

  private reconcile() {
    for (const job of this.active) if (!this.valid(job)) this.cancel(job);
    for (const [id, job] of this.queued)
      if (!this.valid(job)) {
        this.cancel(job);
        this.queued.delete(id);
      }
    this.refill();
  }

  private refill() {
    if (!this.clock || !this.current()) return;
    const next = new Map<string, Job>();
    outer: for (const request of this.ordered) {
      const { id, level } = request.target;
      for (const entry of this.nodeEntries.get(id)?.values() ?? []) {
        if (next.size >= this.maxPending) break outer;
        if (
          !entry ||
          !(entry.work.isCurrent?.() ?? true) ||
          entry.completed === level ||
          entry.failed === level ||
          [...this.active].some((job) => this.valid(job) && job.entry === entry)
        )
          continue;
        const old = this.queued.get(entry.key);
        next.set(
          entry.key,
          old ?? {
            entry,
            request,
            step: entry.work.prepare,
            controller: new AbortController(),
            cancelled: false,
          },
        );
      }
    }
    for (const [id, job] of this.queued) if (!next.has(id)) this.cancel(job);
    this.queued = next;
    this.schedule();
  }

  private schedule() {
    if (
      !this.clock ||
      !this.current() ||
      !this.planReady ||
      this.frame !== null ||
      !this.queued.size ||
      this.active.size >= this.maxConcurrent
    )
      return;
    const generation = this.generation;
    const frameEpoch = ++this.frameEpoch;
    this.frame = this.clock.frame((timestamp) => {
      if (
        generation !== this.generation ||
        frameEpoch !== this.frameEpoch ||
        !this.clock ||
        !this.current() ||
        !this.planReady
      )
        return;
      this.frame = null;
      this.runFrame(timestamp ?? this.clock.now());
    });
  }

  private runFrame(timestamp: number) {
    if (
      !this.clock ||
      !this.current() ||
      !this.planReady ||
      this.lastFrame === timestamp
    )
      return;
    this.lastFrame = timestamp;
    const start = this.clock.now();
    const slices = this.moving ? 1 : 4;
    const budget = this.moving ? 2 : 4;
    for (
      let i = 0;
      i < slices &&
      this.planReady &&
      this.queued.size &&
      this.active.size < this.maxConcurrent;
      i++
    ) {
      const job = this.queued.values().next().value!;
      this.queued.delete(job.entry.key);
      if (!this.valid(job)) continue;
      this.active.add(job);
      try {
        const result = job.step({
          signal: job.controller.signal,
          level: job.request.target.level,
          revision: job.entry.revision,
        });
        if ('then' in result)
          Promise.resolve(result).then(
            (slice) => this.finish(job, slice),
            (error) => this.fail(job, error),
          );
        else this.finish(job, result);
      } catch (error) {
        this.fail(job, error);
      }
      if (this.clock.now() - start >= budget) break;
    }
    this.refill();
  }

  private finish(job: Job, slice: PreparationSlice<unknown>) {
    if (!this.planReady && this.clock && this.current() && !job.cancelled) {
      this.settled.set(job, { slice });
      return;
    }
    this.active.delete(job);
    if (!this.valid(job)) {
      if (slice.done) {
        try {
          job.entry.work.discard?.(slice.value);
        } catch {
          /* Stale resource cleanup cannot publish errors into a new owner. */
        }
      }
    } else if (slice.done) {
      job.entry.completed = job.request.target.level;
      try {
        job.entry.work.commit(slice.value, job.request.target.level);
      } catch (error) {
        job.entry.failed = job.request.target.level;
        this.report(job.entry, error);
      }
    } else {
      job.step = slice.next;
      this.queued.set(job.entry.key, job);
    }
    this.refill();
  }

  private fail(job: Job, error: unknown) {
    if (!this.planReady && this.clock && this.current() && !job.cancelled) {
      this.settled.set(job, { error });
      return;
    }
    this.active.delete(job);
    if (this.valid(job)) {
      job.entry.failed = job.request.target.level;
      this.report(job.entry, error);
    }
    this.refill();
  }

  private report(entry: Entry, error: unknown) {
    try {
      entry.work.error?.(error);
    } catch {
      /* A failing UI error callback must not stall other preparation. */
    }
  }

  stop() {
    if (this.frame !== null) this.clock?.cancelFrame(this.frame);
    this.frame = null;
    for (const job of [...this.active, ...this.queued.values()])
      this.cancel(job);
    this.queued.clear();
    this.requests.clear();
    this.ordered = [];
    this.entries.clear();
    this.nodeEntries.clear();
    this.clock = null;
    this.current = () => false;
    this.planReady = false;
    this.lastFrame = null;
    this.generation++;
    for (const [job, result] of this.settled) {
      if ('slice' in result) this.finish(job, result.slice);
      else this.fail(job, result.error);
    }
    this.settled.clear();
  }
}
