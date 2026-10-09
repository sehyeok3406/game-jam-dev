export type CanvasSheet = { id: string; name: string };
export type CanvasSheets = {
  version: 1;
  canvases: CanvasSheet[];
  raw?: string | null;
};
export type CanvasSheetCommand = {
  action: 'add' | 'rename' | 'reorder' | 'move' | 'delete';
  expected: string | null;
  id: string;
  name?: string;
  order?: string[];
  targetId?: string;
  paths?: string[];
};

export type DocumentType =
  | 'idea'
  | 'system'
  | 'overview'
  | 'question'
  | 'reference'
  | 'image'
  | 'ai-task';

export type SourceReference = {
  id: string;
  path?: string;
  contribution?: string;
};

export type FileActor = {
  id?: string;
  name: string;
  kind: 'member' | 'local' | 'ai';
};
export type FileAuthorship = {
  createdBy?: FileActor;
  createdAt?: number;
  lastEditedBy?: FileActor;
  lastEditedAt?: number;
};
export type FileAuthorshipRecord = FileAuthorship & {
  fileId: string;
  contentHash: string;
};
export type FileAuthorshipMap = Record<string, FileAuthorshipRecord>;

export type CanvasDocument = {
  structureRevision?: number;
  contentRevision?: number;
  canvasId?: string;
  backgroundColor?: import('./card-colors').CardColor;
  /** Hidden source record for an HTML execution window. */
  htmlSource?: string;
  asset?: ImageAsset;
  assetVersion?: number;
  revision?: number;
  id: string;
  title: string;
  type: DocumentType;
  status: string;
  relativePath: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  sources: SourceReference[];
  modifiedAt: number;
};

export type SectionMember = {
  id: string;
  path: string;
};

export type CanvasSection = {
  structureRevision?: number;
  canvasId?: string;
  revision?: number;
  id: string;
  title: string;
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  members: SectionMember[];
  modifiedAt: number;
};

export type WorkspaceState = {
  root: string | null;
  name: string | null;
};

