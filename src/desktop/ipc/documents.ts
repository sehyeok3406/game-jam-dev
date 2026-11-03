import type { LocalSectionService } from '../../application/editing/section-service';
import type { LocalCreationService } from '../../application/editing/creation-service';
import type { IpcRegistrar } from './types';
import type { DocumentEditingService } from '../../application/editing/document-service';
import type { CanvasDocument } from '../../contracts/documents';
import type { CanvasSection } from '../../contracts/canvas';
import type { DocumentNameService } from '../../application/editing/document-name-service';

export function registerDocumentIpc(
  handle: IpcRegistrar,
  services: {
    editing: () => DocumentEditingService;
    names: () => DocumentNameService;
    scope: () => string;
    creation: () => LocalCreationService;
    section: () => LocalSectionService;
    documents: () => Promise<CanvasDocument[]>;
    sections: () => Promise<CanvasSection[]>;
  },
) {
  handle('sections:delete', (_event, input) =>
    services.section().delete(input),
  );
  handle('sections:update-layout', (_event, input) =>
    services.section().updateLayout(input),
  );
  handle('documents:create-idea', (_event, input) =>
    services.creation().createIdea(input),
  );
  handle('sections:create', (_event, input) =>
    services.creation().createSection(input),
  );
  handle('documents:duplicate', (_event, input) =>
    services.creation().duplicate(input),
  );
  handle('tasks:create', (_event, input) =>
    services.creation().createTask(input),
  );
  handle('assets:read', (_event, relative) =>
    services.editing().asset(relative),
  );
  handle('documents:list', () => services.documents());
  handle('sections:list', () => services.sections());
  const read = handle('documents:get', (_event, relative) =>
    services.editing().read(relative),
  );
  const write = handle('documents:save', (_event, input) =>
    services.editing().save(input),
  );
  handle('documents:rename', (_event, input) => services.names().rename(input));
  handle('preview:rename', (_event, input) =>
    services.names().renamePreview(input),
  );
  handle('files:inspect-names', (_event, scope) => {
    if (scope !== services.scope()) throw Error('프로젝트가 변경되었습니다.');
    return services.names().inspect(scope);
  });
  handle('files:unify-names', (_event, input) => services.names().unify(input));
  handle('documents:set-collapsed', (_event, input) =>
    services.editing().setCollapsed(input),
  );
  handle('documents:update-layout', (_event, input) =>
    services.editing().updateLayout(input),
  );
  return { read, write };
}
