import type { IpcRegistrar } from './types';
import type { ProjectPreviewService } from '../../application/editing/preview-service';
export function registerPreviewIpc(
  handle: IpcRegistrar,
  service: () => ProjectPreviewService,
) {
  handle('preview:list', () => service().list());
  handle('preview:read', (_event, relative) => service().read(relative));
  handle('preview:window', (_event, relative) => service().window(relative));
  handle('preview:save-window', (_event, state, relative) =>
    service().saveWindow(state, relative),
  );
}
