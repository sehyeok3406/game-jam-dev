import {
  UserEditRecorder,
  RecordedCommandPublisher,
} from './application/editing/user-edit-recorder';
import { DesktopProjectPaths } from './desktop/project-paths';
import { registerProjectFilesIpc } from './desktop/ipc/project-files';
import { CollaborationService } from './application/projects/collaboration-service';
import { DesktopCollaborationSessions } from './desktop/collaboration/sessions';
import { CollaborationCacheQueue } from './desktop/collaboration/cache-queue';
import { CollaborationSessionStore } from './desktop/collaboration/session-store';
import { registerCollaborationSessionIpc } from './desktop/ipc/collaboration-session';
import {
  LocalMutationService,
  LOCAL_MUTATION_LABELS as mutationLabels,
} from './application/editing/local-mutation-service';
import { SharedProjectMirror } from './application/editing/shared-project-mirror';
import { ProjectLayoutService } from './application/projects/layout-service.ts';
import { checkSnapshot } from './collaboration-model.ts';
import {
  recoverProjectLayout,
  installProjectLayout,
} from './adapters/filesystem/layout-migration.ts';
import { layoutMarkdownCodec } from './adapters/markdown/layout-snapshot.ts';
import { remapLayoutMarkdown } from './adapters/markdown/layout-links.ts';
import { readDiskProjectLayout } from './adapters/filesystem/project-location.ts';
import { readProjectLayout } from './core/projects/project-layout.ts';
import { filesystemSharedProjectFiles } from './adapters/filesystem/shared-project-files';
import { ensureProjectLayout } from './adapters/filesystem/project-layout';
import {
  sessionProjectFileEffects,
  startSessionProjectWatcher,
} from './desktop/project-file-effects';
import { DesktopProjectModes } from './desktop/projects/project-modes';
import { ProjectModeFiles } from './adapters/filesystem/project-mode-files';
import { ProjectHomeService } from './application/projects/home-service';
import { filesystemHomeProjects } from './adapters/filesystem/home-projects';
import {
  desktopSharedProjects,
  homeProjectRegistry,
} from './desktop/projects/shared-projects';
import { registerProjectIpc } from './desktop/ipc/projects';
import { registerProjectCopyIpc } from './desktop/projects/project-copy';
import { SharedEditingService } from './application/editing/shared-editing-service';
import { SharedWorkspaceReader } from './application/editing/shared-workspace-reader';
import { dispatchSharedEditingIpc } from './desktop/ipc/collaboration';
import {
  AiRunCoordinator,
  recordAiPreparationFailure,
  type AiRunLease,
} from './application/ai/run-coordinator';
import { AiRunEvents, type AiEventIdentity } from './application/ai/run-events';
import { fileAiRunRecords } from './desktop/ai/run-records';
import { ProviderRunOutput } from './adapters/node/ai/run-output';
import { DesktopBootstrap } from './desktop/bootstrap';
import { ApprovalService } from './application/ai/approval-service';
import {
  AiQueueService,
  claimSharedAiRun,
} from './application/ai/queue-service';
import { AiRunService } from './application/ai/run-service';
import { aiRunPrompt } from './application/ai/run-prompt';
import { fileStageWorkspace } from './desktop/ai/stage-workspace';
import { NodeAiExecutor } from './desktop/ai/node-executor';
import { collectProcess } from './desktop/ai/process-runner';
import { inspectCodex } from './adapters/node/ai/inspection';
import { LocalEditHistoryService } from './application/editing/edit-history-service';
import { filesystemTextFiles } from './adapters/filesystem/text-files';
import { ProjectSettingsService } from './application/editing/settings-service';
import { ProjectPreviewService } from './application/editing/preview-service';
import { registerPreviewIpc } from './desktop/ipc/preview';
import { registerDiscordApprovalIpc } from './desktop/ipc/discord-approval';
import { exportGameUiPng } from './desktop/export-game-ui';
import { LocalHistoryService } from './application/editing/history-service';
import { registerHistoryIpc } from './desktop/ipc/history';
import {
  FileImportService,
  assertImportAccess,
} from './application/editing/import-service';
import { importSelectedFiles, readImportSources } from './desktop/import-files';
import { LocalCommandService } from './application/editing/command-service';
import {
  filesystemCommandPublisher,
  filesystemHistoryPublisher,
} from './adapters/filesystem/command-publisher';
import { registerEditingIpc } from './desktop/ipc/editing';
import { filesystemProjectReader } from './adapters/filesystem/project-reader';
import { LocalSectionService } from './application/editing/section-service';
import { LocalCreationService } from './application/editing/creation-service';
import { markdownCodec } from './adapters/filesystem/markdown-codec';
import { registerDocumentIpc } from './desktop/ipc/documents';
import { registerCanvasIpc } from './desktop/ipc/canvas';
import { LocalCanvasService } from './application/editing/canvas-service';
import { readDocument } from './adapters/filesystem/documents';
import { filesystemDocumentRepository } from './adapters/filesystem/document-repository';
import { DocumentEditingService } from './application/editing/document-service';
import { filesystemProjectRepository } from './adapters/filesystem/local-project-repository';
import { DesktopProjectSessions } from './desktop/project-session';
import { DesktopLifecycle } from './desktop/lifecycle';
import {
  DiscordApprovalService,
  type DiscordApprovalContext,
} from './discord-approval';
import { DiscordApprovalStore } from './discord-approval-store';
import { PropertyQueue } from './property-queue.ts';
import { AiQueueStore } from './ai-queue-store.ts';
import {
  isQueuePending,
  nextQueuedTasks,
  queueFileLock,
  type AiQueueTask,
} from './ai-task-queue.ts';
import { DRAWING_DIRECTORY, isDrawingPath } from './drawing-model.ts';
import type { DrawingCommand } from './drawing-types.ts';
import { installUiDebugShortcut } from './ui-debug-shortcut';
import { DOCUMENT_STATUSES_PATH } from './document-statuses';
import { CanvasView } from './canvas-view.ts';
import { readClientCache } from './client-cache.ts';
import { EditorDraftStore } from './editor-drafts.ts';
import {
  DocumentSaveQueue,
  type DocumentSaveRequest,
} from './document-save-queue.ts';
import { DocumentSaveStore } from './document-save-store.ts';
import { CANVAS_SHEETS_PATH } from './canvas-sheets';
import { randomUUID, createHash } from 'node:crypto';
import { isGameUiPath } from './game-ui-model.ts';
import { GAME_UI_DIRECTORY } from './game-ui-types.ts';
import { isAiProvider, reasoningError } from './core/ai/catalog';
import { findOtherCli } from './ai-cli';
import { remapResultChanges } from './result-structure';
import {
  taskFileLock,
  assertAiFilesUnlocked,
  assertAiMutation,
  mergeAiFileLocks,
} from './ai-file-lock';
import fs from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  shell,
  safeStorage,
  nativeImage,
  autoUpdater,
} from 'electron';
import updateConfig from '../update-config.json';
import { APP_NAME, LEGACY_DATA_DIRECTORY } from './app-branding';
import { repairWindowsBranding } from './windows-branding';
import { updateBlockers, type AppUpdateController } from './app-update';
import started from 'electron-squirrel-startup';
import chokidar from 'chokidar';
import {
  CollaborationClient,
  serverAddress,
  type CollaborationCredentials,
} from './collaboration-client';
import { createCollaborationServer } from './collaboration-server';
import { registerMultiplayerWindows } from './multiplayer/window-manager';
import { WEB_VIEWER_URL } from './web-viewer';
import { ProjectLibrary } from './project-library';
import { ProjectTrash } from './project-trash';
import { projectStorageKey } from './project-trash-keys';
import { canonical } from './trash-files';
import { invalidateClientCache } from './client-cache';
import type { DocumentSaveRecord } from './document-save-queue';
import type { EditorDraft } from './editor-drafts';
import { parseConnectionInfo } from './connection-info';
import { SELF_HOST_ENABLED } from './features/self-host/enabled';
import { localProjectName } from './project-metadata';
import { commandLabels, reduceCollaboration } from './collaboration-model';
import matter from './markdown.ts';
import { EditJournal } from './edit-journal';
import { CanvasError, failureInfo, errorText } from './app-errors';
import {} from './task-plan';
import { installPreviewPermissions } from './preview-permissions';
import {
  CANVAS_CLIPBOARD_MIME,
  UUID_PATTERN,
  ClipboardRequestCache,
  readCanvasClipboard,
  type ClipboardContents,
} from './clipboard-images';
import {
  testProfilePath,
  TestUserLauncher,
  MAX_TEST_WINDOWS,
  decryptTestBootstrap,
  TEST_BOOTSTRAP_KEY_ENV,
} from './test-users';
import {
  captureProject,
  historyId,
  listHistory,
  projectPath,
  readHistoryFile,
  recoverInterruptedHistory,
  saveHistory,
} from './project-store';
import { taskHistoryRecord } from './ai-task-history';
import { validateHtml } from './html-validation';
import { presentWindow } from './window-presentation';
import { isPreviewPath } from './preview-output';
import type {
  CanvasDocument,
  CodexRunEvent,
  CreateTaskInput,
  SaveDocumentInput,
  StartCodexRunInput,
  StartCodexRunResult,
  WorkspaceState,
  CollaborationState,
  CollaborationRole,
  LaunchTestUsersInput,
  ImportFilesInput,
  ImportBatchInput,
  CanvasClipboardCopyInput,
  CanvasClipboardPasteInput,
  CanvasClipboardPasteResult,
} from './shared';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

if (started) app.quit();

// Isolate both native settings/session files and Chromium storage before ready.
const configuredUserData = app.getPath('userData');
const defaultUserData =
  path.basename(configuredUserData) === APP_NAME
    ? path.join(path.dirname(configuredUserData), LEGACY_DATA_DIRECTORY)
    : configuredUserData;
if (defaultUserData !== configuredUserData) {
  mkdirSync(defaultUserData, { recursive: true });
  app.setPath('userData', defaultUserData);
  app.setPath('sessionData', defaultUserData);
}
const testProfile = testProfilePath(defaultUserData, process.argv);
const testBootstrapKey = process.env[TEST_BOOTSTRAP_KEY_ENV];
delete process.env[TEST_BOOTSTRAP_KEY_ENV];
if (testProfile) {
  mkdirSync(testProfile, { recursive: true });
  app.setPath('userData', testProfile);
  app.setPath('sessionData', testProfile);
}
let testNickname: string | undefined;
let testUserLauncher: TestUserLauncher | null = null;
let appUpdates: AppUpdateController;
const desktopBootstrap = new DesktopBootstrap(
  () => app.getPath('userData'),
  safeStorage,
);
let pendingAppOperations = 0;
let updateRestartPrepared = false;
let preparedReply: {
  id: string;
  resolve: (blockers: string[]) => void;
} | null = null;

const isUpdateSender = (
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
) =>
  !!mainWindow &&
  event.sender === mainWindow.webContents &&
  event.senderFrame === mainWindow.webContents.mainFrame;

