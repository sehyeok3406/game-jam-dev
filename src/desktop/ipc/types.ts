import type { ipcMain } from 'electron';

/** Registers through the desktop's sender, session and mutation guards. */
export type IpcRegistrar = (
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1],
) => Parameters<typeof ipcMain.handle>[1];
