import type { LocalEditHistoryService } from '../../application/editing/edit-history-service';
import type { IpcRegistrar } from './types';
import type { LocalHistoryService } from '../../application/editing/history-service';
export function registerHistoryIpc(
  handle: IpcRegistrar,
  service: () => LocalHistoryService,
  edits: () => LocalEditHistoryService,
  state: () => { undo: string | null; redo: string | null },
) {
  handle('edit:state', state);
  handle('edit:undo', () => edits().change('undo'));
  handle('edit:redo', () => edits().change('redo'));
  handle('history:list', () => service().list());
  handle('history:read', (_event, id, relative, version) =>
    service().read(id, relative, version),
  );
  handle('history:restore', (_event, id, relative, version) =>
    service().restore(id, relative, version),
  );
}