const registerUpdates = async () => {
  const preferencesFile = path.join(app.getPath('userData'), 'updates.json');
  let automatic = true;
  try {
    const saved = JSON.parse(await fs.readFile(preferencesFile, 'utf8'));
    if (typeof saved.automatic === 'boolean') automatic = saved.automatic;
  } catch {
    /* First install uses the default; this file contains no credentials. */
  }
  const squirrelInstalled =
    process.platform === 'win32' &&
    existsSync(
      path.resolve(path.dirname(process.execPath), '..', 'Update.exe'),
    );
  appUpdates = desktopBootstrap.appUpdates({
    updater: {
      // Electron's event-specific overloads expose the same native EventEmitter.
      on: (name, listener) =>
        (autoUpdater as NodeJS.EventEmitter).on(name, listener),
      removeListener: (name, listener) =>
        (autoUpdater as NodeJS.EventEmitter).removeListener(name, listener),
      setFeedURL: (options) => autoUpdater.setFeedURL(options),
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      quitAndInstall: () => autoUpdater.quitAndInstall(),
    },
    repository: updateConfig,
    version: app.getVersion(),
    arch: process.arch,
    available: app.isPackaged && squirrelInstalled && !testProfile,
    unavailableReason: testProfile
      ? '테스트 사용자 창에서는 업데이트하지 않습니다. 기본 앱에서 확인해주세요.'
      : process.platform !== 'win32'
        ? '이번 버전은 Windows 설치 앱의 자동 업데이트를 지원합니다.'
        : !app.isPackaged
          ? '개발 실행에서는 업데이트를 설치하지 않습니다.'
          : 'Setup.exe로 설치한 앱에서 자동 업데이트를 사용할 수 있습니다.',
    automatic,
    // Squirrel's first launch holds an installer lock; ordinary launches check promptly.
    startupDelayMs: process.argv.includes('--squirrel-firstrun')
      ? 30_000
      : 1_000,
    persistAutomatic: async (enabled) => {
      await fs.mkdir(path.dirname(preferencesFile), { recursive: true });
      await fs.writeFile(
        `${preferencesFile}.tmp`,
        JSON.stringify({ automatic: enabled }),
        'utf8',
      );
      await fs.rename(`${preferencesFile}.tmp`, preferencesFile);
    },
    blockers: async () =>
      updateBlockers({
        aiBusy:
          runPreparing ||
          !!currentCodexRun() ||
          !!(
            projectSessions.client?.state.aiRun &&
            ['starting', 'running', 'validating'].includes(
              projectSessions.client.state.aiRun.status,
            )
          ),
        pendingWrites:
          pendingAppOperations > 0 ||
          !!documentSaveQueue?.hasPending() ||
          !!projectSessions.client?.offline ||
          !!projectSessions.client?.outgoing,
        disconnected:
          !!projectSessions.client && !projectSessions.client.state.connected,
        hostingGuests:
          !!localCollaborationServer &&
          !!projectSessions.client &&
          (projectSessions.client.state.members.some(
            (member) =>
              member.online &&
              member.id !== projectSessions.client?.state.memberId,
          ) ||
            projectSessions.client.state.locks.length > 0),
        testWindows: !!testUserLauncher?.hasActiveWindows(),
      }),
    confirmRestart: async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['나중에', '업데이트 후 재시작'],
        defaultId: 0,
        cancelId: 0,
        title: `${APP_NAME} 업데이트`,
        message: '작업을 마치고 업데이트를 적용할까요?',
        detail:
          '현재 앱이 종료된 뒤 새 버전으로 다시 열립니다. 프로젝트 문서와 설정은 유지됩니다. 내장 테스트 서버를 사용 중이라면 재시작하는 동안 서버도 중지됩니다.',
      });
      return result.response === 1;
    },
    prepareRestart: () =>
      new Promise<string[]>((resolve) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          resolve(['앱 창이 응답하지 않습니다.']);
          return;
        }
        updateRestartPrepared = true;
        const id = randomUUID();
        const timer = setTimeout(() => {
          if (preparedReply?.id === id) {
            preparedReply = null;
            resolve(['앱 편집 상태 확인 시간이 초과되었습니다.']);
          }
        }, 10_000);
        preparedReply = {
          id,
          resolve: (blockers) => {
            clearTimeout(timer);
            resolve(blockers);
          },
        };
        mainWindow.webContents.send('updates:prepare', id);
      }).then(async (blockers) => {
        if (!blockers.length) {
          try {
            await propertyQueue.flush();
            await lifecycle.preserve('update-restart');
          } catch {
            return [
              '작업을 보관하지 못했습니다. 재시작 전에 저장 상태를 확인해주세요.',
            ];
          }
        }
        return blockers;
      }),
    releaseRestart: () => {
      updateRestartPrepared = false;
      mainWindow?.webContents.send('updates:release');
    },
    changed: (state) => mainWindow?.webContents.send('updates:changed', state),
    log: (state) => {
      // Separate from project history: never upload machine update logs to collaborators.
      void fs
        .appendFile(
          path.join(app.getPath('userData'), 'updates.log'),
          `${JSON.stringify({ at: new Date().toISOString(), status: state.status, version: state.currentVersion, errorCode: state.errorCode })}\n`,
        )
        .catch(() => undefined);
    },
  });
  ipcMain.on('updates:prepared', (event, id: unknown, blockers: unknown) => {
    if (!isUpdateSender(event) || id !== preparedReply?.id) return;
    const reply = preparedReply;
    preparedReply = null;
    reply?.resolve(
      Array.isArray(blockers) &&
        blockers.length <= 30 &&
        blockers.every(
          (value) => typeof value === 'string' && value.length <= 1000,
        )
        ? blockers
        : ['앱 편집 상태 응답이 올바르지 않습니다.'],
    );
  });
  const operations = {
    'updates:state': () => appUpdates.snapshot(),
    'updates:check': () => appUpdates.check(),
    'updates:automatic': (enabled: boolean) => appUpdates.setAutomatic(enabled),
    'updates:install': () => appUpdates.install(),
  };
  for (const [channel, operation] of Object.entries(operations)) {
    ipcMain.handle(channel, (event, value) => {
      if (!isUpdateSender(event))
        throw new Error(
          '[GC-UPD-001] 앱 기본 창에서만 업데이트를 제어할 수 있습니다.',
        );
      return operation(value);
    });
  }
};

const SETTINGS_FILE = 'settings.json';
const projectSessions = new DesktopProjectSessions<CollaborationClient>();
const lifecycle = new DesktopLifecycle({
  drafts: async () => {
    await draftStore?.flush();
  },
  saves: async () => {
    await documentSaveQueue?.checkpoint();
  },
  cache: async () => {
    await collaborationCache.drain();
  },
});
let projectLibrary: ProjectLibrary;
let projectTrash: ProjectTrash;
let selfHost: import('./features/self-host/service').SelfHostService | null =
  null;
let selfHostLifecycle:
  | import('./features/self-host/lifecycle').SelfHostLifecycle
  | null = null;

let mainWindow: BrowserWindow | null = null;

let clipboardContextId = randomUUID();
let clipboardCopy: {
  copyId: string;
  contextId: string;
  senderId: number;
} | null = null;
const clipboardRequests = new ClipboardRequestCache();
const resetClipboardContext = () => {
  clipboardContextId = randomUUID();
  clipboardCopy = null;
  clipboardRequests.clear();
};

let localCollaborationServer: Awaited<
  ReturnType<typeof createCollaborationServer>
> | null = null;
const localCollaborationKey = randomUUID();
let sharedRunId: string | null = null;
const editJournals = new Map<string, EditJournal>();
const journal = () => {
  const key = projectSessions.client
    ? `shared:${projectSessions.client.credentials.projectId}:${projectSessions.client.credentials.token}`
    : requireWorkspace();
  let value = editJournals.get(key);
  if (!value) editJournals.set(key, (value = new EditJournal()));
  return value;
};
const userEdits = (
  root: string,
  ref: import('./contracts/project-session').ProjectSessionRef | null,
  editJournal = journal(),
) =>
  new UserEditRecorder(
    filesystemProjectRepository(root, () => projectSessions.assertCurrent(ref)),
    editJournal,
    { id: historyId, now: Date.now },
  );
let draftStore: EditorDraftStore;
let documentSaveQueue: DocumentSaveQueue;
const documentSaveScope = () => projectSessions.saveScope;
const assertClipboardContext = (scope: unknown, contextId: unknown) => {
  if (
    !projectSessions.root ||
    scope !== documentSaveScope() ||
    contextId !== clipboardContextId
  )
    throw new CanvasError(
      'GC-IMPORT-001',
      '프로젝트가 변경되어 붙여넣기를 취소했습니다.',
    );
};
let lastSharedState = '';
const collaborationCache = new CollaborationCacheQueue();
const cacheCollaboration = (client: CollaborationClient, cacheRoot: string) =>
  collaborationCache.save(client, cacheRoot);

const collaborationChanged = (state: CollaborationState, changed: boolean) => {
  const serialized = JSON.stringify(state);
  if (serialized !== lastSharedState) {
    lastSharedState = serialized;
    mainWindow?.webContents.send('collaboration:changed', state);
  }
  if (changed) notifyWorkspaceChanged();
  documentSaveQueue?.wake();
  if (changed && projectSessions.client && projectSessions.root) {
    void cacheCollaboration(projectSessions.client, projectSessions.root).catch(
      (error) => console.error('공동 프로젝트 캐시 저장 실패', error),
    );
  }
  const run = sharedRunId ? activeCodexRuns.get(sharedRunId) : null;
  if (
    run &&
    sharedRunId &&
    state.aiRun?.runId === sharedRunId &&
    (!state.connected ||
      state.aiRun?.status === 'cancelled' ||
      state.aiRun?.status === 'failed')
  ) {
    void run.cancel(true);
  }
};
let collaborationStore: CollaborationSessionStore | undefined;
const sessionStore = () =>
  (collaborationStore ??= new CollaborationSessionStore(
    app.getPath('userData'),
    safeStorage,
  ));
const collaborationSessions: DesktopCollaborationSessions =
  new DesktopCollaborationSessions({
    safeCreate: (input, source, root) =>
      projectModes.createSource(input, source, root),
    toLocal: (input) => projectModes.toLocal(input),
    handover: (action, id) => projectModes.handover(action, id),
    sessions: projectSessions,
    library: () => projectLibrary,
    hasTrash: (id) => projectTrash?.hasProject(id) ?? false,
    hasSharedTrash: (id) => projectTrash?.hasSharedProject(id) ?? false,
    userData: () => app.getPath('userData'),
    store: sessionStore,
    cache: collaborationCache,
    lifecycle,
    busy: () => !!currentCodexRun() || runPreparing,
    resetClipboard: resetClipboardContext,
    clearState: () => {
      lastSharedState = '';
    },
    changed: collaborationChanged,
    notify: () => notifyWorkspaceChanged(),
    lobby: (event, projectId) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('multiplayer:lobby-changed', {
          ...event,
          projectId,
        });
    },
    startWatcher: () => startWatcher(),
    creation: async (input) => {
      const internal =
        !!localCollaborationServer &&
        input.serverUrl === `http://127.0.0.1:${localCollaborationServer.port}`;
      const key = internal
        ? localCollaborationKey
        : selfHost && selfHost.state.publicUrl === input.serverUrl
          ? ((await selfHost.creationKey(input.serverUrl)) ?? input.serverKey)
          : input.serverKey;
      return { key, internal };
    },
    prepareLock: async (relative) => {
      if (!projectSessions.client && projectSessions.root)
        await localQueue(projectSessions.root);
      assertAiFilesUnlocked(currentAiFileLock(), [relative]);
    },
  });
const internalServerUrl = async () => {
  if (!localCollaborationServer)
    localCollaborationServer = await createCollaborationServer({
      dataDirectory: path.join(app.getPath('userData'), 'collaboration-server'),
      creationKey: localCollaborationKey,
    });
  return `http://127.0.0.1:${localCollaborationServer.port}`;
};
let modeFiles: ProjectModeFiles | undefined;
const chooseProjectParent = async () => {
  const selected = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: '프로젝트를 저장할 상위 폴더 선택',
  });
  return selected.canceled ? null : (selected.filePaths[0] ?? null);
};
const projectModes: DesktopProjectModes = new DesktopProjectModes({
  sessions: projectSessions,
  library: () => projectLibrary,
  files: () =>
    (modeFiles ??= new ProjectModeFiles(app.getPath('userData'), safeStorage)),
  store: sessionStore,
  prepare: async () => {
    await lifecycle.preserve('switch-project');
    await collaborationCache.drain();
  },
  busy: () => !!currentCodexRun() || runPreparing,
  creation: (input) => collaborationSessions.resolveCreation(input),
  chooseParent: chooseProjectParent,
  internalServerUrl,
  attach: (credentials, root) =>
    collaborationSessions.attach(credentials, root),
  openLocal: (root) => {
    editJournals.delete(root);
    return setWorkspace(root);
  },
  changed: () => notifyWorkspaceChanged(),
});
const attachCollaboration = (credentials: CollaborationCredentials) =>
  collaborationSessions.attach(credentials);
let changeTimer: NodeJS.Timeout | null = null;
let lastRunEvent: CodexRunEvent | null = null;
let runPreparing = false;
let preparationCancelled = false;
let preparingFileLock: import('./shared').AiFileLock | null = null;
let mutationQueue: Promise<unknown> = Promise.resolve();
const enqueueMutation = <T>(
  operation: () => Promise<T>,
  ref = projectSessions.ref,
): Promise<T> => {
  const next = mutationQueue.then(() => {
    projectSessions.assertCurrent(ref);
    return operation();
  });
  mutationQueue = next.catch(() => undefined);
  return next;
};
const aiIsActive = () =>
  runPreparing ||
  !!currentCodexRun() ||
  (!!projectSessions.client?.state.aiRun &&
    ['starting', 'running', 'validating'].includes(
      projectSessions.client.state.aiRun.status,
    ));
const executionFileLock = () =>
  currentCodexRun()?.fileLock ??
  preparingFileLock ??
  (aiIsActive() ? projectSessions.client?.state.aiRun?.fileLock : null);
const queueStores = new Map<string, Promise<AiQueueStore>>();
const loadedQueues = new Map<string, AiQueueStore>();
const localQueue = (root: string) => {
  let pending = queueStores.get(root);
  if (!pending) {
    const filename = path.join(
      app.getPath('userData'),
      'ai-queues',
      `${createHash('sha256').update(root).digest('hex')}.json`,
    );
    pending = new AiQueueStore(filename).load().then((store) => {
      loadedQueues.set(root, store);
      return store;
    });
    queueStores.set(root, pending);
  }
  return pending;
};
const currentAiFileLock = () =>
  mergeAiFileLocks([
    executionFileLock(),
    queueFileLock(
      projectSessions.client
        ? (projectSessions.client.state.aiQueue ?? [])
        : (loadedQueues.get(projectSessions.root ?? '')?.tasks ?? []),
    ),
  ]);
