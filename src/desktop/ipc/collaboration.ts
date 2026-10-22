import type { SharedEditingService } from '../../application/editing/shared-editing-service.ts';
import { isCommandName } from '../../contracts/commands.ts';

type Dispatch = { handled: false } | { handled: true; value: unknown };
/** Dispatch only the existing shared editing/query wires. Sender/session guards stay at registration. */
export function dispatchSharedEditingIpc(
  channel: string,
  args: unknown[],
  service: SharedEditingService,
  serial: <T>(operation: () => Promise<T>) => Promise<T>,
): Dispatch {
  if (isCommandName(channel))
    return {
      handled: true,
      value: serial(() =>
        service.execute(
          channel,
          (channel === 'layouts:update'
            ? { updates: args[0] }
            : args[0]) as never,
        ),
      ),
    };
  const reader = service.reader;
  switch (channel) {
    case 'document-statuses:get':
      return { handled: true, value: reader.statuses() };
    case 'kanban:get-view':
      return { handled: true, value: reader.kanban() };
    case 'files:authorship':
      return { handled: true, value: reader.authorship(args[0] as string) };
    case 'assets:read':
      return { handled: true, value: reader.asset(args[0] as string) };
    case 'edit:undo':
    case 'edit:redo':
      return {
        handled: true,
        value: serial(() =>
          service.changeHistory(channel === 'edit:undo' ? 'undo' : 'redo'),
        ),
      };
    case 'canvases:list':
      return { handled: true, value: reader.canvases() };
    case 'drawings:list':
      return { handled: true, value: reader.drawings() };
    case 'game-ui:list':
      return { handled: true, value: reader.gameUi() };
    case 'drawings:changes':
      return {
        handled: true,
        value: reader.drawingDelta(args[0] as Record<string, string>),
      };
    case 'canvas:changes':
      return {
        handled: true,
        value: reader.canvasChanges(args[0] as Record<string, string>),
      };
    case 'documents:get':
      return { handled: true, value: reader.document(args[0] as string) };
    case 'documents:list':
      return { handled: true, value: reader.documents() };
    case 'sections:list':
      return { handled: true, value: reader.sections() };
    case 'documents:set-collapsed':
      service.setCollapsed(
        args[0] as Parameters<SharedEditingService['setCollapsed']>[0],
      );
      return { handled: true, value: undefined };
    case 'preview:list':
      return { handled: true, value: reader.previews() };
    case 'preview:read':
      return { handled: true, value: reader.preview(args[0] as string) };
    default:
      return { handled: false };
  }
}