export type LayoutUpdate = {
  structureRevision?: number;
  objectId?: string;
  position?: boolean;
  size?: boolean;
  revision?: number;
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SaveDocumentInput = {
  structureRevision?: number;
  objectId?: string;
  contentRevision?: number;
  expectedTitle?: string;
  expectedBody?: string;
  revision?: number;
  relativePath: string;
  title: string;
  body: string;
};

export type SetDocumentCollapsedInput = {
  relativePath: string;
  collapsed: boolean;
};

export type DeleteDocumentInput = {
  revision?: number;
  documentId: string;
  relativePath: string;
};

export type DeleteSectionInput = {
  revision?: number;
  sectionId: string;
  relativePath: string;
  deleteMembers: boolean;
};

export type DeleteSectionResult = {
  deletedDocumentCount: number;
  preservedDocumentCount: number;
};

export type DuplicateDocumentsInput = {
  canvasId?: string;
  documents: SectionMember[];
  offsetX: number;
  offsetY: number;
};

export type CreateIdeaInput = {
  canvasId?: string;
  x: number;
  y: number;
};

export type CreateSectionInput = {
  canvasId?: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  members: SectionMember[];
};

export type SectionLayoutUpdate = {
  structureRevision?: number;
  objectId?: string;
  revision?: number;
  relativePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  moveMembers?: boolean;
};

export type MoveDocumentSectionInput = {
  revision?: number;
  documentId: string;
  documentPath: string;
  targetSectionId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CreateTaskInput = {
  canvasId?: string;
  sourceMode?: 'html' | 'html-compose';
  kind: 'organize' | 'implement';
  inputPaths: string[];
  x: number;
  y: number;
  htmlResult?: HtmlResultChoice;
  documentResult?: import('./document-output').DocumentResultChoice;
  instructions?: string;
  resultName?: string;
  /** Run HTML implementation after the organized Markdown passes validation. */
  thenImplement?: {
    htmlResult?: HtmlResultChoice;
    instructions?: string;
    resultName?: string;
  };
};

export type HtmlResultChoice = {
  mode: 'update' | 'new';
  basePath?: string;
  category?: import('./preview-output').ResultCategory;
};

export type PreviewResult = {
  canvasId?: string;
  previousPaths?: string[];
  revision?: number;
  backgroundColor?: import('./card-colors').CardColor;
  title?: string;
  sourceId?: string;
  sourcePath?: string;
  initialWindow?: PreviewWindowState;
  warnings?: string[];
  exists: boolean;
  content: string;
  relativePath: string;
};

export type CodexConnectionStatus = {
  providerId?: AiProviderId;
  available: boolean;
  authenticated: boolean;
  version: string | null;
  executablePath: string | null;
  message: string;
};

export type CodexRunStatus =
  | 'starting'
  | 'running'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AiFileLock = { paths: string[]; folders: string[] };

export type CodexRunEvent = {
  fileLock?: AiFileLock;
  providerId?: AiProviderId;
  modelId?: string | null;
  actorId?: string;
  runId: string;
  taskPath: string;
  status: CodexRunStatus;
  kind: 'status' | 'log' | 'result' | 'error';
  message: string;
  timestamp: number;
  failure?: import('./app-errors').FailureInfo;
};

export type AiProviderId = 'codex-cli' | 'claude-cli' | 'gemini-cli';

export type StartCodexRunInput = {
  taskPath: string;
  providerId: AiProviderId;
  modelId: string | null;
};

export type StartCodexRunResult = {
  runId: string;
  taskPath: string;
  status: CodexRunStatus;
  providerId: AiProviderId;
  modelId: string | null;
};

export type UpdateState = {
  status:
    | 'unconfigured'
    | 'unavailable'
    | 'idle'
    | 'checking'
    | 'downloading'
    | 'current'
    | 'ready'
    | 'installing'
    | 'error';
  currentVersion: string;
  repository: string | null;
  available: boolean;
  automatic: boolean;
  message: string;
  lastCheckedAt?: number;
  releaseName?: string;
  errorCode?: string;
};

export type GameCanvasApi = {
  /** Desktop F12 route; browser previews use their own key handler. */
  onUiDebugToggle?: (listener: () => void) => () => void;
  getCanvasChanges: (
    known: Record<string, string>,
  ) => Promise<import('./canvas-view').CanvasViewChanges | null>;
  getDocument: (relativePath: string) => Promise<CanvasDocument | null>;
  getEditorDraft: (
    key: string,
  ) => Promise<import('./editor-drafts').EditorDraft | null>;
  setEditorDraft: (
    key: string,
    draft: import('./editor-drafts').EditorDraft | null,
    sequence: number,
  ) => Promise<void>;
  onDraftFlushRequested: (listener: () => Promise<void>) => () => void;
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
  }) => Promise<{ published: number; errors: string[] }>;
  openWebViewer: () => Promise<void>;
  listProjects: (refreshShared?: boolean) => Promise<ProjectEntry[]>;
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
  createProject: (name: string) => Promise<WorkspaceState>;
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
  readAsset: (relativePath: string) => Promise<string>;
  getUndoState: () => Promise<{ undo: string | null; redo: string | null }>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  getCollaboration: () => Promise<CollaborationState>;
  getTestUsers: () => Promise<TestUsersState>;
  launchTestUsers: (input: LaunchTestUsersInput) => Promise<TestUserWindow[]>;
  startLocalCollaborationServer: () => Promise<{ serverUrl: string }>;
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
      | ({ kind: 'document' } & LayoutUpdate)
      | ({ kind: 'section' } & SectionLayoutUpdate)
    )[],
  ) => Promise<void>;
  onCollaborationChanged: (
    listener: (state: CollaborationState) => void,
  ) => () => void;
  getActiveRun: () => Promise<CodexRunEvent | null>;
  getPreviewWindow: (
    relativePath?: string,
  ) => Promise<PreviewWindowState | null>;
  savePreviewWindow: (
    state: PreviewWindowState,
    relativePath?: string,
  ) => Promise<void>;
  listPreviews: () => Promise<PreviewResult[]>;
  moveResult: (
    input: import('./result-structure').MoveResultInput,
  ) => Promise<import('./result-structure').ResultMove[]>;
  organizeResults: () => Promise<import('./result-structure').ResultMove[]>;
  listHistory: () => Promise<HistoryEntry[]>;
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
  listSections: () => Promise<CanvasSection[]>;
  createIdea: (input: CreateIdeaInput) => Promise<CanvasDocument>;
  createSection: (input: CreateSectionInput) => Promise<CanvasSection>;
  renameSection: (
    relativePath: string,
    title: string,
    revision?: number,
  ) => Promise<void>;
  saveDocument: (input: SaveDocumentInput) => Promise<void>;
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

