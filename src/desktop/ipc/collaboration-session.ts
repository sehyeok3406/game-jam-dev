import type { CollaborationService } from '../../application/projects/collaboration-service.ts';
import type { IpcRegistrar } from './types';

/** Connection mutations share the existing desktop queue with project switching and editing. */
export function registerCollaborationSessionIpc(
  handle: IpcRegistrar,
  service: CollaborationService,
  serial: <T>(operation: () => Promise<T>) => Promise<T>,
  assertSender: (
    event: Parameters<Parameters<IpcRegistrar>[1]>[0],
  ) => void = () => {},
) {
  handle('collaboration:get', () => service.get());
  handle('collaboration:create', (_event, input) =>
    serial(() => service.create(input)),
  );
  handle('collaboration:join', (_event, input) =>
    serial(() => service.join(input)),
  );
  handle('collaboration:recover', (_event, input) =>
    serial(() => service.recover(input)),
  );
  handle('collaboration:to-local', (event, input) => {
    assertSender(event);
    return serial(() => service.toLocal(input));
  });
  handle('collaboration:handover', (event, action, id) => {
    assertSender(event);
    return serial(() => service.handover(action, id));
  });
  handle('collaboration:leave', () => serial(() => service.leave()));
  handle('collaboration:resolve-offline', (_event, id, choice) =>
    serial(() => service.resolve(id, choice)),
  );
  handle('collaboration:resume-restored', () => serial(() => service.resume()));
  handle('collaboration:invite', () => serial(() => service.invite()));
  handle('collaboration:role', (_event, id, role) =>
    serial(() => service.role(id, role)),
  );
  // Lock release may be awaited while draining a mutation; retain its independent client lane.
  handle('collaboration:lock', (_event, relative) => service.lock(relative));
  handle('collaboration:unlock', (_event, relative) =>
    service.unlock(relative),
  );
}