const assertEditable = () => {
  if (aiIsActive())
    throw new Error(
      '이미 AI 작업이 진행 중입니다. 프로젝트 전환과 추가 AI 실행은 작업이 끝난 뒤 진행해주세요.',
    );
};
const assertMutationAllowed = async (channel: string, args: unknown[]) => {
  if (
    channel === 'projects:copy-target' ||
    channel === 'projects:copy-selection'
  )
    return;
  const context = args[0] as
    | { scope?: string; contextId?: string; clipboardContextId?: string }
    | undefined;
  if (
    channel === 'clipboard:canvas-paste' ||
    context?.clipboardContextId ||
    (channel === 'files:import' &&
      (args[0] as ImportFilesInput)?.files !== undefined)
  )
    assertClipboardContext(
      context?.scope,
      context?.contextId ?? context?.clipboardContextId,
    );
  if (
    (channel === 'drawings:apply' ||
      channel === 'game-ui:apply' ||
      channel === 'canvas:batch') &&
    (args[0] as DrawingCommand)?.scope !== documentSaveScope()
  )
    throw new Error(
      '프로젝트가 변경되었습니다. 그림 초안은 이 PC에 보관됩니다.',
    );
  if (channel === 'documents:save') {
    const scope = (args[0] as SaveDocumentInput)?.queueScope;
    const sessionId = (args[0] as SaveDocumentInput)?.queueSessionId;
    if (sessionId && sessionId !== projectSessions.ref?.sessionId)
      throw new Error(
        '프로젝트 세션이 변경되었습니다. 초안은 이 PC에 보관됩니다.',
      );
    if (scope && scope !== documentSaveScope())
      throw new Error('프로젝트가 변경되었습니다. 초안은 이 PC에 보관됩니다.');
  }
  if (!projectSessions.client && projectSessions.root)
    await localQueue(projectSessions.root);
  if (
    !aiIsActive() &&
    !currentAiFileLock().paths.length &&
    !currentAiFileLock().folders.length
  )
    return;
  if (
    (channel === 'tasks:create' &&
      (args[0] as CreateTaskInput)?.queueVersion !== 1) ||
    channel === 'workspace:select' ||
    channel.startsWith('projects:')
  )
    return assertEditable();
  const lock = currentAiFileLock();
  // Older servers still enforce a project lease; retain their protection.
  if (aiIsActive() && !executionFileLock()) return assertEditable();
  if (channel === 'files:import' || channel === 'clipboard:canvas-paste')
    return;
  if (
    channel === 'history:restore' ||
    channel === 'edit:undo' ||
    channel === 'edit:redo'
  ) {
    const root = requireWorkspace();
    const id =
      channel === 'history:restore'
        ? args[0]
        : journal().peek(channel === 'edit:undo' ? 'undo' : 'redo').id;
    const entry = (await listHistory(root)).find((entry) => entry.id === id);
    const paths =
      entry?.files
        .filter(
          (file) =>
            channel !== 'history:restore' ||
            !args[1] ||
            file.relativePath === args[1],
        )
        .map((file) => file.relativePath) ?? [];
    assertAiFilesUnlocked(lock, paths);
    if (channel === 'history:restore') {
      const changes: Record<string, string | null> = {};
      for (const relative of paths)
        changes[relative] = await readHistoryFile(
          root,
          String(id),
          relative,
          args[2] === 'after' ? 'after' : 'before',
        );
      const current = await captureProject(root);
      assertAiFilesUnlocked(
        lock,
        Object.keys(remapResultChanges(current, changes)),
      );
    }
    return;
  }
  const before =
    projectSessions.client?.files ?? (await captureProject(requireWorkspace()));
  const input = (
    channel === 'layouts:update' ? { updates: args[0] } : args[0]
  ) as Record<string, unknown>;
  const reduced = reduceCollaboration(before, channel, input);
  assertAiMutation(lock, before, reduced.files, channel, input);
};
const activeCodexRuns = new Map<string, AiRunCoordinator>();
const currentCodexRun = (): AiRunCoordinator | null =>
  activeCodexRuns.values().next().value ?? null;

const aiExecutors = new Map<import('./shared').AiProviderId, NodeAiExecutor>();
const aiExecutorFor = (provider: import('./shared').AiProviderId) => {
  let executor = aiExecutors.get(provider);
  if (!executor) {
    executor = new NodeAiExecutor(provider);
    aiExecutors.set(provider, executor);
  }
  return executor;
};
const getCodexStatus = () => inspectCodex(collectProcess);

const getAiStatus = async (providerId: import('./shared').AiProviderId) => {
  if (!isAiProvider(providerId))
    throw new CanvasError('GC-AI-009', '지원하지 않는 AI 제공자입니다.');
  return aiExecutorFor(providerId).inspect();
};

const workspaceState = async (): Promise<WorkspaceState> => ({
  libraryId:
    projectSessions.client?.credentials.libraryId ??
    (projectSessions.root
      ? projectLibrary.findRoot(projectSessions.root)?.id
      : undefined),
  session: projectSessions.ref ?? undefined,
  root: projectSessions.root,
  clipboardContextId,
  name: projectSessions.root
    ? (projectSessions.client?.state.projectName ??
      (await localProjectName(projectSessions.root)))
    : null,
});

const settingsPath = () => path.join(app.getPath('userData'), SETTINGS_FILE);

const saveSettings = async () => {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(
    settingsPath(),
    JSON.stringify(
      {
        workspaceRoot: projectSessions.client
          ? projectSessions.localRootBeforeShare
          : projectSessions.root,
      },
      null,
      2,
    ),
    'utf8',
  );
};

const loadSettings = async () => {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as { workspaceRoot?: string };
    if (parsed.workspaceRoot) {
      const stat = await fs.stat(parsed.workspaceRoot);
      if (stat.isDirectory())
        await projectSessions.activate(await fs.realpath(parsed.workspaceRoot));
    }
  } catch {
    await projectSessions.activate(null);
  }
};

const requireWorkspace = () => {
  if (!projectSessions.root)
    throw new Error('프로젝트 폴더를 먼저 열어주세요.');
  return projectSessions.root;
};

const desktopPaths = () => {
  const root = requireWorkspace(),
    ref = projectSessions.ref;
  return new DesktopProjectPaths(
    root,
    () => projectSessions.assertCurrent(ref),
    {
      reveal: (absolute) => shell.showItemInFolder(absolute),
      open: (absolute) => shell.openPath(absolute),
    },
  );
};

const ensureWorkspace = () => {
  const root = requireWorkspace(),
    ref = projectSessions.ref;
  return ensureProjectLayout(root, () => projectSessions.assertCurrent(ref));
};

const listDocuments = () =>
  filesystemProjectReader(requireWorkspace()).documents();
const listSections = () =>
  filesystemProjectReader(requireWorkspace()).sections.list();

const notifyWorkspaceChanged = () => {
  if (changeTimer) clearTimeout(changeTimer);
  projectSessions.release('workspace-notification');
  const ref = projectSessions.ref;
  changeTimer = setTimeout(() => {
    if (projectSessions.matches(ref))
      mainWindow?.webContents.send('workspace:changed');
  }, 180);
  const timer = changeTimer;
  projectSessions.own('workspace-notification', () => clearTimeout(timer));
};

const startWatcher = () => {
  const root = projectSessions.root,
    ref = projectSessions.ref;
  return startSessionProjectWatcher(root, {
    isCurrent: () => projectSessions.matches(ref),
    watcher: () => projectSessions.watcher,
    set: (watcher) => projectSessions.setWatcher(watcher),
    create: (watchRoot) =>
      chokidar.watch(watchRoot, {
        ignored: (target) => {
          const relative = path
            .relative(watchRoot, target)
            .replaceAll('\\', '/');
          if (
            relative === '.canvas' ||
            relative === CANVAS_SHEETS_PATH ||
            relative === DOCUMENT_STATUSES_PATH
          )
            return false;
          if (relative === DRAWING_DIRECTORY || isDrawingPath(relative))
            return false;
          if (relative === GAME_UI_DIRECTORY || isGameUiPath(relative))
            return false;
          return (
            /(^|\/)\./.test(relative) ||
            relative.split('/').includes('node_modules')
          );
        },
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      }),
    changed: notifyWorkspaceChanged,
  });
};

const projectFileEffects = (
  ref: import('./contracts/project-session').ProjectSessionRef | null,
) =>
  sessionProjectFileEffects({
    assertCurrent: () => projectSessions.assertCurrent(ref),
    isCurrent: () => projectSessions.matches(ref),
    watcher: () => projectSessions.watcher,
    clear: () => projectSessions.setWatcher(null),
    restart: startWatcher,
    trashItem: (absolute) => shell.trashItem(absolute),
  });
const sharedProjectMirror = (
  ref = projectSessions.ref,
  root = requireWorkspace(),
) => {
  const assertCurrent = () => projectSessions.assertCurrent(ref);
  return new SharedProjectMirror(
    filesystemSharedProjectFiles(root, projectFileEffects(ref), assertCurrent),
    assertCurrent,
  );
};

const setWorkspace = async (root: string) => {
  const canonicalRoot = await fs.realpath(root);
  const registered = projectLibrary.findRoot(canonicalRoot);
  if (registered?.transitionPending) await projectModes.recover(registered.id);
  const shared = projectLibrary.findRoot(canonicalRoot);
  if (shared?.kind === 'shared' && shared.credentials) {
    if (shared.credentials.internalServer)
      shared.credentials.serverUrl = await internalServerUrl();
    await collaborationSessions.attach(
      shared.credentials,
      shared.localRoot ?? null,
    );
    return workspaceState();
  }
  if (projectTrash?.hasRoot(root)) throw Error('휴지통에서 먼저 복원해주세요.');
  resetClipboardContext();
  await lifecycle.preserve('switch-project');
  await projectSessions.activate(await fs.realpath(root));
  const activeRoot = requireWorkspace();
  await recoverProjectLayout(activeRoot);
  await ensureWorkspace();
  await filesystemProjectRepository(activeRoot).recover();
  await saveSettings();
  await projectLibrary.rememberLocal(
    activeRoot,
    await localProjectName(activeRoot),
  );
  await startWatcher();
  return workspaceState();
};

const bindAiLease = (
  client: CollaborationClient | null,
  lease: string | null,
): AiRunLease | undefined =>
  client && lease
    ? {
        valid: () => client.lease === lease,
        finish: (status, changes, model, failure) => {
          if (client.lease !== lease)
            throw new Error(
              '공동 AI 작업의 실행 권한이 만료되어 결과를 반영하지 않습니다.',
            );
          return client.finishAi(status, changes, model, failure);
        },
      }
    : undefined;
const bindRunEvents = (
  root: string,
  identity: AiEventIdentity,
  client: CollaborationClient | null,
  lease: string | null,
) => {
  const events = new AiRunEvents(identity, {
    publish: (event) => {
      if (projectSessions.matches(identity.projectSession ?? null))
        lastRunEvent = event;
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('codex:run-event', event);
    },
    persist: async (event) => {
      if (client) return;
      const store = loadedQueues.get(root);
      const task = store?.tasks.find((t) => t.runId === identity.runId);
      if (task && (task.status !== event.status || event.kind !== 'log')) {
        task.status = event.status;
        task.message = event.message;
        task.updatedAt = event.timestamp;
        await store!.save();
      }
    },
    progress: async (event) => {
      if (client && lease && client.lease === lease)
        await client.progress(event);
    },
    error: (error) => console.error('AI 예약 저장 실패', error),
  });
  return events;
};
type AiPreparation = { events?: AiRunEvents };

