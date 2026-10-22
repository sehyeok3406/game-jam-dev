import { AppUpdateController } from '../app-update';
import { WebViewerService } from '../web-viewer-service';
import { startWebViewerSync } from '../web-viewer-sync';

type HostFeature = Awaited<
  ReturnType<typeof import('../features/self-host/register').registerSelfHost>
>;
type HostOptions = Parameters<
  typeof import('../features/self-host/register').registerSelfHost
>[0];

type Factories = {
  viewer: () => WebViewerService;
  updates: (
    options: ConstructorParameters<typeof AppUpdateController>[0],
  ) => AppUpdateController;
  host: (options: HostOptions) => Promise<HostFeature>;
  sync: typeof startWebViewerSync;
};

/** Explicit desktop-only service ownership. Opening a project never constructs these. */
export class DesktopBootstrap {
  private directory: () => string;
  private encryption: ConstructorParameters<typeof WebViewerService>[1];
  private viewer?: WebViewerService;
  private updates?: AppUpdateController;
  private host?: HostFeature;
  private hostPending?: Promise<HostFeature>;
  private factories: Factories;
  private disposed = false;
  private stopViewer = () => {};
  constructor(
    directory: () => string,
    encryption: ConstructorParameters<typeof WebViewerService>[1],
    factories: Partial<Factories> = {},
  ) {
    this.directory = directory;
    this.encryption = encryption;
    this.factories = {
      viewer: () => new WebViewerService(this.directory(), this.encryption),
      updates: (options) => new AppUpdateController(options),
      host: async (options) => {
        const { registerSelfHost } =
          await import('../features/self-host/register');
        return registerSelfHost(options);
      },
      sync: startWebViewerSync,
      ...factories,
    };
  }
  webViewer() {
    return (this.viewer ??= this.factories.viewer());
  }
  appUpdates(options: ConstructorParameters<typeof AppUpdateController>[0]) {
    return (this.updates ??= this.factories.updates(options));
  }
  async selfHost(options: HostOptions) {
    if (!this.hostPending) {
      this.hostPending = this.factories.host(options).then(
        (feature) => {
          this.host = feature;
          return feature;
        },
        (error) => {
          this.hostPending = undefined;
          throw error;
        },
      );
    }
    return this.hostPending;
  }
  startViewer() {
    this.stopViewer();
    this.stopViewer = this.factories.sync(this.webViewer());
  }
  stopViewerSync() {
    this.stopViewer();
    this.stopViewer = () => {};
  }
  dispose() {
    if (this.disposed) return [];
    this.disposed = true;
    const errors: unknown[] = [];
    // Preserve the PC host's independent-process close policy; attempt every cleanup.
    for (const dispose of [
      () => this.host?.lifecycle.dispose(),
      () => this.stopViewerSync(),
      () => this.updates?.dispose(),
    ]) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
}
