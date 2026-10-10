const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('realSaveTest', {
  invoke: (command, input) =>
    ipcRenderer.invoke('save-test:invoke', command, input),
  on: (event, listener) => {
    const wrapped = (_event, value) => listener(value);
    ipcRenderer.on('save-test:' + event, wrapped);
    return () => ipcRenderer.removeListener('save-test:' + event, wrapped);
  },
});