const startCodexRun = async (
  input: StartCodexRunInput,
  queuedTask?: AiQueueTask,
  preparation?: AiPreparation,
): Promise<StartCodexRunResult> => {
  const sessionRef = projectSessions.ref;
  if (currentCodexRun()) throw new Error('이미 실행 중인 AI 작업이 있습니다.');
  if (!isAiProvider(input.providerId))
    throw new CanvasError('GC-AI-009', '지원하지 않는 AI 제공자입니다.');
  const modelId = input.modelId?.trim() || null;
  const invalidReasoning = reasoningError(
    input.providerId,
    modelId,
    input.reasoningEffort,
  );
  if (invalidReasoning) throw new CanvasError('GC-AI-009', invalidReasoning);
  const reasoningEffort = input.reasoningEffort ?? null;
  if (
    modelId &&
    (modelId.length > 128 || !/^[a-zA-Z0-9._:/-]+$/.test(modelId))
  ) {
    throw new CanvasError('GC-AI-009', '올바르지 않은 AI 모델 ID입니다.');
  }
  const root = requireWorkspace(),
    client = projectSessions.client;
  const lease = client?.lease ?? null;
  const taskAbsolute = await projectPath(root, input.taskPath);
  const taskDocument = await readDocument(root, taskAbsolute);
  if (taskDocument.type !== 'ai-task')
    throw new Error('AI 작업 Markdown 파일만 실행할 수 있습니다.');

  const runId = sharedRunId ?? queuedTask?.runId ?? historyId();
  const createdAt = Date.now();
  const events = bindRunEvents(
    root,
    {
      runId,
      taskPath: input.taskPath,
      projectSession: sessionRef ?? undefined,
      fileLock: preparingFileLock ?? undefined,
      actorId: client?.state.memberId,
      providerId: input.providerId,
      modelId,
      reasoningEffort,
    },
    client,
    lease,
  );
  if (preparation) preparation.events = events;
  events.emit(
    'starting',
    'status',
    '입력 문서와 이전 결과를 보관하고 있습니다. 작업 관련 파일만 보호합니다.',
  );
  const connection = await getAiStatus(input.providerId);
  if (reasoningEffort && connection.supportsReasoningEffort === false)
    throw new CanvasError(
      'GC-AI-009',
      '추론 수준을 지정하려면 Claude Code를 업데이트해주세요.',
    );
  if (!connection.available || !connection.executablePath)
    throw new CanvasError('GC-AI-008', connection.message);
  if (!connection.authenticated)
    throw new CanvasError('GC-AI-008', connection.message);
  const executable =
    input.providerId === 'codex-cli'
      ? { executable: connection.executablePath!, prefix: [] }
      : await findOtherCli(input.providerId, collectProcess);
  if (!executable)
    throw new CanvasError('GC-AI-008', 'CLI 경로를 확인하지 못했습니다.');

  if (preparationCancelled) throw new Error('작업 준비를 중지했습니다.');
  projectSessions.assertCurrent(sessionRef);
  const baseline = await captureProject(root);
  const workspace = await fileStageWorkspace(root, runId);
  const service = new AiRunService(
    baseline,
    input.taskPath,
    workspace,
    filesystemProjectRepository(root),
    validateHtml,
  );
  const outputs = service.inspectInput();
  const records = fileAiRunRecords(root, runId, input.taskPath, workspace);
  await workspace.initialize(baseline);
  projectSessions.assertCurrent(sessionRef);
  const initialMeta = {
    id: runId,
    label: taskDocument.title,
    kind: 'ai' as const,
    status: 'starting' as const,
    createdAt,
    taskPath: input.taskPath,
    modelId,
    reasoningEffort,
    providerId: input.providerId,
    aiTask: taskHistoryRecord(baseline[input.taskPath]),
  };
  await saveHistory(root, {}, {}, initialMeta);
  if (preparationCancelled) throw new Error('작업 준비를 중지했습니다.');
  await records.task('running', {
    ai_provider: input.providerId,
    ai_model: modelId ?? 'default',
    ai_reasoning_effort: reasoningEffort,
    ai_run_id: runId,
    ai_started_at: new Date().toISOString(),
    ai_finished_at: null,
    ai_error: null,
  });
  const fileLock = taskFileLock(baseline, input.taskPath);
  const lockBaseline = {
    ...baseline,
    [input.taskPath]: await fs.readFile(taskAbsolute, 'utf8'),
  };

  events.setFileLock(fileLock);
  await workspace.configure(input.providerId, modelId, reasoningEffort);
  const run = new AiRunCoordinator(
    {
      sessionRef,
      root,
      fileLock,
      lockBaseline,
      baseline,
      taskPath: input.taskPath,
      history: initialMeta,
      outputs,
      requiresLease: Boolean(sharedRunId),
      prepared: {
        runId,
        taskId: input.taskPath,
        providerId: input.providerId,
        modelId,
        reasoningEffort,
        stage: workspace.directory,
        executable,
        prompt: aiRunPrompt(input.taskPath, input.providerId),
      },
    },
    {
      executor: aiExecutorFor(input.providerId),
      workflow: service,
      output: new ProviderRunOutput(input.providerId, (kind, message) =>
        events.emit('running', kind, message),
      ),
      events,
      records,
      lease: bindAiLease(client, lease),
      assertCurrent: () => projectSessions.assertCurrent(sessionRef),
      serial: (operation) => enqueueMutation(operation, sessionRef),
      complete: async () => {
        activeCodexRuns.delete(runId);
        if (sharedRunId === runId) sharedRunId = null;
        if (!client) await loadedQueues.get(root)?.save();
        if (projectSessions.matches(sessionRef)) {
          notifyWorkspaceChanged();
          void pumpAiQueue();
        }
      },
      error: (message, error) => console.error(message, error),
      appVersion: app.getVersion?.() ?? 'development',
    },
  );
  await run.prepare();
  if (preparationCancelled) throw new Error('작업 준비를 중지했습니다.');
  projectSessions.assertCurrent(sessionRef);
  activeCodexRuns.set(runId, run);
  void run
    .run()
    .catch((error) => console.error('AI 실행 종료 처리 실패', error));
  return {
    runId,
    taskPath: input.taskPath,
    status: 'starting',
    providerId: input.providerId,
    modelId,
    reasoningEffort,
  };
};

const guardedChannels = new Set([
  ...Object.keys(mutationLabels),
  'documents:update-layout',
  'sections:update-layout',
  'documents:set-collapsed',
  'workspace:select',
  'history:restore',
  'layouts:update',
  'edit:undo',
  'edit:redo',
  'sections:rename',
  'documents:delete-many',
]);
const propertyQueue = new PropertyQueue();
const drawingSignature = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const prepareCodexRun = async (
  runInput: StartCodexRunInput,
  authorized?: () => void,
  queuedTask?: AiQueueTask,
) => {
  assertEditable();
  const root = requireWorkspace(),
    sessionRef = projectSessions.ref,
    client = projectSessions.client;
  const preparation: AiPreparation = {};
  let lease = bindAiLease(client, client?.lease ?? null);
  if (client) {
    if (client.state.role !== 'admin')
      throw new Error('관리자만 AI를 실행할 수 있습니다.');
    const connection = await getAiStatus(runInput.providerId);
    if (!connection.available || !connection.authenticated)
      throw new CanvasError('GC-AI-008', connection.message);
  }
  projectSessions.assertCurrent(sessionRef);
  const taskPath = runInput.taskPath;
  preparingFileLock = runInput.approval
    ? null
    : taskFileLock(client?.files ?? (await captureProject(root)), taskPath);
  runPreparing = true;
  preparationCancelled = false;
  lastRunEvent = null;
  try {
    authorized?.();
    if (client) {
      const claimed = await claimSharedAiRun(client, runInput, queuedTask);
      if (!claimed) return null;
      if (runInput.approval) {
        runInput.taskPath = claimed.taskPath;
        preparingFileLock = claimed.fileLock;
      }
      sharedRunId = claimed.runId;
      lease = bindAiLease(client, client.lease);
      projectSessions.assertCurrent(sessionRef);
      await sharedProjectMirror(sessionRef, root).sync(claimed.files);
    }
    projectSessions.assertCurrent(sessionRef);
    return await startCodexRun(runInput, queuedTask, preparation);
  } catch (error) {
    const event = preparation.events?.latest() ?? null;
    await recordAiPreparationFailure({
      event,
      events: preparation.events,
      records: event
        ? fileAiRunRecords(root, event.runId, event.taskPath)
        : undefined,
      error,
      cancelled: preparationCancelled,
      lease,
    });
    throw error;
  } finally {
    runPreparing = false;
    preparingFileLock = null;
    if (!currentCodexRun()) sharedRunId = null;
  }
};

let pumpingAiQueue = false;
let queueShutdown = false;
const pumpAiQueue = async () => {
  if (
    pumpingAiQueue ||
    queueShutdown ||
    !projectSessions.root ||
    currentCodexRun() ||
    runPreparing ||
    updateRestartPrepared
  )
    return;
  pumpingAiQueue = true;
  const root = projectSessions.root,
    client = projectSessions.client;
  const sessionRef = projectSessions.ref;
  try {
    if (
      client &&
      (!client.state.connected ||
        client.state.role !== 'admin' ||
        client.state.pendingChanges ||
        client.state.aiQueueVersion !== 1 ||
        ['starting', 'running', 'validating'].includes(
          client.state.aiRun?.status ?? '',
        ))
    )
      return;
    const store = client ? null : await localQueue(root);
    if (store?.persistenceFailed) await store.save();
    const task = nextQueuedTasks(client?.state.aiQueue ?? store!.tasks)[0];
    if (!task) return;
    const connection = await getAiStatus(task.providerId);
    if (!connection.available || !connection.authenticated) {
      if (store) {
        const item = store.tasks.find((t) => t.taskId === task.taskId)!;
        const message = `실행 대기 · ${connection.message}`;
        if (
          await new AiQueueService(
            store,
            () => captureProject(root),
            historyId,
          ).wait(item, message)
        )
          notifyWorkspaceChanged();
      }
      return;
    }
    await enqueueMutation(async () => {
      if (
        root !== projectSessions.root ||
        client !== projectSessions.client ||
        currentCodexRun() ||
        runPreparing ||
        queueShutdown ||
        updateRestartPrepared
      )
        return;
      const item = store?.tasks.find((t) => t.taskId === task.taskId);
      if (item) {
        if (item.status !== 'queued') return;
        try {
          await new AiQueueService(
            store!,
            () => captureProject(root),
            historyId,
          ).start(item.taskId);
        } catch (error) {
          await finishWaitingTask(
            store!,
            item,
            'failed',
            (error as Error).message,
            root,
          );
          return;
        }
      }
      try {
        await prepareCodexRun(
          {
            taskPath: task.taskPath,
            providerId: task.providerId,
            modelId: task.modelId,
            reasoningEffort: task.reasoningEffort,
          },
          undefined,
          task,
        );
      } catch (error) {
        console.error('AI 예약 준비 실패', error);
        if (item && isQueuePending(item)) {
          await finishWaitingTask(
            store!,
            item,
            'failed',
            (error as Error).message,
            root,
          );
        }
        notifyWorkspaceChanged();
      }
    }, sessionRef);
  } catch (error) {
    console.error('AI 예약 실행 확인 실패', error);
  } finally {
    pumpingAiQueue = false;
  }
};

const finishWaitingTask = async (
  store: AiQueueStore,
  task: AiQueueTask,
  status: 'failed' | 'cancelled',
  message: string,
  root: string,
) => {
  await new AiQueueService(store, () => captureProject(root), historyId).finish(
    task,
    status,
    message,
  );
  const record = store.tasks.find((t) => t.taskId === task.taskId);
  await saveHistory(
    root,
    {},
    {},
    {
      id: task.runId,
      label: task.title,
      kind: 'ai',
      status,
      createdAt: task.createdAt,
      finishedAt: task.updatedAt,
      taskPath: task.taskPath,
      providerId: task.providerId,
      modelId: task.modelId,
      reasoningEffort: task.reasoningEffort,
      error: message,
      aiTask: taskHistoryRecord(record?.baseline[task.taskPath]),
    },
  ).catch((error) => console.error('AI 예약 기록 저장 실패', error));
  notifyWorkspaceChanged();
};

const enqueueAiTask = async (
  input: StartCodexRunInput,
): Promise<StartCodexRunResult> => {
  if (
    !isAiProvider(input.providerId) ||
    (input.modelId &&
      (input.modelId.length > 128 ||
        !/^[a-zA-Z0-9._:/-]+$/.test(input.modelId)))
  )
    throw new Error('AI 제공자와 모델을 확인해주세요.');
  const invalidReasoning = reasoningError(
    input.providerId,
    input.modelId,
    input.reasoningEffort,
  );
  if (invalidReasoning) throw new Error(invalidReasoning);
  let task: AiQueueTask;
  if (projectSessions.client)
    task = await projectSessions.client.enqueueAi(input);
  else {
    const root = requireWorkspace();
    const store = await localQueue(root);
    task = await new AiQueueService(
      store,
      () => captureProject(root),
      historyId,
    ).reserve(
      input,
      [...activeCodexRuns.values()].filter((run) => run.root === root),
    );
  }
  notifyWorkspaceChanged();
  return {
    runId: task.runId,
    taskPath: task.taskPath,
    status: task.status,
    providerId: task.providerId,
    modelId: task.modelId,
    reasoningEffort: task.reasoningEffort,
  };
};

const sharedEditors = new WeakMap<
  CollaborationClient,
  {
    ref: import('./contracts/project-session').ProjectSessionRef | null;
    service: SharedEditingService;
  }
