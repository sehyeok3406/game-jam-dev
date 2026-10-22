import type { ProjectHomeService } from '../../application/projects/home-service.ts';
import type { IpcRegistrar } from './types';

export function registerProjectIpc(
  handle: IpcRegistrar,
  service: ProjectHomeService,
  assertHome: (event: Parameters<Parameters<IpcRegistrar>[1]>[0]) => void,
) {
  handle('projects:list', (_event, refresh = false) => service.list(refresh));
  handle('projects:home', () => service.home());
  handle('projects:folders', () => service.folders());
  handle('projects:rename', (_event, id, name, expected) =>
    service.rename(id, name, expected),
  );
  handle('projects:move', (_event, id, folder) => service.move(id, folder));
  handle('projects:folder-create', (_event, name) =>
    service.createFolder(name),
  );
  handle('projects:folder-rename', (_event, id, name) =>
    service.renameFolder(id, name),
  );
  handle('projects:folder-remove', (_event, id) => service.removeFolder(id));
  handle('projects:reveal', (_event, id) => service.reveal(id));
  handle('projects:open', (_event, id) => service.open(id));
  handle('projects:create', (_event, name) => service.create(name));
  handle('projects:server', (_event, id, url) => service.server(id, url));
  handle('projects:connection-inspect', (event, text) => {
    assertHome(event);
    return service.inspectConnection(text);
  });
  handle('projects:connection-apply', (event, text) => {
    assertHome(event);
    return service.applyConnection(text);
  });
  handle('projects:trash-prepare', (_event, id) => service.prepareTrash(id));
  handle('projects:trash-list', () => service.listTrash());
  handle('projects:trash', (_event, token, storage) =>
    service.trash(token, storage),
  );
  handle('projects:trash-restore', (_event, id) => service.restore(id));
  handle('projects:trash-restore-ack', (_event, id) =>
    service.acknowledgeRestore(id),
  );
  handle('projects:trash-purge', (_event, id, name, discard) =>
    service.purge(id, name, discard),
  );
  handle('projects:trash-retry', () => service.retryTrash());
  handle('projects:shared-lifecycle', (_event, id) =>
    service.lifecycle(id, 'lifecycle'),
  );
  handle(
    'projects:shared-trash',
    (_event, id, typedName, confirmTeam, expectedVersion) =>
      service.lifecycle(id, 'trash', {
        typedName,
        confirmTeam,
        expectedVersion,
      }),
  );
  handle('projects:shared-restore', (_event, id) =>
    service.lifecycle(id, 'trash-restore'),
  );
  handle('projects:shared-purge', (_event, id, typedName) =>
    service.lifecycle(id, 'trash-purge', { typedName }),
  );
}
