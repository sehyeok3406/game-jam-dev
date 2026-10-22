import { ApiError } from '../services/errors.ts';

export function maintenanceError() {
  const error = new ApiError(
    '백업을 준비 중입니다. 같은 작업으로 잠시 후 다시 시도해주세요.',
    503,
  );
  error.code = 'SERVER_MAINTENANCE';
  return error;
}

export async function bounded<T>(
  work: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('유지 작업 정리 대기 시간이 초과되었습니다.')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Reject new work before queueing; let already accepted operations finish. */
export class MaintenanceGate {
  private paused = false;
  private stopped = false;
  private active = 0;
  private idle = new Set<() => void>();
  get blocked() {
    return this.paused || this.stopped;
  }
  stop() {
    this.stopped = true;
  }
  async drain() {
    if (this.active === 0) return;
    let done: () => void;
    try {
      await new Promise<void>((resolve) => {
        done = resolve;
        this.idle.add(resolve);
      });
    } finally {
      this.idle.delete(done!);
    }
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.blocked) throw maintenanceError();
    this.active++;
    try {
      return await work();
    } finally {
      if (--this.active === 0) for (const done of this.idle) done();
    }
  }
  async snapshot<T>(
    quiesce: () => Promise<void>,
    copy: () => Promise<T>,
    waitMs = 15000,
  ): Promise<T> {
    if (this.blocked) throw maintenanceError();
    this.paused = true;
    let done: (() => void) | undefined;
    try {
      const drained =
        this.active === 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              done = resolve;
              this.idle.add(resolve);
            });
      await bounded(drained.then(quiesce), waitMs);
      return await copy();
    } finally {
      if (done) this.idle.delete(done);
      this.paused = false;
    }
  }
}