>();
const sharedEditor = (client: CollaborationClient) => {
  const ref = projectSessions.ref;
  const cached = sharedEditors.get(client);
  if (
    cached &&
    cached.ref?.sessionId === ref?.sessionId &&
    cached.ref?.epoch === ref?.epoch
  )
    return cached.service;
  const assertCurrent = () => {
    projectSessions.assertCurrent(ref);
    if (projectSessions.client !== client)
      throw Error('공동 프로젝트 세션이 변경되었습니다.');
  };
  const project = {
    read: () => {
      assertCurrent();
      return {
        files: client.files,
        revisions: client.revisions,
        properties: client.properties,
        authorship: client.authorship,
      };
    },
    command: async (
      channel: import('./contracts/commands').CommandName,
      input: unknown,
    ) => {
      const result = await client.command(channel, input);
      return { result, historyId: client.lastCommandHistoryId };
    },
    changeHistory: (id: string, direction: 'undo' | 'redo') =>
      client.changeHistory(id, direction),
  };
  const mirror = sharedProjectMirror(ref, requireWorkspace());
  const service = new SharedEditingService({
    project,
    reader: new SharedWorkspaceReader(
      project.read,
      new CanvasView(),
      drawingSignature,
    ),
    journal: journal(),
    assertCurrent,
    assertAllowed: (channel, input) =>
      assertMutationAllowed(
        channel,
        channel === 'layouts:update'
          ? [(input as { updates: unknown }).updates]
          : [input],
      ),
    assertUnlocked: (paths) =>
      assertAiFilesUnlocked(currentAiFileLock(), paths),
    sync: (files) => {
      assertCurrent();
      return mirror.sync(files);
    },
    trash: (before, after) => {
      assertCurrent();
      return mirror.trash(before, after);
    },
    changed: () => {
      assertCurrent();
      notifyWorkspaceChanged();
    },
  });
  sharedEditors.set(client, { ref, service });
  return service;
};

const handle = (
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1],
) => {
  const invoke: Parameters<typeof ipcMain.handle>[1] = (event, ...args) => {
    const requestSession = projectSessions.ref;
    const sessionBound =
      channel.startsWith('projects:layout-') ||
      (channel !== 'workspace:select' &&
        !channel.startsWith('projects:') &&
        (guardedChannels.has(channel) ||
          /^(?:documents|sections|assets|history|preview|drawings|game-ui|canvases|canvas|requests):/.test(
            channel,
          ) ||
          Object.hasOwn(commandLabels, channel) ||
          [
            'codex:start',
            'files:import',
            'clipboard:canvas-paste',
            'documents:set-color',
            'preview:save-window',
          ].includes(channel)));
    const clipboardInput = args[0] as
      | (CanvasClipboardPasteInput & { clipboardContextId?: string })
      | undefined;
    if (
      channel === 'files:import' &&
      (args[0] as ImportFilesInput)?.files !== undefined
    ) {
      if (!isUpdateSender(event))
        throw new Error('앱의 캔버스에서만 파일을 불러올 수 있습니다.');
      assertClipboardContext(clipboardInput?.scope, clipboardInput?.contextId);
    }
    if (
      channel.startsWith('clipboard:canvas-') ||
      clipboardInput?.clipboardContextId
    ) {
      if (!isUpdateSender(event))
        throw new Error('앱의 캔버스에서만 클립보드를 사용할 수 있습니다.');
    }
    let preparedClipboard: Promise<ClipboardContents> | undefined;
    if (channel === 'clipboard:canvas-paste') {
      assertClipboardContext(clipboardInput?.scope, clipboardInput?.contextId);
      if (
        !clipboardInput ||
        typeof clipboardInput.requestId !== 'string' ||
        !UUID_PATTERN.test(clipboardInput.requestId) ||
        !Number.isFinite(clipboardInput.x) ||
        !Number.isFinite(clipboardInput.y) ||
        Math.abs(clipboardInput.x) > 1_000_000 ||
        Math.abs(clipboardInput.y) > 1_000_000 ||
        !['asset', 'diagram'].includes(clipboardInput.imagePurpose)
      )
        throw new CanvasError(
          'GC-IMPORT-001',
          '붙여넣을 위치와 이미지 용도를 확인해주세요.',
        );
      const expected =
        clipboardCopy?.contextId === clipboardContextId &&
        clipboardCopy.senderId === event.sender.id &&
        clipboardCopy.copyId === clipboardInput.internalCopyId
          ? clipboardCopy.copyId
          : undefined;
      preparedClipboard = clipboard.read().then((items) =>
        readCanvasClipboard(items, expected, (bytes, ext) => {
          if (ext !== 'png' && ext !== 'jpg') return;
          const image = nativeImage.createFromBuffer(bytes);
          const size = image.getSize();
          if (
            image.isEmpty() ||
            !size.width ||
            !size.height ||
            size.width * size.height > 32_000_000
          )
            throw new CanvasError(
              'GC-IMPORT-002',
              '클립보드 이미지를 읽을 수 없습니다. 다시 복사해주세요.',
            );
        }),
      );
      void preparedClipboard.catch(() => undefined);
    }
    if (
      (channel.startsWith('projects:trash') ||
        channel.startsWith('projects:shared-')) &&
      (!mainWindow ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame)
    )
      throw Error('앱의 홈 화면에서만 휴지통을 조작할 수 있습니다.');
    if (updateRestartPrepared)
      throw new Error('[GC-UPD-004] 업데이트 재시작을 준비하고 있습니다.');
    pendingAppOperations += 1;
    const dispatch = async () => {
      // Read before joining the mutation queue, so project switching can cancel a slow read.
      if (preparedClipboard) await preparedClipboard;
      if (sessionBound) projectSessions.assertCurrent(requestSession);
      if (projectSessions.client) {
        const client = projectSessions.client;
        if (channel === 'files:import' || channel === 'clipboard:canvas-paste')
          return enqueueMutation(async () => {
            await assertMutationAllowed(channel, args);
            return listener(
              event,
              ...args,
              ...(preparedClipboard ? [await preparedClipboard] : []),
            );
          });
        const shared = dispatchSharedEditingIpc(
          channel,
          args,
          sharedEditor(client),
          (operation) => enqueueMutation(operation, requestSession),
        );
        if (shared.handled) return shared.value;
        if (channel === 'workspace:get')
          return {
            session: projectSessions.ref ?? undefined,
            root: projectSessions.root,
            clipboardContextId,
            name: client.state.projectName ?? '공동 프로젝트',
            saveScope: documentSaveScope(),
          };
        if (channel === 'history:list') return client.history();
        if (channel === 'requests:list') return client.listApprovals();
        if (channel === 'requests:read')
          return client.readApproval(args[0] as string);
        if (channel === 'requests:mutate')
          return client.mutateApproval(
            args[0] as 'create' | 'update' | 'cancel' | 'feedback',
            args[1] as import('./gamejam-approval').ApprovalMutation,
          );
        if (channel === 'history:read')
          return client.readHistory(
            args[0] as string,
            args[1] as string,
            args[2] as string,
          );
        if (channel === 'history:restore')
          return client.restore(
            args[0] as string,
            args[1] as string,
            args[2] as string,
          );
        if (channel === 'codex:active')
          return currentCodexRun() || runPreparing
            ? lastRunEvent
            : (client.state.aiRun ?? null);
        if (channel === 'codex:cancel')
          return (async () => {
            await client.cancelAi(args[0] as string);
            const run = activeCodexRuns.get(args[0] as string);
            if (run) {
              await run.cancel(true);
            }
            if (runPreparing) preparationCancelled = true;
          })();
        if (channel === 'path:reveal' || channel === 'workspace:open-folder')
          return enqueueMutation(async () => {
            await sharedProjectMirror(requestSession, requireWorkspace()).sync(
              client.files,
            );
            projectSessions.assertCurrent(requestSession);
            return listener(event, ...args);
          }, requestSession);
      }
      if (channel === 'codex:start') {
        const input = args[0] as StartCodexRunInput;
        const operation = input.approval
          ? approvalExecution(
              () => {
                projectSessions.assertCurrent(requestSession);
                if (
                  !projectSessions.client ||
                  projectSessions.client.state.role !== 'admin'
                )
                  throw new Error('관리자만 AI를 실행할 수 있습니다.');
              },
              async () => {},
              input.queueVersion === 1,
            ).start(input)
          : enqueueMutation(() =>
              input.queueVersion === 1
                ? enqueueAiTask(input)
                : prepareCodexRun(input),
            );
        return operation.then((result) => {
          void pumpAiQueue();
          return result;
        });
      }
      if (
        !guardedChannels.has(channel) &&
        !channel.startsWith('projects:') &&
        channel !== 'documents:set-color'
      )
        return listener(event, ...args);
      return enqueueMutation(async () => {
        await assertMutationAllowed(channel, args);
        if (channel === 'workspace:select' || channel.startsWith('projects:'))
          return listener(event, ...args);
        const root = requireWorkspace(),
          editJournal = journal();
        const assertCurrent = () =>
          projectSessions.assertCurrent(requestSession);
        return new LocalMutationService({
          project: filesystemProjectRepository(root, assertCurrent),
          assertCurrent,
          record: (before, after, label) =>
            userEdits(root, requestSession, editJournal).record(
              before,
              after,
              label,
            ),
          changed: notifyWorkspaceChanged,
        }).execute(channel, args, async () =>
          listener(
            event,
            ...args,
            ...(preparedClipboard ? [await preparedClipboard] : []),
          ),
        );
      });
    };
    const layoutInput = args[0] as {
      relativePath?: string;
      position?: boolean;
      size?: boolean;
    };
    const compact =
      [
        'documents:update-layout',
        'sections:update-layout',
        'documents:set-color',
      ].includes(channel) && layoutInput?.relativePath;
    const operation = compact
      ? propertyQueue.submit(
          `${requestSession?.sessionId ?? ''}:${channel}:${layoutInput.relativePath}:${layoutInput.position}:${layoutInput.size}`,
          dispatch,
        )
      : guardedChannels.has(channel) ||
          commandLabels[channel] ||
          channel.startsWith('projects:')
        ? propertyQueue.flush().then(dispatch)
        : dispatch();
    return operation
      .then((value) => {
        if (sessionBound) projectSessions.assertCurrent(requestSession);
        return value;
      })
      .catch((error) => {
        const failure = failureInfo(
          error,
          channel.startsWith('codex:') || channel === 'tasks:create'
            ? 'GC-AI-001'
            : channel.startsWith('collaboration:')
              ? 'GC-COLLAB-001'
              : guardedChannels.has(channel)
                ? 'GC-EDIT-001'
                : 'GC-APP-001',
        );
        throw new Error(errorText(failure));
      })
      .finally(() => {
        pendingAppOperations -= 1;
      });
  };
  const cachedInvoke: Parameters<typeof ipcMain.handle>[1] = (
    event,
    ...args
  ) => {
    const input = args[0] as
      | {
          requestId?: string;
          scope?: string;
          contextId?: string;
          clipboardContextId?: string;
        }
      | undefined;
    if (
      (channel === 'clipboard:canvas-paste' || input?.clipboardContextId) &&
      input?.requestId
    ) {
      if (!isUpdateSender(event))
        throw new Error('앱의 캔버스에서만 클립보드를 사용할 수 있습니다.');
      assertClipboardContext(
        input.scope,
        input.contextId ?? input.clipboardContextId,
      );
      if (
        typeof input.requestId !== 'string' ||
        !UUID_PATTERN.test(input.requestId)
      )
        throw new Error('붙여넣기 요청이 올바르지 않습니다.');
      return clipboardRequests.run(
        `${event.sender.id}:${clipboardContextId}:${channel}:${input.requestId}`,
        () => Promise.resolve(invoke(event, ...args)),
      );
    }
    return invoke(event, ...args);
  };
  ipcMain.handle(channel, cachedInvoke);
  return cachedInvoke;
};

const applyImportedFiles = async (
  payload: ImportBatchInput,
  context?: CanvasClipboardPasteInput,
) => {
  const root = requireWorkspace(),
    session = projectSessions.ref,
    client = projectSessions.client;
  const assertCurrent = () => projectSessions.assertCurrent(session);
  const editJournal = journal();
  const service = new FileImportService(
    client
      ? {
          assertCurrent,
          shared: {
            state: () => client.state,
            command: async (input) =>
              (await client.command(
                'files:import-batch',
                input,
              )) as CanvasDocument[],
            acknowledge: () => {
              if (client.lastCommandHistoryId)
                editJournal.push({
                  id: client.lastCommandHistoryId,
                  label: '파일 불러오기',
                });
            },
            changed: notifyWorkspaceChanged,
          },
        }
      : {
          assertCurrent,
          repository: filesystemProjectRepository(root, assertCurrent),
          assertMutation: (before, after) =>
            assertAiMutation(currentAiFileLock(), before, after),
        },
  );
  return service.import(
    payload,
    context
      ? {
          assertCurrent: () =>
            assertClipboardContext(context.scope, context.contextId),
          cancelled: () => context.contextId !== clipboardContextId,
          record: (before, after) =>
            userEdits(root, session, editJournal).record(
              before,
              after,
              payload.files.every((file) => file.name.startsWith('clipboard-'))
                ? '이미지 붙여넣기'
                : '파일 붙여넣기',
            ),
        }
      : undefined,
  );
};

