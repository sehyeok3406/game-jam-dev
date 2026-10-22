import type { ProjectSettingsService } from '../../application/editing/settings-service';
import type { IpcRegistrar } from './types';
import type { LocalCanvasService } from '../../application/editing/canvas-service';

/** Transport registration only; storage and command policy belong to the service. */
export function registerCanvasIpc(
  handle: IpcRegistrar,
  service: LocalCanvasService,
  settings: () => ProjectSettingsService,
) {
  handle('document-statuses:get', () => settings().statuses());
  handle('kanban:get-view', () => settings().kanban());
  handle('canvas:changes', () => null);
  handle('canvases:list', () => service.canvases());
  handle('canvases:change', (_event, input) =>
    service.execute('canvases:change', input),
  );
  handle('drawings:list', () => service.drawings());
  handle('drawings:changes', (_event, known) => service.drawingDelta(known));
  handle('drawings:apply', (_event, input) => service.applyDrawing(input));
  handle('game-ui:list', () => service.gameUi());
  handle('game-ui:apply', (_event, input) => service.applyGameUi(input));
  for (const channel of [
    'kanban:move-card',
    'kanban:save-view',
    'files:set-status-property',
    'documents:set-workflow',
    'document-statuses:save',
  ] as const)
    handle(channel, (_event, input) => service.execute(channel, input));
}
