import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('gameJamPlayer', {
  bootstrap: () => ipcRenderer.invoke('multiplayer:bootstrap'),
  connect: () => ipcRenderer.send('multiplayer:connect'),
  send: (message: unknown) => ipcRenderer.send('multiplayer:send', message),
  control: (input: unknown) =>
    ipcRenderer.invoke('multiplayer:player-control', input),
  onMessage: (listener: (message: unknown) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, message: unknown) =>
      listener(message);
    ipcRenderer.on('multiplayer:event', wrapped);
    return () => ipcRenderer.removeListener('multiplayer:event', wrapped);
  },
});
