import type { DesktopProjectPaths } from '../project-paths.ts';
import type { IpcRegistrar } from './types';

export function registerProjectFilesIpc(
  handle: IpcRegistrar,
  paths: () => DesktopProjectPaths,
  serial: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  handle('files:authorship', (_event, relative) =>
    serial(() => paths().authorship(relative)),
  );
  handle('path:reveal', (_event, relative) => paths().reveal(relative));
  handle('workspace:open-folder', () => paths().open());
}
