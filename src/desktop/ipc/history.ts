import type { WorkspaceCanvasChange } from '../../contracts/project.ts';
import type { IpcRegistrar } from './types';
import type { LocalHistoryService } from '../../application/editing/history-service';
export function registerHistoryIpc(
  handle: IpcRegistrar,
  service: () => LocalHistoryService,
  changeEdit: (
    direction: 'undo' | 'redo',
  ) => Promise<WorkspaceCanvasChange | void>,
  state: () => { undo: string | null; redo: string | null },
) {
  handle('edit:state', state);
  handle('edit:undo', () => changeEdit('undo'));
  handle('edit:redo', () => changeEdit('redo'));
  handle('history:list', () => service().list());
  handle('history:read', (_event, id, relative, version) =>
    service().read(id, relative, version),
  );
  handle('history:restore', (_event, id, relative, version) =>
    service().restore(id, relative, version),
  );
}
