import { createHash, randomUUID } from 'node:crypto';
import { ProjectSession } from '../application/projects/project-session.ts';
import type { ProjectSessionRef } from '../contracts/project-session.ts';

type Client = {
  credentials: { projectId: string };
  state: { memberId?: string };
  stop(): void;
};
type Watcher = { close(): Promise<unknown> };

/** Desktop-only owner of paths and authenticated clients. The public ref stays opaque. */
export class DesktopProjectSessions<C extends Client> {
  private session: ProjectSession | null = null;
  private privateRoot: string | null = null;
  private privateClient: C | null = null;
  private privateWatcher: Watcher | null = null;
  private generation = 0;
  private transitions: Promise<unknown> = Promise.resolve();
  localRootBeforeShare: string | null = null;
  get root() {
    return this.privateRoot;
  }
  get client() {
    return this.privateClient;
  }
  get watcher() {
    return this.privateWatcher;
  }
  get ref(): ProjectSessionRef | null {
    return this.session?.context.ref ?? null;
  }
  get signal() {
    return this.session?.context.signal;
  }
  get saveScope() {
    return this.client
      ? `shared:${this.client.credentials.projectId}:${this.client.state.memberId}`
      : this.root
        ? `local:${this.root}`
        : '';
  }
  matches(ref: ProjectSessionRef | null) {
    return (
      !this.session?.context.signal.aborted &&
      ref?.sessionId === this.ref?.sessionId &&
      ref?.epoch === this.ref?.epoch
    );
  }
  assertCurrent(ref: ProjectSessionRef | null) {
    if (!this.matches(ref))
      throw Error('프로젝트 세션이 변경되었습니다. 초안은 이 PC에 보관됩니다.');
  }
  own(key: string, dispose: () => void | Promise<unknown>) {
    this.session?.own(key, dispose);
  }
  release(key: string) {
    this.session?.release(key);
  }
  setWatcher(watcher: Watcher | null) {
    this.release('watcher');
    this.privateWatcher = watcher;
    if (watcher) this.own('watcher', () => watcher.close());
  }
  async activate(root: string | null, client: C | null = null) {
    const transition = this.transitions.then(() => this.replace(root, client));
    this.transitions = transition.catch(() => undefined);
    return transition;
  }
  private async replace(root: string | null, client: C | null) {
    await this.session?.dispose();
    this.privateWatcher = null;
    this.privateRoot = root;
    this.privateClient = client;
    this.generation++;
    this.session = root
      ? new ProjectSession(
          {
            projectKey: client
              ? `shared:${client.credentials.projectId}`
              : `local:${createHash('sha256').update(root).digest('hex')}`,
            sessionId: randomUUID(),
            epoch: this.generation,
          },
          client ? 'shared' : 'local',
          client?.credentials.projectId ??
            createHash('sha256').update(root).digest('hex'),
        )
      : null;
    if (client) this.own('client', () => client.stop());
    return this.ref;
  }
  async close() {
    await this.activate(null);
    this.localRootBeforeShare = null;
  }
}
