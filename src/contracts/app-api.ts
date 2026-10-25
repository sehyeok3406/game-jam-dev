import type {
  DiscordApprovalInput,
  DiscordApprovalStatus,
} from './discord-approval-types.ts';
import type {
  PlayAction,
  PlayEnvelope,
  PlayLobbyUpdate,
  PlayServerStatus,
} from './multiplayer.ts';
import type {
  DocumentStatuses,
  StatusesInput,
  WorkflowInput,
} from './document-statuses.ts';
import type { StatusPropertyInput } from './file-properties.ts';
import type { KanbanMoveInput, KanbanView, KanbanViewInput } from './kanban.ts';
import type { SelfHostApi } from './self-host.ts';
import type { CanvasViewChanges } from './canvas-view.ts';
import type {
  CanvasClipboardCopyInput,
  CanvasClipboardPasteInput,
  CanvasClipboardPasteResult,
  CanvasDocument,
  CreateIdeaInput,
  DeleteDocumentInput,
  DuplicateDocumentsInput,
  FileAuthorship,
  ImportFilesInput,
  SaveDocumentInput,
  SetDocumentCollapsedInput,
} from './documents.ts';
import type { EditorDraft } from './drafts.ts';
import type {
  DocumentSaveRequest,
  DocumentSaveState,
} from './document-save-queue.ts';
import type {
  CanvasSection,
  CanvasSheetCommand,
  CanvasSheets,
  CreateSectionInput,
  DeleteSectionInput,
  DeleteSectionResult,
  LayoutUpdate,
  MoveDocumentSectionInput,
  SectionLayoutUpdate,
} from './canvas.ts';
import type {
  ProjectEntry,
  ProjectFolder,
  ProjectTrashEntry,
  SharedProjectLifecycle,
  WorkspaceState,
} from './project.ts';
import type { CollaborationRole, CollaborationState } from './collaboration.ts';
import type {
  LaunchTestUsersInput,
  TestUserWindow,
  TestUsersState,
  UpdateState,
} from './desktop.ts';
import type {
  AiProviderId,
  CodexConnectionStatus,
  CodexRunEvent,
  CreateTaskInput,
  StartCodexRunInput,
  StartCodexRunResult,
} from './ai.ts';
import type { AiQueueTask } from './ai-task-queue.ts';
import type { PreviewResult, PreviewWindowState } from './preview.ts';
import type { MoveResultInput, ResultMove } from './results.ts';
import type { HistoryEntry } from './history.ts';
import type {
  ApprovalDetail,
  ApprovalList,
  ApprovalMutation,
  GamejamApproval,
} from './gamejam-approval.ts';
import type {
  DrawingChanges,
  DrawingCommand,
  DrawingItem,
} from './drawing-types.ts';
import type { GameUiCommand, GameUiFrame } from './game-ui-types.ts';
export type GameCanvasApi = {
  discordApproval?: {
    openHelp(page: 'portal' | 'permissions' | 'ids'): Promise<void>;
    sendTest(): Promise<{ message: string }>;
    status(): Promise<DiscordApprovalStatus>;
    configure(input: DiscordApprovalInput): Promise<DiscordApprovalStatus>;
    disconnect(): Promise<DiscordApprovalStatus>;
    onPrepare(listener: () => Promise<void>): () => void;
  };
  multiplayer?: {
    status?: () => Promise<PlayServerStatus>;
    onLobbyChanged?: (listener: (event: PlayLobbyUpdate) => void) => () => void;
    control: (input: PlayAction) => Promise<PlayEnvelope>;
    open: (roomId: string) => Promise<void>;
    diagnostics?: (copy?: boolean) => Promise<{
      report: string;
      count: number;
      storageAvailable: boolean;
    }>;
    reportPreview?: (input: {
      path: string;
      diagnostic: unknown;
    }) => Promise<unknown>;
  };
  getDocumentStatuses: () => Promise<{
    value: DocumentStatuses;
    raw: string | null;
  }>;
  saveDocumentStatuses: (input: StatusesInput) => Promise<void>;
  setDocumentWorkflow: (input: WorkflowInput) => Promise<void>;
  setFileStatusProperty: (input: StatusPropertyInput) => Promise<void>;
  getKanbanView: () => Promise<{
    value: KanbanView;
    raw: string | null;
  }>;
  saveKanbanView: (input: KanbanViewInput) => Promise<void>;
  moveKanbanCard: (input: KanbanMoveInput) => Promise<void>;
  selfHost?: SelfHostApi;
  inspectConnectionInfo: (text: string) => Promise<{
    id: string;
    name: string;
    serverUrl: string;
    previousUrl?: string;
  }>;
  applyConnectionInfo: (text: string) => Promise<void>;
  onUiDebugToggle?: (listener: () => void) => () => void;
  getCanvasChanges: (
    known: Record<string, string>,
  ) => Promise<CanvasViewChanges | null>;
  getDocument: (relativePath: string) => Promise<CanvasDocument | null>;
  getEditorDraft: (key: string) => Promise<EditorDraft | null>;
  setEditorDraft: (
    key: string,
    draft: EditorDraft | null,
    sequence: number,
  ) => Promise<void>;
  onDraftFlushRequested: (listener: () => Promise<void>) => () => void;
  enqueueDocumentSave: (
    request: DocumentSaveRequest,
  ) => Promise<DocumentSaveState>;
  getDocumentSaveStates: () => Promise<DocumentSaveState[]>;
  flushDocumentSaves: (
    scope: string,
    key?: string,
  ) => Promise<DocumentSaveState[]>;
  discardDocumentSave: (
    scope: string,
    key: string,
    sequence: number,
  ) => Promise<void>;
  onDocumentSaveChanged: (
    listener: (state: DocumentSaveState) => void,
  ) => () => void;
  getCanvasSheets: () => Promise<CanvasSheets>;
  changeCanvasSheets: (input: CanvasSheetCommand) => Promise<void>;
  getWebViewer: () => Promise<{
    configured: boolean;
    url: string;
    accessCode: string;
    projects: string[];
    liveLocal: boolean;
    lastPublishedAt?: number;
    errors: string[];
  }>;
  publishWebViewer: (input: {
    projects: string[];
    liveLocal: boolean;
  }) => Promise<{
    published: number;
    errors: string[];
  }>;
  openWebViewer: () => Promise<void>;
  listProjects: (refreshShared?: boolean) => Promise<ProjectEntry[]>;
  getProjectCopyTarget: (
    id: string,
  ) => Promise<import('./project-copy.ts').ProjectCopyTarget>;
  copySelectionToProject: (
    input: import('./project-copy.ts').ProjectCopyRequest,
  ) => Promise<import('./project-copy.ts').ProjectCopyResult>;
  prepareProjectTrash: (id: string) => Promise<{
    token: string;
    entry: {
      id: string;
      name: string;
      kind: 'local' | 'shared';
      root: string;
    };
    missing: boolean;
  }>;
  trashProject: (
    token: string,
    storage: Record<string, string>,
  ) => Promise<string>;
  listProjectTrash: () => Promise<ProjectTrashEntry[]>;
  restoreProjectTrash: (id: string) => Promise<Record<string, string>>;
  acknowledgeProjectRestore: (id: string) => Promise<void>;
  purgeProjectTrash: (
    id: string,
    name: string,
    discard: boolean,
  ) => Promise<void>;
  retryProjectTrash: () => Promise<void>;
  getSharedProjectLifecycle: (id: string) => Promise<SharedProjectLifecycle>;
  trashSharedProject: (
    id: string,
    name: string,
    confirm: boolean,
    version: number,
  ) => Promise<SharedProjectLifecycle>;
  restoreSharedProject: (id: string) => Promise<SharedProjectLifecycle>;
  purgeSharedProject: (
    id: string,
    name: string,
  ) => Promise<SharedProjectLifecycle>;
  resumeRestoredProject: () => Promise<CollaborationState>;
  listProjectFolders: () => Promise<ProjectFolder[]>;
  renameProject: (
    id: string,
    name: string,
    expectedName?: string,
  ) => Promise<void>;
  moveProject: (id: string, folderId: string | null) => Promise<void>;
  createProjectFolder: (name: string) => Promise<void>;
  renameProjectFolder: (id: string, name: string) => Promise<void>;
  removeProjectFolder: (id: string) => Promise<void>;
  revealProject: (id: string) => Promise<void>;
  openProject: (id: string) => Promise<WorkspaceState>;
  chooseProjectParent: () => Promise<string | null>;
  createProject: (
    input: string | import('./project-mode.ts').CreateProjectInput,
  ) => Promise<WorkspaceState>;
  convertProjectToLocal: (
    input: import('./project-mode.ts').LocalConversionInput,
  ) => Promise<void>;
  projectHandover: (
    action: 'prepare' | 'accept' | 'cancel',
    successorId?: string,
  ) => Promise<void>;
  goHome: () => Promise<void>;
  updateProjectServer: (id: string, serverUrl: string) => Promise<void>;
  resolveOfflineConflict: (
    id: string,
    choice: 'local' | 'server',
  ) => Promise<void>;
  setDocumentColor: (input: {
    objectId?: string;
    structureRevision?: number;
    relativePath: string;
    color: string;
    revision?: number;
  }) => Promise<void>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<UpdateState>;
  setAutomaticUpdates: (enabled: boolean) => Promise<UpdateState>;
  installUpdate: () => Promise<UpdateState>;
  onUpdateChanged: (listener: (state: UpdateState) => void) => () => void;
  onUpdateRestartRequested: (listener: () => Promise<string[]>) => () => void;
  onUpdateRestartReleased: (listener: () => void) => () => void;
  importFiles: (input: ImportFilesInput) => Promise<CanvasDocument[]>;
  markCanvasClipboard: (input: CanvasClipboardCopyInput) => Promise<void>;
  pasteCanvasClipboard: (
    input: CanvasClipboardPasteInput,
  ) => Promise<CanvasClipboardPasteResult>;
  readAsset: (relativePath: string) => Promise<string>;
  getUndoState: () => Promise<{
    undo: string | null;
    redo: string | null;
  }>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  getCollaboration: () => Promise<CollaborationState>;
  getTestUsers: () => Promise<TestUsersState>;
  launchTestUsers: (input: LaunchTestUsersInput) => Promise<TestUserWindow[]>;
  startLocalCollaborationServer: () => Promise<{
    serverUrl: string;
  }>;
  createCollaboration: (input: {
    serverUrl: string;
    serverKey: string;
    nickname: string;
  }) => Promise<CollaborationState>;
  joinCollaboration: (input: {
    serverUrl: string;
    code: string;
    nickname: string;
  }) => Promise<CollaborationState>;
  leaveCollaboration: () => Promise<void>;
  recoverCollaboration: (input: {
    serverUrl: string;
    projectId: string;
    recoveryKey: string;
  }) => Promise<CollaborationState>;
  rotateInvite: () => Promise<CollaborationState>;
  setMemberRole: (
    memberId: string,
    role: CollaborationRole | 'removed',
  ) => Promise<void>;
  acquireDocumentLock: (relativePath: string) => Promise<void>;
  releaseDocumentLock: (relativePath: string) => Promise<void>;
  updateLayouts: (
    updates: (
      | ({
          kind: 'document';
        } & LayoutUpdate)
      | ({
          kind: 'section';
        } & SectionLayoutUpdate)
    )[],
  ) => Promise<void>;
  onCollaborationChanged: (
    listener: (state: CollaborationState) => void,
  ) => () => void;
  getActiveRun: () => Promise<CodexRunEvent | null>;
  listAiQueue: () => Promise<AiQueueTask[]>;
  cancelQueuedTask: (taskId: string) => Promise<void>;
  getPreviewWindow: (
    relativePath?: string,
  ) => Promise<PreviewWindowState | null>;
  savePreviewWindow: (
    state: PreviewWindowState,
    relativePath?: string,
  ) => Promise<void>;
  listPreviews: () => Promise<PreviewResult[]>;
  moveResult: (input: MoveResultInput) => Promise<ResultMove[]>;
  organizeResults: () => Promise<ResultMove[]>;
  listHistory: () => Promise<HistoryEntry[]>;
  listApprovals: () => Promise<ApprovalList>;
  readApproval: (id: string) => Promise<ApprovalDetail>;
  mutateApproval: (
    action: 'create' | 'update' | 'cancel' | 'feedback' | 'delete',
    input: ApprovalMutation,
  ) => Promise<GamejamApproval>;
  getFileAuthorship: (relativePath: string) => Promise<FileAuthorship>;
  readHistoryFile: (
    id: string,
    relativePath: string,
    version: 'before' | 'after',
  ) => Promise<string | null>;
  restoreHistory: (
    id: string,
    relativePath?: string,
    version?: 'before' | 'after',
  ) => Promise<void>;
  getWorkspace: () => Promise<WorkspaceState>;
  selectWorkspace: () => Promise<WorkspaceState>;
  listDocuments: () => Promise<CanvasDocument[]>;
  listDrawings: () => Promise<DrawingItem[]>;
  listGameUi: () => Promise<GameUiFrame[]>;
  applyGameUiCommand: (command: GameUiCommand) => Promise<GameUiFrame[]>;
  exportGameUiPng: (input: {
    scope: string;
    name: string;
    data: string;
  }) => Promise<boolean>;
  applyCanvasCommands: (input: {
    scope: string;
    clipboardContextId?: string;
    requestId?: string;
    commands: {
      channel: string;
      input: unknown;
    }[];
  }) => Promise<unknown[]>;
  getDrawingChanges: (known: Record<string, string>) => Promise<DrawingChanges>;
  applyDrawingCommand: (command: DrawingCommand) => Promise<DrawingItem[]>;
  listSections: () => Promise<CanvasSection[]>;
  createIdea: (input: CreateIdeaInput) => Promise<CanvasDocument>;
  createSection: (input: CreateSectionInput) => Promise<CanvasSection>;
  renameSection: (
    relativePath: string,
    title: string,
    revision?: number,
  ) => Promise<void>;
  saveDocument: (input: SaveDocumentInput) => Promise<CanvasDocument>;
  setDocumentCollapsed: (input: SetDocumentCollapsedInput) => Promise<void>;
  deleteDocument: (input: DeleteDocumentInput) => Promise<void>;
  deleteDocuments: (documents: DeleteDocumentInput[]) => Promise<void>;
  deleteSection: (input: DeleteSectionInput) => Promise<DeleteSectionResult>;
  duplicateDocuments: (
    input: DuplicateDocumentsInput,
  ) => Promise<CanvasDocument[]>;
  updateDocumentLayout: (input: LayoutUpdate) => Promise<void>;
  updateSectionLayout: (input: SectionLayoutUpdate) => Promise<void>;
  moveDocumentToSection: (input: MoveDocumentSectionInput) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<CanvasDocument>;
  getCodexStatus: () => Promise<CodexConnectionStatus>;
  getAiStatus: (providerId: AiProviderId) => Promise<CodexConnectionStatus>;
  startCodexRun: (input: StartCodexRunInput) => Promise<StartCodexRunResult>;
  cancelCodexRun: (runId: string) => Promise<void>;
  readPreview: (relativePath?: string) => Promise<PreviewResult>;
  revealPath: (relativePath: string) => Promise<void>;
  openWorkspace: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  onWorkspaceChanged: (listener: () => void) => () => void;
  onCodexRunEvent: (listener: (event: CodexRunEvent) => void) => () => void;
};

