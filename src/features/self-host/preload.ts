import { ipcRenderer } from 'electron';
import type { SelfHostApi } from './types.ts';
export function selfHostPreload(): SelfHostApi {
  const subscribe = <T>(channel: string, listener: (value: T) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: T) =>
      listener(value);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };
  return {
    getSelfHost: () => ipcRenderer.invoke('self-host:get'),
    runSelfHost: (action) => ipcRenderer.invoke('self-host:run', action),
    setSelfHostCloseBehavior: (value) =>
      ipcRenderer.invoke('self-host:close-behavior', value),
    copySelfHostInfo: (id, kind) =>
      ipcRenderer.invoke('self-host:copy', id, kind),
    getSelfHostPrompt: () => ipcRenderer.invoke('self-host:prompt'),
    revealSelfHostData: () => ipcRenderer.invoke('self-host:reveal'),
    onSelfHostChanged: (listener) => subscribe('self-host:changed', listener),
    onSelfHostOpen: (listener) => subscribe('self-host:open', listener),
  };
}
