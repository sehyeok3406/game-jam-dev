import { createHash } from 'node:crypto';
import { writeClientCache, type ClientCache } from '../../client-cache.ts';
import type { CollaborationClient } from '../../collaboration-client.ts';

/** Queue payloads keep their original root/client state through project switches. */
export class CollaborationCacheQueue {
  private pending: Promise<unknown> = Promise.resolve();
  private lastKey = '';
  private write: typeof writeClientCache;
  constructor(write = writeClientCache) {
    this.write = write;
  }
  drain() {
    return this.pending;
  }
  save(client: CollaborationClient, root: string) {
    const cache: ClientCache = {
      files: client.files,
      revisions: client.revisions,
      properties: client.properties,
      authorship: client.authorship,
      offline: client.offline ? structuredClone(client.offline) : null,
      outgoing: client.outgoing ? structuredClone(client.outgoing) : null,
      state: {
        ...client.state,
        inviteCode: undefined,
        recoveryKey: undefined,
        conflicts: undefined,
      },
    };
    const key = `${root}:${client.state.revision}:${client.state.pendingChanges}:${client.outgoing?.command.id ?? ''}:${client.offline ? createHash('sha256').update(JSON.stringify(client.offline)).digest('hex') : ''}`;
    if (key === this.lastKey) return this.pending;
    this.lastKey = key;
    const pending = this.pending
      .catch(() => undefined)
      .then(() => this.write(root, cache));
    this.pending = pending;
    void pending.catch(() => {
      if (this.lastKey === key) this.lastKey = '';
    });
    return pending;
  }
}