let discordApproval: DiscordApprovalService | null = null;
let discordSettingsQueue: Promise<unknown> = Promise.resolve();
const flushDiscordEditors = () =>
  new Promise<void>((resolve, reject) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      reject(Error('Game Jam! 앱을 열어주세요.'));
      return;
    }
    const id = randomUUID();
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        Error(
          '앱의 편집 내용을 저장하지 못했습니다. 앱 상태를 확인한 뒤 다시 승인해주세요.',
        ),
      );
    }, 15_000);
    const cleanup = () => {
      clearTimeout(timeout);
      ipcMain.off('discord-approval:prepared', done);
    };
    const done = (
      event: Electron.IpcMainEvent,
      replyId: string,
      ok: boolean,
    ) => {
      if (
        replyId !== id ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return;
      cleanup();
      if (ok) resolve();
      else
        reject(
          Error('저장하지 못한 편집 내용이 있습니다. 앱에서 확인해주세요.'),
        );
    };
    ipcMain.on('discord-approval:prepared', done);
    window.webContents.send('discord-approval:prepare', id);
  });
const approvalExecution = (
  check: () => void,
  prepare: () => Promise<unknown>,
  queueRequested = true,
) =>
  new ApprovalService<StartCodexRunResult | null>({
    assertAuthorized: check,
    prepare,
    serial: enqueueMutation,
    queueSupported: () =>
      queueRequested && projectSessions.client?.state.aiQueueVersion === 1,
    updating: () => updateRestartPrepared,
    busy: aiIsActive,
    reserve: enqueueAiTask,
    execute: prepareCodexRun,
  });
const discordContext = (): DiscordApprovalContext | null => {
  const client = projectSessions.client,
    root = projectSessions.root;
  if (
    !client ||
    !root ||
    !client.state.connected ||
    client.state.role !== 'admin' ||
    client.state.accessDenied ||
    client.state.awaitingResume ||
    client.state.projectDeleted ||
    client.state.requestApprovalVersion !== 1 ||
    client.offline ||
    client.outgoing ||
    client.state.pendingChanges
  )
    return null;
  const check = () => {
    if (
      projectSessions.client !== client ||
      projectSessions.root !== root ||
      !discordContext()
    )
      throw Error('연결한 프로젝트와 관리자 권한·동기화 상태를 확인해주세요.');
  };
  return {
    serverUrl: client.credentials.serverUrl,
    projectId: client.credentials.projectId,
    memberId: client.state.memberId!,
    projectName: client.state.projectName || '공동 프로젝트',
    list: () => {
      check();
      return client.listApprovals();
    },
    read: (id) => {
      check();
      return client.readApproval(id);
    },
    documents: (id, revision, reviewToken) => {
      check();
      return client.readApprovalDocuments(id, revision, reviewToken);
    },
    feedback: async (id, revision, message, commandId) => {
      check();
      await client.mutateApproval('feedback', {
        id,
        revision,
        message,
        commandId,
      });
    },
    start: async (approval, settings, authorized) => {
      pendingAppOperations += 1;
      try {
        await approvalExecution(check, async () => {
          await flushDiscordEditors();
          await propertyQueue.flush();
        }).start(
          {
            approval,
            taskPath: '',
            providerId: settings.providerId,
            modelId: settings.modelId || null,
            reasoningEffort: settings.reasoningEffort,
          },
          authorized,
        );
      } finally {
        pendingAppOperations -= 1;
      }
    },
  };
};