export type ImageAsset = {
  path: string;
  purpose: 'asset' | 'diagram';
  originalName: string;
  mime: string;
  bytes: number;
};
export type ImportFilesInput = {
  canvasId?: string;
  x: number;
  y: number;
  imagePurpose: 'asset' | 'diagram';
};
export type ImportBatchInput = ImportFilesInput & {
  files: { name: string; content: string }[];
};

export type PreviewWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  /** Missing in older projects means free resize. */
  presetId?: string;
  freeSize?: { width: number; height: number };
};

export type AiTaskRecord = {
  title: string;
  specification: string;
  inputs: string[];
  outputs: string[];
  /** Legacy records may only have the current internal task file available. */
  origin: 'snapshot' | 'legacy';
};

export type HistoryEntry = {
  providerId?: AiProviderId;
  aiTask?: AiTaskRecord;
  failure?: import('./app-errors').FailureInfo;
  id: string;
  label: string;
  kind: 'user' | 'ai' | 'restore';
  status: CodexRunStatus;
  createdAt: number;
  finishedAt?: number;
  taskPath?: string;
  modelId?: string | null;
  error?: string;
  files: { relativePath: string; before: boolean; after: boolean }[];
  actorId?: string;
  actorName?: string;
  action?: string;
  revision?: number;
};

export type CollaborationRole = 'admin' | 'editor' | 'viewer';
export type LaunchTestUsersInput = {
  count: number;
  nicknamePrefix: string;
  role: 'editor' | 'viewer';
};
export type TestUserWindow = {
  id: string;
  nickname: string;
  memberId: string;
  projectId: string;
  role: 'editor' | 'viewer';
  status: 'starting' | 'ready' | 'closed' | 'failed';
  message?: string;
};
export type TestUsersState = {
  supported: boolean;
  isTestUser: boolean;
  nickname?: string;
  maxWindows: number;
  windows: TestUserWindow[];
};
export type CollaborationMember = {
  id: string;
  nickname: string;
  role: CollaborationRole;
  owner: boolean;
  online: boolean;
};
export type CollaborationState = {
  propertySync?: boolean;
  deltaSync?: boolean;
  eventStream?: boolean;
  canvasSheets?: boolean;
  htmlComposition?: boolean;
  scopedAiLocks?: boolean;
  projectCreatedAt?: number;
  projectModifiedAt?: number;
  projectRename?: boolean;
  offlineSync?: boolean;
  pendingChanges?: number;
  conflicts?: OfflineConflict[];
  syncMessage?: string;
  accessDenied?: boolean;
  htmlResultFolders?: boolean;
  structuredResults?: boolean;
  editorAi?: boolean;
  multiProviderAi?: boolean;
  active: boolean;
  connected: boolean;
  serverUrl?: string;
  projectId?: string;
  projectName?: string;
  memberId?: string;
  role?: CollaborationRole;
  members: CollaborationMember[];
  locks: { relativePath: string; memberId: string; nickname: string }[];
  inviteCode?: string;
  inviteExpiresAt?: number;
  recoveryKey?: string;
  revision?: number;
  aiRun?: CodexRunEvent | null;
  message?: string;
  taskInstructionsEditable?: boolean;
  taskResultNaming?: boolean;
  gamejamWorkflow?: boolean;
  htmlImportAnalysis?: boolean;
};

export type ProjectEntry = {
  id: string;
  name: string;
  kind: 'local' | 'shared';
  root?: string;
  serverUrl?: string;
  projectId?: string;
  role?: CollaborationRole;
  lastOpenedAt: number;
  createdAt?: number;
  modifiedAt?: number;
  connected?: boolean;
  pendingChanges?: number;
  current?: boolean;
  folderId?: string;
};

/** Home-only grouping; never a filesystem or server directory. */
export type ProjectFolder = { id: string; name: string };

export type OfflineConflict = {
  id: string;
  paths: string[];
  local: { path: string; content: string | null }[];
  server: { path: string; content: string | null }[];
};
