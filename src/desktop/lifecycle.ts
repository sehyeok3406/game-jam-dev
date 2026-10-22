export type ExitIntent =
  | 'switch-project'
  | 'home'
  | 'window-close'
  | 'update-restart'
  | 'quit';
type Ports = {
  drafts(): Promise<unknown>;
  saves(): Promise<unknown>;
  cache(): Promise<unknown>;
};

/** Called after the caller has drained property mutations and the UI has flushed editors. */
export class DesktopLifecycle {
  private checkpoint?: Promise<void>;
  private ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
  }
  preserve(_intent: ExitIntent) {
    if (this.checkpoint) return this.checkpoint;
    const checkpoint = (async () => {
      await this.ports.drafts();
      await this.ports.saves();
      await this.ports.cache();
    })();
    this.checkpoint = checkpoint;
    void checkpoint
      .finally(() => {
        if (this.checkpoint === checkpoint) this.checkpoint = undefined;
      })
      .catch(() => undefined);
    return checkpoint;
  }
}
