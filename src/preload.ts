import { contextBridge, ipcRenderer } from 'electron';
import type { GameCanvasApi } from './shared';

const api: GameCanvasApi = {
  getCanvasChanges: (known) => ipcRenderer.invoke('canvas:changes', known),
  getDocument: (relative) => ipcRenderer.invoke('documents:get', relative),
  getEditorDraft: (key) => ipcRenderer.invoke('drafts:get', key),
  setEditorDraft: (key, draft, sequence) =>
    ipcRenderer.invoke('drafts:set', key, draft, sequence),
  onDraftFlushRequested: (listener) => {
    const wrapped = async () => {
      try {
        await listener();
        ipcRenderer.send('drafts:flushed');
      } catch {
        ipcRenderer.send('drafts:flush-failed');
      }
    };
    ipcRenderer.on('drafts:flush-request', wrapped);
    ipcRenderer.send('drafts:ready');
    return () => ipcRenderer.removeListener('drafts:flush-request', wrapped);
  },
  getWebViewer: () => ipcRenderer.invoke('web-viewer:get'),
  publishWebViewer: (input) => ipcRenderer.invoke('web-viewer:publish', input),
  openWebViewer: () => ipcRenderer.invoke('web-viewer:open'),
  listProjects: (refreshShared) =>
    ipcRenderer.invoke('projects:list', refreshShared),
  listProjectFolders: () => ipcRenderer.invoke('projects:folders'),
  renameProject: (id, name, expectedName) =>
    ipcRenderer.invoke('projects:rename', id, name, expectedName),
  moveProject: (id, folderId) =>
    ipcRenderer.invoke('projects:move', id, folderId),
  createProjectFolder: (name) =>
    ipcRenderer.invoke('projects:folder-create', name),
  renameProjectFolder: (id, name) =>
    ipcRenderer.invoke('projects:folder-rename', id, name),
  removeProjectFolder: (id) => ipcRenderer.invoke('projects:folder-remove', id),
  revealProject: (id) => ipcRenderer.invoke('projects:reveal', id),
  openProject: (id) => ipcRenderer.invoke('projects:open', id),
  createProject: (name) => ipcRenderer.invoke('projects:create', name),
  goHome: () => ipcRenderer.invoke('projects:home'),
  updateProjectServer: (id, serverUrl) =>
    ipcRenderer.invoke('projects:server', id, serverUrl),
  resolveOfflineConflict: (id, choice) =>
    ipcRenderer.invoke('collaboration:resolve-offline', id, choice),
  setDocumentColor: (input) => ipcRenderer.invoke('documents:set-color', input),
  getUpdateState: () => ipcRenderer.invoke('updates:state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  setAutomaticUpdates: (enabled) =>
    ipcRenderer.invoke('updates:automatic', enabled),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateChanged: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof listener>[0],
    ) => listener(state);
    ipcRenderer.on('updates:changed', wrapped);
    return () => ipcRenderer.removeListener('updates:changed', wrapped);
  },
  onUpdateRestartRequested: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, id: string) => {
      void listener().then(
        (blockers) => ipcRenderer.send('updates:prepared', id, blockers),
        () =>
          ipcRenderer.send('updates:prepared', id, [
            '편집 상태를 확인하지 못했습니다.',
          ]),
      );
    };
    ipcRenderer.on('updates:prepare', wrapped);
    return () => ipcRenderer.removeListener('updates:prepare', wrapped);
  },
  onUpdateRestartReleased: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('updates:release', wrapped);
    return () => ipcRenderer.removeListener('updates:release', wrapped);
  },
  importFiles: (input) => ipcRenderer.invoke('files:import', input),
  readAsset: (relative) => ipcRenderer.invoke('assets:read', relative),
  getUndoState: () => ipcRenderer.invoke('edit:state'),
  undo: () => ipcRenderer.invoke('edit:undo'),
  redo: () => ipcRenderer.invoke('edit:redo'),
  getCollaboration: () => ipcRenderer.invoke('collaboration:get'),
  getTestUsers: () => ipcRenderer.invoke('collaboration:test-users'),
  launchTestUsers: (input) =>
    ipcRenderer.invoke('collaboration:launch-test-users', input),
  startLocalCollaborationServer: () =>
    ipcRenderer.invoke('collaboration:start-local-server'),
  createCollaboration: (input) =>
    ipcRenderer.invoke('collaboration:create', input),
  joinCollaboration: (input) => ipcRenderer.invoke('collaboration:join', input),
  recoverCollaboration: (input) =>
    ipcRenderer.invoke('collaboration:recover', input),
  leaveCollaboration: () => ipcRenderer.invoke('collaboration:leave'),
  rotateInvite: () => ipcRenderer.invoke('collaboration:invite'),
  setMemberRole: (id, role) =>
    ipcRenderer.invoke('collaboration:role', id, role),
  acquireDocumentLock: (relative) =>
    ipcRenderer.invoke('collaboration:lock', relative),
  releaseDocumentLock: (relative) =>
    ipcRenderer.invoke('collaboration:unlock', relative),
  updateLayouts: (updates) => ipcRenderer.invoke('layouts:update', updates),
  onCollaborationChanged: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof listener>[0],
    ) => listener(state);
    ipcRenderer.on('collaboration:changed', wrapped);
    return () => ipcRenderer.removeListener('collaboration:changed', wrapped);
  },
  getActiveRun: () => ipcRenderer.invoke('codex:active'),
  getPreviewWindow: (relativePath) =>
    ipcRenderer.invoke('preview:window', relativePath),
  savePreviewWindow: (state, relativePath) =>
    ipcRenderer.invoke('preview:save-window', state, relativePath),
  listPreviews: () => ipcRenderer.invoke('preview:list'),
  moveResult: (input) => ipcRenderer.invoke('results:move', input),
  organizeResults: () => ipcRenderer.invoke('results:organize', {}),
  listHistory: () => ipcRenderer.invoke('history:list'),
  getFileAuthorship: (relative) =>
    ipcRenderer.invoke('files:authorship', relative),
  readHistoryFile: (id, relativePath, version) =>
    ipcRenderer.invoke('history:read', id, relativePath, version),
  restoreHistory: (id, relativePath, version) =>
    ipcRenderer.invoke('history:restore', id, relativePath, version),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  getCanvasSheets: () => ipcRenderer.invoke('canvases:list'),
  changeCanvasSheets: (input) => ipcRenderer.invoke('canvases:change', input),
  listDocuments: () => ipcRenderer.invoke('documents:list'),
  listSections: () => ipcRenderer.invoke('sections:list'),
  createIdea: (input) => ipcRenderer.invoke('documents:create-idea', input),
  createSection: (input) => ipcRenderer.invoke('sections:create', input),
  renameSection: (relativePath, title, revision) =>
    ipcRenderer.invoke('sections:rename', { relativePath, title, revision }),
  saveDocument: (input) => ipcRenderer.invoke('documents:save', input),
  setDocumentCollapsed: (input) =>
    ipcRenderer.invoke('documents:set-collapsed', input),
  deleteDocument: (input) => ipcRenderer.invoke('documents:delete', input),
  deleteDocuments: (documents) =>
    ipcRenderer.invoke('documents:delete-many', { documents }),
  deleteSection: (input) => ipcRenderer.invoke('sections:delete', input),
  duplicateDocuments: (input) =>
    ipcRenderer.invoke('documents:duplicate', input),
  updateDocumentLayout: (input) =>
    ipcRenderer.invoke('documents:update-layout', input),
  updateSectionLayout: (input) =>
    ipcRenderer.invoke('sections:update-layout', input),
  moveDocumentToSection: (input) =>
    ipcRenderer.invoke('sections:move-document', input),
  createTask: (input) => ipcRenderer.invoke('tasks:create', input),
  getCodexStatus: () => ipcRenderer.invoke('codex:status'),
  getAiStatus: (providerId) => ipcRenderer.invoke('ai:status', providerId),
  startCodexRun: (input) => ipcRenderer.invoke('codex:start', input),
  cancelCodexRun: (runId) => ipcRenderer.invoke('codex:cancel', runId),
  readPreview: (relativePath) =>
    ipcRenderer.invoke('preview:read', relativePath),
  revealPath: (relativePath) => ipcRenderer.invoke('path:reveal', relativePath),
  openWorkspace: () => ipcRenderer.invoke('workspace:open-folder'),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  onWorkspaceChanged: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('workspace:changed', wrapped);
    return () => ipcRenderer.removeListener('workspace:changed', wrapped);
  },
  onCodexRunEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, runEvent: unknown) =>
      listener(runEvent as Parameters<typeof listener>[0]);
    ipcRenderer.on('codex:run-event', wrapped);
    return () => ipcRenderer.removeListener('codex:run-event', wrapped);
  },
};

contextBridge.exposeInMainWorld('gameCanvas', api);
