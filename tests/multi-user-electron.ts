// Capture IPC handlers, but never hide windows: visibility is part of the test.
// All Electron storage, lifecycle,
// encryption and the application's collaboration code remain real.
export { Menu, Tray } from 'electron/main';
import {
  app,
  BrowserWindow as NativeWindow,
  clipboard,
  dialog as nativeDialog,
  ipcMain as nativeIpc,
  shell,
  safeStorage,
  nativeImage,
  autoUpdater,
} from 'electron/main';
export { app, clipboard, shell, safeStorage, nativeImage, autoUpdater };
export const dialog = {
  ...nativeDialog,
  showOpenDialog(options: Electron.OpenDialogOptions) {
    if (
      options.properties?.includes('multiSelections') &&
      process.env.GAME_CANVAS_IMPORT_TEST_FILES_DIR
    ) {
      const root = process.env.GAME_CANVAS_IMPORT_TEST_FILES_DIR;
      return Promise.resolve({
        canceled: false,
        filePaths: [
          'reference.md',
          'player.png',
          'player.jpg',
          'player.gif',
          'player.webp',
          'game.html',
        ].map((name) => `${root}/${name}`),
      });
    }
    return nativeDialog.showOpenDialog(options);
  },
};
export const testHandlers = new Map<string, (...args: any[]) => any>();
export const ipcMain = {
  on: nativeIpc.on.bind(nativeIpc),
  handle(channel: string, handler: (...args: any[]) => any) {
    testHandlers.set(channel, handler);
    nativeIpc.handle(channel, handler);
  },
};
export class BrowserWindow extends NativeWindow {
  override loadURL(_url: string) {
    return super.loadURL('data:text/html,<title>test fixture</title>');
  }
}
