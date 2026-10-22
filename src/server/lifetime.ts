import type { Server } from 'node:http';
import { bounded } from './operations/maintenance.ts';
type Ports = {
  beginDrain?: () => void;
  drainAccepted?: () => Promise<void>;
  shutdownMs?: number;
  maintain: () => Promise<void>;
  exportDirty: () => void;
  closeMultiplayer: () => void;
  closeEvents: () => void;
  flushDiagnostics: () => Promise<void>;
  drain: () => Promise<void>;
  waitCheckpoints: () => Promise<void>;
  checkpointDirty: () => Promise<void>;
  closeStore: () => void | Promise<void>;
  stopOperations?: () => Promise<void>;
};
/** Existing timeout/timer/listen/drain semantics, independently testable ownership. */
export async function startServerLifetime(
  server: Server,
  host: string,
  port: number,
  ports: Ports,
) {
  const checkpointTimer = setInterval(() => {
    void ports.maintain().catch(() => undefined);
    // Export an immutable committed reference without holding the mutation or lease queue.
    ports.exportDirty();
  }, 30000);
  checkpointTimer.unref();
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    clearInterval(checkpointTimer);
    ports.closeMultiplayer();
    ports.closeEvents();
    await ports.closeStore();
    throw error;
  }
  const address = server.address();
  let closing: Promise<void> | undefined;
  return {
    server,
    port: typeof address === 'object' && address ? address.port : 4317,
    close: () =>
      (closing ??= (async () => {
        clearInterval(checkpointTimer);
        ports.beginDrain?.();
        const cleanup = async () => {
          const failures: unknown[] = [];
          const attempt = async (work: () => unknown | Promise<unknown>) => {
            try {
              await work();
            } catch (error) {
              failures.push(error);
            }
          };
          await attempt(async () => ports.stopOperations?.());
          // Keep accepted writes and their responses alive until their durable work finishes.
          await attempt(async () => ports.drainAccepted?.());
          await attempt(ports.closeMultiplayer);
          await attempt(ports.closeEvents);
          await attempt(ports.flushDiagnostics);
          await attempt(
            () =>
              new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeIdleConnections();
              }),
          );
          await attempt(ports.drain);
          await attempt(ports.waitCheckpoints);
          await attempt(ports.checkpointDirty);
          await attempt(ports.closeStore);
          if (failures.length) throw failures[0];
        };
        await bounded(cleanup(), ports.shutdownMs ?? 25000);
      })()),
  };
}
