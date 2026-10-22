import type { IpcRegistrar } from './types';
import type { LocalCommandService } from '../../application/editing/command-service';

/** Wire names/inputs are preserved; command rules and publication are injected. */
export function registerEditingIpc(
  handle: IpcRegistrar,
  service: () => LocalCommandService,
) {
  for (const channel of [
    'canvas:batch',
    'results:move',
    'results:organize',
    'sections:rename',
    'documents:delete-many',
    'documents:delete',
    'documents:set-color',
    'sections:move-document',
  ] as const)
    handle(channel, (_event, input) => service().execute(channel, input));
  handle('layouts:update', (_event, updates) =>
    service().execute('layouts:update', { updates }),
  );
}
