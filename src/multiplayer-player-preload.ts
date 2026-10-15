import { contextBridge, ipcRenderer } from 'electron';
import { playFailure } from './multiplayer/errors';
async function invoke(channel: string, input?: unknown) {
  const result = await ipcRenderer.invoke(channel, input);
  if (result?.playFailure) {
    const failure = playFailure(result.playFailure);
    throw Object.assign(
      new Error(
        `[${failure.code}] ${failure.message} [incident:${failure.id}]`,
      ),
      { failure },
    );
  }
  return result;
}
contextBridge.exposeInMainWorld('gameJamPlayer', {
  bootstrap: () => invoke('multiplayer:bootstrap'),
  diagnostics: (copy: boolean) => invoke('multiplayer:diagnostics', copy),
  connect: () => ipcRenderer.send('multiplayer:connect'),
  send: (message: unknown) => ipcRenderer.send('multiplayer:send', message),
  control: (input: unknown) => invoke('multiplayer:player-control', input),
  onMessage: (listener: (message: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, message: unknown) =>
      listener(message);
    ipcRenderer.on('multiplayer:event', wrapped);
    return () => ipcRenderer.removeListener('multiplayer:event', wrapped);
  },
});
