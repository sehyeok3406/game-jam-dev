import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
async function boot() {
  const bridge = (window as any).realSaveTest;
  const api = createDevGameCanvasApi();
  const scope = await bridge.invoke('bootstrap', await api.listDocuments());
  const workspace = await api.getWorkspace();
  Object.assign(api, {
    getWorkspace: async () => ({ ...workspace, saveScope: scope }),
    listDocuments: () => bridge.invoke('list'),
    getDocument: (relative: string) => bridge.invoke('read', relative),
    getDocumentSaveStates: () => bridge.invoke('states'),
    enqueueDocumentSave: (input: unknown) => bridge.invoke('enqueue', input),
    flushDocumentSaves: (scope: string, key: string) =>
      bridge.invoke('flush', { scope, key }),
    discardDocumentSave: (scope: string, key: string, sequence: number) =>
      bridge.invoke('discard', { scope, key, sequence }),
    getCollaboration: () => bridge.invoke('collaboration'),
    acquireDocumentLock: (relative: string) => bridge.invoke('lock', relative),
    releaseDocumentLock: (relative: string) =>
      bridge.invoke('unlock', relative),
    saveDocument: (input: unknown) => bridge.invoke('save', input),
    setDocumentColor: (input: unknown) => bridge.invoke('color', input),
    onDocumentSaveChanged: (listener: unknown) => bridge.on('save', listener),
    onWorkspaceChanged: (listener: unknown) => bridge.on('workspace', listener),
    onCollaborationChanged: (listener: unknown) =>
      bridge.on('collaboration', listener),
  });
  window.gameCanvas = api;
  createRoot(document.getElementById('root')!).render(<App />);
}
void boot();