const registerIpc = () => {
  registerDiscordApprovalIpc({
    register: (channel, listener) => ipcMain.handle(channel, listener),
    isSender: isUpdateSender,
    service: () =>
      (discordApproval ??= new DiscordApprovalService(
        new DiscordApprovalStore(app.getPath('userData'), safeStorage),
        discordContext,
        async (action, failure) => {
          const { DiscordBotTransport } = await import('./discord-transport');
          return new DiscordBotTransport(action, failure);
        },
      )),
    queue: () => discordSettingsQueue,
    setQueue: (queue) => {
      discordSettingsQueue = queue;
    },
    updatePrepared: () => updateRestartPrepared,
  });
  registerMultiplayerWindows({
    preload: path.join(__dirname, 'multiplayer-player-preload.cjs'),
    credentials: () =>
      mainWindow && !mainWindow.isDestroyed()
        ? projectSessions.client?.credentials
        : undefined,
    memberId: () => projectSessions.client?.state.memberId,
    isMainSender: isUpdateSender,
    currentHtml: async (relative) => {
      if (typeof relative !== 'string' || !isPreviewPath(relative))
        return undefined;
      if (projectSessions.client) return projectSessions.client.files[relative];
      if (!projectSessions.root) return undefined;
      return desktopPaths().readPreview(relative);
    },
  });
  handle(
    'clipboard:canvas-copy',
    async (event, input: CanvasClipboardCopyInput) => {
      assertClipboardContext(input?.scope, input?.contextId);
      if (
        !input ||
        typeof input.copyId !== 'string' ||
        !UUID_PATTERN.test(input.copyId)
      )
        throw new Error('복사할 자료가 올바르지 않습니다.');
      await clipboard.write([
        new ClipboardItem({
          [CANVAS_CLIPBOARD_MIME]: new Blob([
            JSON.stringify({ version: 1, copyId: input.copyId }),
          ]),
        }),
      ]);
      assertClipboardContext(input.scope, input.contextId);
      clipboardCopy = {
        copyId: input.copyId,
        contextId: clipboardContextId,
        senderId: event.sender.id,
      };
    },
  );
  handle(
    'clipboard:canvas-paste',
    async (
      _event,
      input: CanvasClipboardPasteInput,
      contents: ClipboardContents,
    ): Promise<CanvasClipboardPasteResult> => {
      assertClipboardContext(input.scope, input.contextId);
      if (contents.kind !== 'images' && contents.kind !== 'paths')
        return contents;
      const files =
        contents.kind === 'paths'
          ? await readImportSources(
              contents.paths.map((path) => ({ path })),
              () => assertClipboardContext(input.scope, input.contextId),
            )
          : contents.files;
      const documents = await applyImportedFiles(
        {
          canvasId: input.canvasId,
          x: input.x,
          y: input.y,
          imagePurpose: input.imagePurpose,
          files,
        },
        input,
      );
      return {
        kind: contents.kind === 'paths' ? 'files' : 'images',
        documents,
      };
    },
  );
  draftStore = new EditorDraftStore(
    path.join(app.getPath('userData'), 'editor-drafts'),
  );
  handle('drafts:get', (_event, key: string) => draftStore.get(key));
  handle(
    'drafts:set',
    (
      _event,
      key: string,
      draft: import('./editor-drafts.ts').EditorDraft | null,
      sequence: number,
    ) => {
      if (
        projectTrash
          ?.list()
          .some((r) =>
            projectStorageKey(key, [
              r.originalPath,
              r.projectId.replace(/^shared:/, ''),
            ]),
          )
      )
        throw Error('휴지통에 있는 프로젝트에는 초안을 저장할 수 없습니다.');
      return draftStore.set(key, draft, sequence);
    },
  );
  const canvasService = new LocalCanvasService(() => {
    const session = projectSessions.ref;
    return filesystemProjectRepository(requireWorkspace(), () =>
      projectSessions.assertCurrent(session),
    );
  }, drawingSignature);
  registerCanvasIpc(handle, canvasService, () => {
    const session = projectSessions.ref;
    return new ProjectSettingsService(
      filesystemTextFiles(requireWorkspace(), () =>
        projectSessions.assertCurrent(session),
      ),
    );
  });
  registerPreviewIpc(handle, () => {
    const root = requireWorkspace(),
      session = projectSessions.ref;
    const assertCurrent = () => projectSessions.assertCurrent(session);
    return new ProjectPreviewService({
      project: filesystemProjectRepository(root, assertCurrent),
      files: filesystemTextFiles(root, assertCurrent),
      mutate: (action) => enqueueMutation(action),
      assertUnlocked: (paths) => {
        assertCurrent();
        assertAiFilesUnlocked(currentAiFileLock(), paths);
      },
    });
  });
  registerEditingIpc(handle, () => {
    const root = requireWorkspace(),
      session = projectSessions.ref;
    const assertCurrent = () => projectSessions.assertCurrent(session);
    const repository = filesystemProjectRepository(root, assertCurrent);
    const publisher = filesystemCommandPublisher(
      root,
      repository,
      projectFileEffects(session),
    );
    return new LocalCommandService(
      repository,
      undefined,
      new RecordedCommandPublisher(
        publisher,
        userEdits(root, session),
        notifyWorkspaceChanged,
      ),
    );
  });

  const { read: readQueuedDocument, write: writeQueuedDocument } =
    registerDocumentIpc(handle, {
      documents: listDocuments,
      sections: listSections,
      section: () => {
        const root = requireWorkspace(),
          session = projectSessions.ref;
        const assertCurrent = () => projectSessions.assertCurrent(session);
        const reader = filesystemProjectReader(root, assertCurrent);
        return new LocalSectionService({
          sections: reader.sections,
          listDocuments: reader.documents,
          documents: filesystemDocumentRepository(root, assertCurrent),
          markdown: markdownCodec,
          trash: async (paths) => {
            for (const relative of paths) {
              assertCurrent();
              const absolute = await projectPath(root, relative);
              assertCurrent();
              await shell.trashItem(absolute);
            }
          },
          reportError: (message, error) => console.error(message, error),
        });
      },
      creation: () => {
        const root = requireWorkspace(),
          session = projectSessions.ref;
        const assertCurrent = () => projectSessions.assertCurrent(session);
        return new LocalCreationService({
          project: filesystemProjectRepository(root, assertCurrent),
          documents: filesystemDocumentRepository(root, assertCurrent),
          markdown: markdownCodec,
          environment: { now: Date.now, id: randomUUID },
          validatePath: async (relative) => {
            await projectPath(root, relative);
            assertCurrent();
          },
        });
      },
      editing: () => {
        const root = requireWorkspace(),
          session = projectSessions.ref;
        return new DocumentEditingService(
          filesystemDocumentRepository(root, () =>
            projectSessions.assertCurrent(session),
          ),
        );
      },
    });
  handle(
    'game-ui:export-png',
    async (event, input: { scope: string; name: string; data: string }) => {
      if (
        !isUpdateSender(event) ||
        input.scope !== documentSaveScope() ||
        typeof input.name !== 'string' ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.data) ||
        input.data.length > 32_000_000
      )
        throw new Error('내보낼 게임 UI 이미지를 확인해주세요.');
      const session = projectSessions.ref;
      return exportGameUiPng(input, mainWindow!, () =>
        projectSessions.assertCurrent(session),
      );
    },
  );
  handle('files:import', (_event, input: ImportFilesInput) => {
    const session = projectSessions.ref;
    return importSelectedFiles(
      input,
      applyImportedFiles,
      () => projectSessions.assertCurrent(session),
      () => assertImportAccess(projectSessions.client?.state),
    );
  });
  const suspendProject = () => collaborationSessions.suspend();
  registerCollaborationSessionIpc(
    handle,
    new CollaborationService(collaborationSessions),
    (operation) => {
      const ref = projectSessions.ref;
      return propertyQueue.flush().then(() => enqueueMutation(operation, ref));
    },
    (event) => {
      if (!isUpdateSender(event))
        throw Error('앱의 프로젝트 화면에서 실행해주세요.');
    },
  );
  handle('web-viewer:get', () => desktopBootstrap.webViewer().status());
  handle('web-viewer:open', async () => {
    const settings = await desktopBootstrap.webViewer().settings();
    await shell.openExternal(
      settings
        ? `${WEB_VIEWER_URL}/#connect=${encodeURIComponent(settings.accessCode)}`
        : WEB_VIEWER_URL,
    );
  });
  handle(
    'web-viewer:publish',
    async (_event, input: { projects: string[]; liveLocal: boolean }) => {
      if (
        !input ||
        !Array.isArray(input.projects) ||
        input.projects.length > 100 ||
        typeof input.liveLocal !== 'boolean'
      )
        throw new Error('게시할 프로젝트를 확인해주세요.');
      const service = desktopBootstrap.webViewer();
      const settings = await service.settings();
      if (!settings) throw new Error('웹 뷰어 연결 설정이 필요합니다.');
      for (const id of input.projects) projectLibrary.get(id);
      await service.save({
        ...settings,
        projects: [...new Set([...settings.projects, ...input.projects])],
        liveLocal: input.liveLocal,
      });
      return service.publish(true);
    },
  );
  const homeProjects = new ProjectHomeService({
    createShared: (input) => projectModes.createDirect(input),
    beforeOpen: (id) => projectModes.recover(id),
    registry: homeProjectRegistry(projectLibrary),
    local: filesystemHomeProjects,
    shared: desktopSharedProjects({
      beginReveal: () => {
        const ref = projectSessions.ref;
        return () => projectSessions.assertCurrent(ref);
      },
      prepareFiles: async (root, files, assertCurrent) => {
        const effects =
          projectSessions.root === root
            ? projectFileEffects(projectSessions.ref)
            : {
                pauseWatcher: async () => async () => {},
                trashItem: async (absolute: string) => {
                  await shell.trashItem(absolute);
                },
              };
        await new SharedProjectMirror(
          filesystemSharedProjectFiles(root, effects, assertCurrent),
          assertCurrent,
        ).sync(files);
      },
      library: projectLibrary,
      userData: app.getPath('userData'),
      active: () => projectSessions.client,
      internalServerUrl,
      drainCache: async () => {
        await collaborationCache.drain();
      },
    }),
    session: {
      current: () => ({
        root: projectSessions.root,
        sharedId: projectSessions.client?.credentials.projectId,
        connected: projectSessions.client?.state.connected,
      }),
      workspace: workspaceState,
      suspend: suspendProject,
      openLocal: setWorkspace,
      openShared: async (id) => {
        const entry = projectLibrary.get(id);
        const credentials = entry.credentials!;
        if (credentials.internalServer)
          credentials.serverUrl = await internalServerUrl();
        projectSessions.localRootBeforeShare = entry.localRoot ?? null;
        await attachCollaboration(credentials);
        return {
          root: projectSessions.root,
          name: projectSessions.client?.state.projectName ?? entry.name,
        };
      },
      checkHost: async () => {
        if (selfHost?.state.stage === 'ready') await selfHost.run('check');
      },
    },
    trash: {
      hasProject: (id) => projectTrash.hasProject(id),
      prepare: (id) => projectTrash.prepare(id),
      list: async () => projectTrash.list(),
      trash: (token, storage) => projectTrash.trash(token, storage),
      restore: (id) => projectTrash.restore(id),
      acknowledgeRestore: (id) => projectTrash.acknowledgeRestore(id),
      purge: (id, name, discard) => projectTrash.purge(id, name, discard),
      maintain: () => projectTrash.maintain(),
    },
    parseConnection: parseConnectionInfo,
    serverAddress,
    chooseParent: chooseProjectParent,
    reveal: async (root) => {
      const error = await shell.openPath(root);
      if (error) throw Error(error);
    },
    changed: notifyWorkspaceChanged,
    stopViewer: () => desktopBootstrap.stopViewerSync(),
    drainViewer: () => desktopBootstrap.webViewer().drain(),
    pauseSaves: async () => {
      await documentSaveQueue.pauseProject(() => true);
    },
    drainCache: async () => {
      await collaborationCache.drain();
    },
    startViewer: () => desktopBootstrap.startViewer(),
  });
  registerProjectIpc(handle, homeProjects, (event) => {
    if (!isUpdateSender(event))
      throw new Error('앱의 홈 화면에서 실행해주세요.');
  });
  const projectLayoutService = (event: Electron.IpcMainInvokeEvent) => {
    const root = requireWorkspace(),
      ref = projectSessions.ref,
      client = projectSessions.client;
    const assertCurrent = () => projectSessions.assertCurrent(ref);
    return new ProjectLayoutService({
      assertCurrent,
      capture: () =>
        client ? Promise.resolve({ ...client.files }) : captureProject(root),
      blocked: () =>
        aiIsActive() ||
        currentAiFileLock().paths.length ||
        currentAiFileLock().folders.length
          ? 'AI 실행·예약을 마친 뒤 정리해주세요.'
          : client &&
              (client.offline || client.outgoing || client.heldLocks.size)
            ? '문서 편집과 미동기화 작업을 마친 뒤 정리해주세요.'
            : undefined,
      shared: () =>
        client
          ? {
              supported: client.state.projectLayoutVersion === 2,
              connected: client.state.connected,
              admin: client.state.role === 'admin',
            }
          : null,
      preserve: async () => {
        const saves = await activateDocumentSaves(event);
        if (saves.some((save) => save.phase !== 'saved'))
          throw Error(
            '문서 저장과 충돌 해결을 마친 뒤 파일 구조를 정리해주세요. 초안은 보관됩니다.',
          );
        await lifecycle.preserve('switch-project');
        assertCurrent();
      },
      pause: projectFileEffects(ref).pauseWatcher,
      install: (files) => installProjectLayout(root, files, assertCurrent),
      upgradeShared: async () => {
        await client!.refresh();
        assertCurrent();
        const result = (await client!.request('layout-upgrade', {
          revision: client!.state.revision,
          deltaVersion: undefined,
          knownRevision: undefined,
        })) as import('./contracts/collaboration.ts').CollaborationEnvelope;
        assertCurrent();
        client!.accept(result);
        await collaborationCache.drain();
        return result.files;
      },
      record: async (before, after) => {
        await saveHistory(root, before, after, {
          id: historyId(),
          label: '프로젝트 파일 구조 정리',
          kind: 'restore',
          status: 'completed',
          createdAt: Date.now(),
          finishedAt: Date.now(),
        });
      },
      validate: checkSnapshot,
      changed: notifyWorkspaceChanged,
      markdown: layoutMarkdownCodec,
      links: remapLayoutMarkdown,
    });
  };
  handle('projects:layout-status', async (event) => {
    if (!isUpdateSender(event))
      throw Error('앱의 설정 화면에서만 파일 구조를 확인할 수 있습니다.');
    const session = projectSessions.ref;
    const status = await projectLayoutService(event).status();
    projectSessions.assertCurrent(session);
    return { ...status, session };
  });
  handle('projects:layout-upgrade', (event, session) => {
    if (!isUpdateSender(event))
      throw Error('앱의 설정 화면에서만 파일 구조를 정리할 수 있습니다.');
    projectSessions.assertCurrent(session);
    return projectLayoutService(event).upgrade();
  });
  registerProjectCopyIpc(handle, {
    sessions: projectSessions,
    library: projectLibrary,
    userData: app.getPath('userData'),
    internalServerUrl,
    journals: editJournals,
    trashed: (id) => projectTrash.hasProject(id),
    assertReadable: (paths) => {
      if (aiIsActive() && !executionFileLock())
        throw Error('AI 작업 완료 후 자료를 복사해주세요.');
      assertAiFilesUnlocked(currentAiFileLock(), paths);
    },
    assertSender: (event) => {
      if (!isUpdateSender(event)) throw Error('앱의 캔버스에서 복사해주세요.');
    },
    changed: notifyWorkspaceChanged,
  });
  handle('collaboration:test-users', async () => ({
    supported: true,
    isTestUser: !!testProfile,
    nickname: testNickname,
    maxWindows: MAX_TEST_WINDOWS,
    windows:
      (await testUserLauncher?.list(
        projectSessions.client?.credentials.projectId,
      )) ?? [],
  }));
  handle(
    'collaboration:launch-test-users',
    async (_event, input: LaunchTestUsersInput) => {
      if (testProfile || !projectSessions.client)
        throw new CanvasError(
          'GC-TEST-001',
          '원래 관리자 창에서 공동 프로젝트에 연결한 뒤 실행해주세요.',
        );
      if (!safeStorage.isEncryptionAvailable())
        throw new CanvasError(
          'GC-TEST-001',
          '이 PC에서 안전한 세션 저장을 사용할 수 없어 테스트 창을 실행하지 않습니다.',
        );
      testUserLauncher ??= new TestUserLauncher({
        base: defaultUserData,
        executable: process.execPath,
        appPath: app.getAppPath(),
        packaged: app.isPackaged,
      });
      return testUserLauncher.launch(projectSessions.client, input);
    },
  );
  handle('collaboration:start-local-server', async () => {
    if (!localCollaborationServer)
      localCollaborationServer = await createCollaborationServer({
        dataDirectory: path.join(
          app.getPath('userData'),
          'collaboration-server',
        ),
        creationKey: localCollaborationKey,
      });
    return { serverUrl: `http://127.0.0.1:${localCollaborationServer.port}` };
  });
  handle('codex:active', () =>
    currentCodexRun() || runPreparing ? lastRunEvent : null,
  );
  registerHistoryIpc(
    handle,
    () => {
      const root = requireWorkspace(),
        session = projectSessions.ref;
      const assertCurrent = () => projectSessions.assertCurrent(session);
      return new LocalHistoryService(
        filesystemProjectRepository(root, assertCurrent),
        projectFileEffects(session).pauseWatcher,
      );
    },
    () => {
      const root = requireWorkspace(),
        session = projectSessions.ref;
      const assertCurrent = () => projectSessions.assertCurrent(session);
      const repository = filesystemProjectRepository(root, assertCurrent);
      const publisher = filesystemHistoryPublisher(
        root,
        repository,
        projectFileEffects(session),
      );
      return new LocalEditHistoryService(repository, journal(), publisher, {
        id: historyId,
        now: Date.now,
      });
    },
    () => (projectSessions.root ? journal().state : { undo: null, redo: null }),
  );
  handle('workspace:get', async () => ({
    ...(await workspaceState()),
    saveScope: documentSaveScope(),
    clipboardContextId,
  }));
  handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '게임 프로젝트 폴더 선택',
    });
    if (result.canceled || !result.filePaths[0]) return workspaceState();
    await suspendProject();
    return setWorkspace(result.filePaths[0]);
  });
  documentSaveQueue = new DocumentSaveQueue(
    new DocumentSaveStore(
      path.join(app.getPath('userData'), 'document-save-queue'),
    ),
    (state) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed())
        mainWindow.webContents.send('document-saves:changed', state);
    },
  );
  let saveQueueContext:
    | {
        scope: string;
        root: string | null;
        client: typeof projectSessions.client;
        sessionId?: string;
      }
    | undefined;
  const activateDocumentSaves = async (event: Electron.IpcMainInvokeEvent) => {
    const scope = documentSaveScope(),
      root = projectSessions.root,
      client = projectSessions.client;
    const session = projectSessions.ref;
    if (
      saveQueueContext?.scope === scope &&
      saveQueueContext.root === root &&
      saveQueueContext.client === client &&
      saveQueueContext.sessionId === session?.sessionId
    )
      return documentSaveQueue.list(scope);
    saveQueueContext = { scope, root, client, sessionId: session?.sessionId };
    return documentSaveQueue.activate({
      resolvePath: async (relative) => {
        const layout = client
          ? readProjectLayout(client.files)
          : root
            ? await readDiskProjectLayout(root)
            : null;
        return layout?.aliases[relative] ?? relative;
      },
      session: session ?? undefined,
      scope,
      isCurrent: () =>
        projectSessions.matches(session) &&
        projectSessions.root === root &&
        projectSessions.client === client &&
        documentSaveScope() === scope,
      canSend: () =>
        !client ||
        (client.state.connected && !client.offline && !client.outgoing),
      read: (relative) =>
        readQueuedDocument(event, relative) as Promise<CanvasDocument | null>,
      write: (input) =>
        writeQueuedDocument(event, {
          ...input,
          queueScope: scope,
          queueSessionId: session?.sessionId,
        }) as Promise<CanvasDocument>,
    });
  };
  handle('document-saves:list', (event) => activateDocumentSaves(event));
  handle(
    'document-saves:enqueue',
    async (event, request: DocumentSaveRequest) => {
      if (request.scope !== documentSaveScope())
        throw new Error('프로젝트가 변경되었습니다.');
      await activateDocumentSaves(event);
      return documentSaveQueue.enqueue(request);
    },
  );
  handle('document-saves:flush', (_event, scope: string, key?: string) =>
    documentSaveQueue.flush(scope, key),
  );
  handle(
    'document-saves:discard',
    (_event, scope: string, key: string, sequence: number) => {
      if (scope !== documentSaveScope())
        throw new Error('프로젝트가 변경되었습니다.');
      return documentSaveQueue.discard(scope, key, sequence);
    },
  );
  handle('codex:status', getCodexStatus);
  handle('ai-queue:list', async () => {
    if (projectSessions.client)
      return projectSessions.client.state.aiQueue ?? [];
    if (!projectSessions.root) return [];
    return (await localQueue(projectSessions.root)).views();
  });
  handle('ai-queue:cancel', (_event, taskId: string) =>
    enqueueMutation(async () => {
      if (projectSessions.client) {
        await projectSessions.client.cancelQueuedTask(taskId);
        return;
      }
      const store = await localQueue(requireWorkspace());
      const task = store.tasks.find((t) => t.taskId === taskId);
      if (task?.status === 'cancelled') return;
      if (!task || task.status !== 'queued')
        throw new Error('취소할 예약을 찾을 수 없습니다.');
      await finishWaitingTask(
        store,
        task,
        'cancelled',
        '예약을 취소했습니다.',
        requireWorkspace(),
      );
    }),
  );
  handle('requests:list', () => {
    throw new Error('공동 프로젝트에서 요청함을 열어주세요.');
  });
  handle('requests:read', () => {
    throw new Error('공동 프로젝트에서 요청을 열어주세요.');
  });
  handle('requests:mutate', () => {
    throw new Error('공동 프로젝트에서 요청을 작성해주세요.');
  });
  handle('ai:status', (_event, providerId) => getAiStatus(providerId));
  handle('codex:start', async (_event, input: StartCodexRunInput) =>
    startCodexRun(input),
  );
  handle('codex:cancel', async (_event, runId: string) => {
    if (runPreparing && lastRunEvent?.runId === runId && !currentCodexRun()) {
      preparationCancelled = true;
      return;
    }
    await activeCodexRuns.get(runId)?.cancel(false, true);
  });
  registerProjectFilesIpc(handle, desktopPaths, (operation) =>
    enqueueMutation(operation),
  );
  handle('clipboard:copy', (_event, text: string) => clipboard.writeText(text));
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0f1115',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.resolve(__dirname, '../../assets/icon.png'),
    title: testProfile
      ? `${APP_NAME} · ${testNickname ?? '테스트 사용자'}`
      : APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const closingWindow = mainWindow;
  mainWindow.webContents.on('render-process-gone', resetClipboardContext);
  let draftsFlushed = false,
    closing = false,
    draftFlushReady = false;
  ipcMain.on('drafts:ready', (event) => {
    if (
      event.sender === closingWindow.webContents &&
      event.senderFrame === closingWindow.webContents.mainFrame
    )
      draftFlushReady = true;
  });
  closingWindow.on('close', (event) => {
    if (
      draftsFlushed ||
      !draftFlushReady ||
      closingWindow.webContents.isDestroyed()
    )
      return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    const flushed = async (ipcEvent: Electron.IpcMainEvent) => {
      if (
        ipcEvent.sender !== closingWindow.webContents ||
        ipcEvent.senderFrame !== closingWindow.webContents.mainFrame
      )
        return;
      ipcMain.removeListener('drafts:flushed', flushed);
      try {
        await propertyQueue.flush();
        await lifecycle.preserve('window-close');
        draftsFlushed = true;
        closingWindow.close();
      } catch {
        closing = false;
      }
    };
    ipcMain.on('drafts:flushed', flushed);
    ipcMain.once('drafts:flush-failed', () => {
      closing = false;
      ipcMain.removeListener('drafts:flushed', flushed);
    });
    closingWindow.webContents.send('drafts:flush-request');
  });
  selfHostLifecycle?.attach(closingWindow, () => {
    draftsFlushed = false;
    closing = false;
  });
  closingWindow.on('show', () => {
    draftsFlushed = false;
    closing = false;
  });

  // Remove the native menu, rather than auto-hiding it (Alt would reveal it).
  // Keep the standard title bar and Windows window controls intact.
  if (process.platform !== 'darwin') mainWindow.setMenu(null);
  installUiDebugShortcut(mainWindow.webContents);
  installPreviewPermissions(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (testProfile)
    mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : url.startsWith('file:');
    if (!allowed) event.preventDefault();
  });

  const window = mainWindow;
  await presentWindow(window, () =>
    MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
      : window.loadFile(
          path.join(
            __dirname,
            `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
          ),
        ),
  );
};

app.whenReady().then(async () => {
  if (process.platform === 'win32' && app.isPackaged && !testProfile) {
    await repairWindowsBranding(
      process.execPath,
      process.resourcesPath,
      app.getVersion(),
    ).catch((error) => console.error('Windows 앱 아이콘 갱신 실패', error));
  }
  if (testProfile) {
    try {
      const metadata = JSON.parse(
        await fs.readFile(path.join(testProfile, 'test-user.json'), 'utf8'),
      );
      if (typeof metadata.nickname === 'string')
        testNickname = metadata.nickname;
    } catch {
      /* The isolated profile remains usable for manual invitation. */
    }
  }
  await registerUpdates();
  projectLibrary = new ProjectLibrary(app.getPath('userData'), safeStorage);
  await projectLibrary.load();
  try {
    await projectModes.recover();
  } catch (error) {
    console.error(
      '프로젝트 전환 복구 보류',
      error instanceof Error ? error.message : '복구 실패',
    );
  }
  if (
    SELF_HOST_ENABLED &&
    !testProfile &&
    process.platform === 'win32' &&
    typeof app.getAppPath === 'function'
  ) {
    const feature = await desktopBootstrap.selfHost({
      developmentRoot: path.resolve(__dirname, '../..'),
      library: projectLibrary,
      activeProject: () => projectSessions.client?.credentials.projectId,
      window: () => mainWindow,
      updatePrepared: () => updateRestartPrepared,
      register: handle,
    });
    selfHost = feature.service;
    selfHostLifecycle = feature.lifecycle;
  }
  registerIpc();
  const scopeMatches = (
    entry: import('./project-library').SavedProject,
    scope: string,
  ) =>
    entry.kind === 'shared'
      ? scope.startsWith(`shared:${entry.projectId}:`)
      : scope.startsWith('local:') &&
        canonical(scope.slice(6)) === canonical(entry.root!);
  type TrashData = {
    queue: DocumentSaveRecord[];
    drafts: Record<string, EditorDraft>;
  };
  projectTrash = new ProjectTrash(
    app.getPath('userData'),
    projectLibrary,
    safeStorage,
    {
      capture: async (entry, keys) => {
        const queue = await documentSaveQueue.pauseProject((scope) =>
          scopeMatches(entry, scope),
        );
        const root =
          entry.kind === 'local'
            ? entry.root!
            : path.join(
                app.getPath('userData'),
                'shared-workspaces',
                entry.projectId!,
              );
        const identities = [entry.id, root, entry.projectId ?? ''].filter(
          Boolean,
        );
        const known = [...keys, ...queue.map((r) => r.request.key)];
        if (entry.kind === 'local') {
          const snapshot = await captureProject(root).catch(
            () => ({}) as Record<string, string>,
          );
          for (const [file, raw] of Object.entries(snapshot))
            if (file.endsWith('.md')) {
              const id = matter(raw).data.id;
              if (id)
                known.push(
                  `game-canvas-draft:${root}:${id}`,
                  `game-canvas-draft:${root}:${id}:conflict`,
                );
            }
        }
        return {
          queue,
          drafts: await draftStore.projectData(
            (key) => projectStorageKey(key, identities),
            known,
          ),
        } satisfies TrashData;
      },
      remove: async (entry, raw) => {
        const data = raw as TrashData;
        await documentSaveQueue.removeProject((scope) =>
          scopeMatches(entry, scope),
        );
        for (const key of Object.keys(data.drafts))
          await draftStore.set(key, null, Number.MAX_SAFE_INTEGER);
        const root =
          entry.kind === 'local'
            ? entry.root!
            : path.join(
                app.getPath('userData'),
                'shared-workspaces',
                entry.projectId!,
              );
        invalidateClientCache(root);
        const settings = await fs
          .readFile(settingsPath(), 'utf8')
          .then(JSON.parse)
          .catch(() => null);
        if (
          settings?.workspaceRoot &&
          canonical(settings.workspaceRoot) === canonical(root)
        )
          await fs.writeFile(
            settingsPath(),
            JSON.stringify({ workspaceRoot: null }),
          );
        await sessionStore().removeReferences(entry.projectId, root);
        const viewer = desktopBootstrap.webViewer(),
          config = await viewer.settings();
        if (config?.projects.includes(entry.id))
          await viewer.save({
            ...config,
            projects: config.projects.filter((id) => id !== entry.id),
          });
      },
      restore: async (entry, raw) => {
        const data = raw as TrashData;
        await documentSaveQueue.restoreProject(data.queue);
        for (const [key, value] of Object.entries(data.drafts))
          await draftStore.set(key, value, value.sequence);
        if (entry.projectId)
          invalidateClientCache(
            path.join(
              app.getPath('userData'),
              'shared-workspaces',
              entry.projectId,
            ),
          );
      },
    },
    [
      app.getPath('desktop'),
      app.getPath('documents'),
      typeof app.getAppPath === 'function' ? app.getAppPath() : '',
      process.env.WINDIR ?? '',
      process.env.ProgramFiles ?? '',
      path.join(app.getPath('userData'), 'collaboration-server'),
      path.resolve('tools/internet-host'),
      path.join(
        process.env.LOCALAPPDATA ?? app.getPath('userData'),
        'GameCanvas-InternetHost',
      ),
    ],
  );
  await projectTrash.load();
  await projectTrash.maintain();
  const trashTimer = setInterval(() => {
    void enqueueMutation(() => projectTrash.maintain()).catch((error) =>
      console.error('휴지통 정리 실패', error),
    );
  }, 30_000);
  trashTimer.unref();
  desktopBootstrap.startViewer();
  await loadSettings();
  if (projectSessions.root && projectTrash.hasRoot(projectSessions.root))
    await projectSessions.activate(null);
  if (projectSessions.root) {
    await projectLibrary.rememberLocal(
      projectSessions.root,
      path.basename(projectSessions.root),
    );
    await ensureWorkspace();
    await recoverInterruptedHistory(projectSessions.root);
    await startWatcher();
  }
  try {
    const { safeStorage } = await import('electron');
    if (safeStorage?.isEncryptionAvailable()) {
      let raw: string;
      if (testProfile && testBootstrapKey) {
        const bootstrapPath = path.join(testProfile, 'bootstrap.enc');
        raw = decryptTestBootstrap(
          await fs.readFile(bootstrapPath),
          testBootstrapKey,
        );
        await fs.unlink(bootstrapPath);
      } else {
        raw = JSON.stringify(await sessionStore().read());
      }
      const saved = JSON.parse(raw) as {
        credentials: CollaborationCredentials | null;
        localRoot: string | null;
      };
      if (saved.credentials) {
        if (projectTrash.hasSharedProject(saved.credentials.projectId))
          saved.credentials = null;
      }
      if (saved.credentials) {
        if (testProfile && saved.credentials.internalServer) {
          try {
            localCollaborationServer = await createCollaborationServer({
              dataDirectory: path.join(
                app.getPath('userData'),
                'collaboration-server',
              ),
              creationKey: localCollaborationKey,
            });
          } catch (error) {
            console.error('로컬 협업 서버 재시작 실패', error);
          }
        }
        projectSessions.localRootBeforeShare = saved.localRoot;
        if (testProfile) await attachCollaboration(saved.credentials);
        else {
          let name = '공동 프로젝트';
          let role: CollaborationRole | undefined;
          try {
            const cached = await readClientCache(
              path.join(
                app.getPath('userData'),
                'shared-workspaces',
                saved.credentials.projectId,
                'server-cache.json',
              ),
            );
            name = cached.state.projectName ?? name;
            role = cached.state.role;
          } catch {
            /* session remains selectable without cache */
          }
          if (
            !projectLibrary
              .list()
              .some((entry) => entry.projectId === saved.credentials!.projectId)
          )
            await projectLibrary.rememberShared(
              saved.credentials,
              name,
              role,
              saved.localRoot,
            );
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('공동 프로젝트 세션 복원 실패', error);
  }
  if (!testProfile) {
    await projectSessions.watcher?.close();
    projectSessions.setWatcher(null);
    await projectSessions.activate(null);
    projectSessions.localRootBeforeShare = null;
  }
  discordApproval ??= new DiscordApprovalService(
    new DiscordApprovalStore(app.getPath('userData'), safeStorage),
    discordContext,
    async (action, failure) => {
      const { DiscordBotTransport } = await import('./discord-transport');
      return new DiscordBotTransport(action, failure);
    },
  );
  // Restore asynchronously; network outages must not delay showing the app.
  discordSettingsQueue = discordApproval.resume();
  let presentationError: string | undefined;
  try {
    await createWindow();
  } catch (error) {
    presentationError = errorText(failureInfo(error));
    console.error(presentationError);
  }
  if (testProfile) {
    const windowVisible =
      !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    await fs
      .writeFile(
        path.join(testProfile, 'launch-status.json'),
        JSON.stringify({
          windowVisible,
          status:
            projectSessions.client?.state.connected &&
            windowVisible &&
            !presentationError
              ? 'ready'
              : 'failed',
          message:
            presentationError ??
            (projectSessions.client?.state.connected
              ? undefined
              : '자동 참여에 실패했습니다. 서버 연결과 초대 정보를 확인해주세요.'),
        }),
      )
      .catch(() => undefined);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      void createWindow().catch(console.error);
  });
  appUpdates.start();
  const aiQueueTimer = setInterval(() => void pumpAiQueue(), 1500);
  aiQueueTimer.unref();
});

app.on('window-all-closed', () => {
  for (const run of activeCodexRuns.values()) {
    void run.cancel(true);
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  queueShutdown = true;
  discordApproval?.stop();
  documentSaveQueue?.dispose();
  for (const error of desktopBootstrap.dispose())
    console.error('데스크톱 연결 종료 실패', error);
  void lifecycle
    .preserve('quit')
    .then(() => projectSessions.close())
    .catch((error) => console.error('프로젝트 종료 보존 실패', error));
  void localCollaborationServer?.close();
});