/** Complete mapping of the legacy bridge, including optional nested APIs. */
export const APP_API_GROUPS = {
  discordApproval: 'desktop',
  multiplayer: 'preview',
  getDocumentStatuses: 'editor',
  saveDocumentStatuses: 'editor',
  setDocumentWorkflow: 'editor',
  setFileStatusProperty: 'editor',
  getKanbanView: 'editor',
  saveKanbanView: 'editor',
  moveKanbanCard: 'editor',
  selfHost: 'desktop',
  inspectConnectionInfo: 'collaboration',
  applyConnectionInfo: 'collaboration',
  onUiDebugToggle: 'desktop',
  getCanvasChanges: 'editor',
  getDocument: 'editor',
  getEditorDraft: 'saves',
  setEditorDraft: 'saves',
  onDraftFlushRequested: 'saves',
  enqueueDocumentSave: 'saves',
  getDocumentSaveStates: 'saves',
  flushDocumentSaves: 'saves',
  discardDocumentSave: 'saves',
  onDocumentSaveChanged: 'saves',
  getCanvasSheets: 'editor',
  changeCanvasSheets: 'editor',
  getWebViewer: 'desktop',
  publishWebViewer: 'desktop',
  openWebViewer: 'desktop',
  listProjects: 'projects',
  getProjectCopyTarget: 'desktop',
  copySelectionToProject: 'desktop',
  prepareProjectTrash: 'projects',
  trashProject: 'projects',
  listProjectTrash: 'projects',
  restoreProjectTrash: 'projects',
  acknowledgeProjectRestore: 'projects',
  purgeProjectTrash: 'projects',
  retryProjectTrash: 'projects',
  getSharedProjectLifecycle: 'projects',
  trashSharedProject: 'projects',
  restoreSharedProject: 'projects',
  purgeSharedProject: 'projects',
  resumeRestoredProject: 'projects',
  listProjectFolders: 'projects',
  renameProject: 'projects',
  moveProject: 'projects',
  createProjectFolder: 'projects',
  renameProjectFolder: 'projects',
  removeProjectFolder: 'projects',
  revealProject: 'desktop',
  openProject: 'projects',
  chooseProjectParent: 'projects',
  createProject: 'projects',
  convertProjectToLocal: 'collaboration',
  projectHandover: 'collaboration',
  goHome: 'projects',
  updateProjectServer: 'collaboration',
  resolveOfflineConflict: 'collaboration',
  setDocumentColor: 'editor',
  getUpdateState: 'desktop',
  checkForUpdates: 'desktop',
  setAutomaticUpdates: 'desktop',
  installUpdate: 'desktop',
  onUpdateChanged: 'desktop',
  onUpdateRestartRequested: 'desktop',
  onUpdateRestartReleased: 'desktop',
  importFiles: 'desktop',
  markCanvasClipboard: 'desktop',
  pasteCanvasClipboard: 'desktop',
  readAsset: 'editor',
  getUndoState: 'history',
  undo: 'history',
  redo: 'history',
  getCollaboration: 'collaboration',
  getTestUsers: 'desktop',
  launchTestUsers: 'desktop',
  startLocalCollaborationServer: 'desktop',
  createCollaboration: 'collaboration',
  joinCollaboration: 'collaboration',
  leaveCollaboration: 'collaboration',
  recoverCollaboration: 'collaboration',
  rotateInvite: 'collaboration',
  setMemberRole: 'collaboration',
  acquireDocumentLock: 'collaboration',
  releaseDocumentLock: 'collaboration',
  updateLayouts: 'editor',
  onCollaborationChanged: 'collaboration',
  getActiveRun: 'ai',
  listAiQueue: 'ai',
  cancelQueuedTask: 'ai',
  getPreviewWindow: 'preview',
  savePreviewWindow: 'preview',
  listPreviews: 'preview',
  moveResult: 'editor',
  organizeResults: 'editor',
  listHistory: 'history',
  listApprovals: 'ai',
  readApproval: 'ai',
  mutateApproval: 'ai',
  getFileAuthorship: 'history',
  readHistoryFile: 'history',
  restoreHistory: 'history',
  getWorkspace: 'projects',
  selectWorkspace: 'projects',
  listDocuments: 'editor',
  listDrawings: 'editor',
  listGameUi: 'editor',
  applyGameUiCommand: 'editor',
  exportGameUiPng: 'desktop',
  applyCanvasCommands: 'editor',
  getDrawingChanges: 'editor',
  applyDrawingCommand: 'editor',
  listSections: 'editor',
  createIdea: 'editor',
  createSection: 'editor',
  renameSection: 'editor',
  saveDocument: 'editor',
  setDocumentCollapsed: 'editor',
  deleteDocument: 'editor',
  deleteDocuments: 'editor',
  deleteSection: 'editor',
  duplicateDocuments: 'editor',
  updateDocumentLayout: 'editor',
  updateSectionLayout: 'editor',
  moveDocumentToSection: 'editor',
  createTask: 'editor',
  getCodexStatus: 'ai',
  getAiStatus: 'ai',
  startCodexRun: 'ai',
  cancelCodexRun: 'ai',
  readPreview: 'preview',
  revealPath: 'desktop',
  openWorkspace: 'desktop',
  copyText: 'desktop',
  onWorkspaceChanged: 'projects',
  onCodexRunEvent: 'ai',
} as const satisfies Record<keyof GameCanvasApi, string>;

type ApiGroup = (typeof APP_API_GROUPS)[keyof GameCanvasApi];
type GroupApi<G extends ApiGroup> = Pick<
  GameCanvasApi,
  {
    [K in keyof GameCanvasApi]-?: (typeof APP_API_GROUPS)[K] extends G
      ? K
      : never;
  }[keyof GameCanvasApi]
>;
export type ProjectsApi = GroupApi<'projects'>;
export type SavesApi = GroupApi<'saves'>;
export type CollaborationApi = GroupApi<'collaboration'>;
export type AiApi = GroupApi<'ai'>;
export type HistoryApi = GroupApi<'history'>;
export type PreviewApi = GroupApi<'preview'>;
export type DesktopApi = GroupApi<'desktop'>;
export type EditorApi = GroupApi<'editor'>;
export type AppApi = {
  projects: ProjectsApi;
  saves: SavesApi;
  collaboration: CollaborationApi;
  ai: AiApi;
  history: HistoryApi;
  preview: PreviewApi;
  desktop?: DesktopApi;
  editor: EditorApi;
};
