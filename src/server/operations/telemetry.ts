import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Bounded samples; raw URLs, body, credentials and filesystem paths never enter logs. */
export function createTelemetry(log?: (entry: object) => void) {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const salt = randomBytes(32),
    durations: number[] = [],
    saves: number[] = [];
  let requests = 0,
    failures = 0,
    aborted = 0,
    saveFailures = 0;
  const sample = (values: number[], value: number) => {
    values.push(value);
    if (values.length > 256) values.shift();
  };
  const projectReference = (id: string) =>
    createHmac('sha256', salt).update(id).digest('hex').slice(0, 16);
  return {
    recoveryError(id: string, phase: string) {
      console.warn(
        JSON.stringify({
          event: 'recovery-pending',
          message: '협업 DB 저장 완료, 복구 파일 재시도 대기',
          phase: ['checkpoint', 'lifecycle'].includes(phase)
            ? phase
            : 'unknown',
          project: projectReference(id),
        }),
      );
    },
    observe(request: IncomingMessage, response: ServerResponse) {
      const started = performance.now(),
        requestId = randomUUID();
      response.setHeader('X-Request-Id', requestId);
      const pathname = (request.url ?? '/').split('?')[0];
      const match = /^\/projects\/([a-f0-9-]{36})\/([a-z-]+)$/.exec(pathname);
      const actions = [
        'state',
        'lock',
        'unlock',
        'command',
        'offline-sync',
        'invite',
        'rename',
        'role',
        'leave',
        'history',
        'history-read',
        'history-change',
        'restore',
        'events',
        'play',
        'play-diagnostics',
        'lifecycle',
        'trash',
        'trash-restore',
        'trash-purge',
      ];
      const route = match
        ? '/projects/:id/' + (actions.includes(match[2]) ? match[2] : 'action')
        : ['/health', '/ready', '/projects', '/join', '/recover'].includes(
              pathname,
            )
          ? pathname
          : '/unknown';
      const project = match ? projectReference(match[1]) : undefined;
      let done = false;
      const finish = (complete: boolean) => {
        if (done) return;
        done = true;
        const elapsedMs = performance.now() - started;
        requests++;
        if (!complete) aborted++;
        if (!complete || response.statusCode >= 400) failures++;
        if (route !== '/projects/:id/events') sample(durations, elapsedMs);
        log?.({
          event: 'request',
          requestId,
          route,
          project,
          status: complete ? response.statusCode : 499,
          elapsedMs: Math.round(elapsedMs),
        });
      };
      response.once('finish', () => finish(true));
      response.once('close', () => finish(response.writableFinished));
    },
    async save<T>(work: () => Promise<T>): Promise<T> {
      const started = performance.now();
      try {
        return await work();
      } catch (error) {
        saveFailures++;
        throw error;
      } finally {
        sample(saves, performance.now() - started);
      }
    },
    snapshot() {
      const p95 = (values: number[]) =>
        values.length
          ? [...values].sort((a, b) => a - b)[
              Math.ceil(values.length * 0.95) - 1
            ]
          : null;
      return {
        requests,
        failures,
        aborted,
        saveFailures,
        failureRate: requests ? failures / requests : 0,
        requestP95Ms: p95(durations),
        saveP95Ms: p95(saves),
        sampleLimit: 256,
        rssBytes: process.memoryUsage().rss,
        eventLoopP95Ms: loop.count ? loop.percentile(95) / 1e6 : null,
      };
    },
    close() {
      loop.disable();
    },
  };
}
export async function writeOperationsStatus(
  root: string,
  metrics: object,
  backup: unknown,
  ready: boolean,
) {
  const disk = await fs.statfs(root);
  const status = {
    checkedAt: new Date().toISOString(),
    ready,
    ...metrics,
    diskFreeBytes: disk.bavail * disk.bsize,
    diskTotalBytes: disk.blocks * disk.bsize,
    backup: backup ?? { enabled: false },
  };
  const filename = path.join(root, 'operations-status.json');
  const temporary = filename + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(status, null, 2), {
    mode: 0o600,
  });
  await fs.rename(temporary, filename);
}
