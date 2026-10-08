import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { CollaborationEnvelope } from './collaboration-server.ts';
import type { OfflineDraft, OnlineAttempt } from './collaboration-client.ts';
import type { Snapshot } from './project-store.ts';
export type ClientCache = CollaborationEnvelope & {
  offline?: OfflineDraft | null;
  outgoing?: OnlineAttempt | null;
};
const hashes = new Map<string, string>();
const stored = new Set<string>();
export async function writeClientCache(directory: string, cache: ClientCache) {
  const blobs = path.join(directory, '.sync-blobs');
  await fs.mkdir(blobs, { recursive: true });
  const encode = async (files?: Snapshot) => {
    if (!files) return files;
    const result: Snapshot = {};
    for (const [relative, raw] of Object.entries(files)) {
      let hash = hashes.get(raw);
      if (!hash) {
        hash = createHash('sha256').update(raw).digest('hex');
        hashes.set(raw, hash);
      }
      const filename = path.join(blobs, hash);
      if (!stored.has(filename)) {
        if (!(await fs.stat(filename).catch(() => null))) {
          const temporary = filename + '-' + randomUUID() + '.tmp';
          await fs.writeFile(temporary, raw, { mode: 0o600, flush: true });
          await fs.rename(temporary, filename);
        }
        stored.add(filename);
      }
      result[relative] = hash;
    }
    return result;
  };
  const offline = cache.offline
    ? {
        ...cache.offline,
        base: await encode(cache.offline.base),
        local: await encode(cache.offline.local),
        transaction: cache.offline.transaction
          ? {
              ...cache.offline.transaction,
              submitted: await encode(cache.offline.transaction.submitted),
            }
          : undefined,
      }
    : null;
  const outgoing = cache.outgoing
    ? {
        ...cache.outgoing,
        base: await encode(cache.outgoing.base),
        local: await encode(cache.outgoing.local),
      }
    : null;
  const payload = JSON.stringify({
    ...cache,
    format: 2,
    files: await encode(cache.files),
    offline,
    outgoing,
  });
  const temporary = path.join(directory, `server-cache-${randomUUID()}.tmp`);
  await fs.writeFile(temporary, payload, { mode: 0o600, flush: true });
  await fs.rename(temporary, path.join(directory, 'server-cache.json'));
}
export async function readClientCache(filename: string): Promise<ClientCache> {
  const cache = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (cache.format !== 2) return cache;
  const values = new Map<string, string>();
  const decode = async (files?: Snapshot) => {
    if (!files) return files;
    const result: Snapshot = {};
    for (const [relative, hash] of Object.entries(files)) {
      if (!/^[a-f0-9]{64}$/.test(hash))
        throw new Error('협업 캐시 파일 식별자가 올바르지 않습니다.');
      let raw = values.get(hash);
      if (raw === undefined) {
        raw = await fs.readFile(
          path.join(path.dirname(filename), '.sync-blobs', hash),
          'utf8',
        );
        values.set(hash, raw);
      }
      result[relative] = raw;
    }
    return result;
  };
  cache.files = await decode(cache.files);
  if (cache.offline) {
    cache.offline.base = await decode(cache.offline.base);
    cache.offline.local = await decode(cache.offline.local);
    if (cache.offline.transaction)
      cache.offline.transaction.submitted = await decode(
        cache.offline.transaction.submitted,
      );
  }
  if (cache.outgoing) {
    cache.outgoing.base = await decode(cache.outgoing.base);
    cache.outgoing.local = await decode(cache.outgoing.local);
  }
  return cache;
}
