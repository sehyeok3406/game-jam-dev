import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'game-canvas-flow-'),
);
export const handlers = new Map<
  string,
  (...args: unknown[]) => Promise<unknown>
>();
export const events: { runId: string; status: string; message: string }[] = [];
export const ipcMain = {
  on: () => {},
  handle: (
    channel: string,
    handler: (...args: unknown[]) => Promise<unknown>,
  ) => handlers.set(channel, handler),
};
export const app = Object.assign(new EventEmitter(), {
  getVersion: () => '0.9.2',
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  getPath: () => root,
  quit: () => {},
});
export const autoUpdater = Object.assign(new EventEmitter(), {
  setFeedURL: () => {
    throw new Error('A development test must not set an update feed.');
  },
  checkForUpdates: () => {
    throw new Error('A development test must not access the update network.');
  },
  quitAndInstall: () => {
    throw new Error('Integration tests must not install real updates.');
  },
});
export const importSelections: string[] = [];
export const dialog = {
  showOpenDialog: async (options?: { properties?: string[] }) => ({
    canceled: false,
    filePaths: options?.properties?.includes('multiSelections')
      ? [...importSelections]
      : [root],
  }),
};
export const nativeImage = {
  createFromBuffer: () => ({ isEmpty: () => false }),
};
export const clipboard = { writeText: () => {} };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (text: string) => Buffer.from(text),
  decryptString: (buffer: Buffer) => buffer.toString(),
};
export const revealedPaths: string[] = [];
export const shell = {
  trashItem: async (target: string) => fs.rename(target, `${target}.trashed`),
  showItemInFolder: (target: string) => {
    revealedPaths.push(target);
  },
  openPath: async () => '',
};
export const createdWindows: BrowserWindow[] = [];
export class BrowserWindow extends EventEmitter {
  nativeMenu: unknown = 'default';
  setMenu = (menu: unknown) => {
    this.nativeMenu = menu;
  };
  destroyed = false;
  visible = false;
  show = () => {
    this.visible = true;
  };
  isVisible = () => this.visible;
  setSkipTaskbar = (_skip: boolean) => {};
  webContents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    send: (
      _channel: string,
      event: { runId: string; status: string; message: string },
    ) => {
      if (event?.runId) events.push(event);
    },
    setWindowOpenHandler: () => {},
    isDestroyed: () => false,
    executeJavaScript: async () => true,
    session: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      webRequest: { onBeforeRequest: () => {} },
    },
  });
  constructor(_options: unknown) {
    super();
    createdWindows.push(this);
  }
  loadURL = async (_url: string) => {};
  loadFile = async (_file: string) => {};
  destroy = () => {
    this.destroyed = true;
  };
  isDestroyed = () => this.destroyed;
  static getAllWindows = () => [];
}
