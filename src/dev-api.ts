import {
  applyGameUi,
  snapshotGameUi,
  mergeGameUi,
  isGameUiPath,
} from './game-ui-model';
import matter from './game-ui-markdown';
import { defaultStatuses, validateStatuses } from './document-statuses';
import { statusPropertyApplied } from './file-properties';
import { readKanbanView, validateKanbanView } from './features/kanban/view';
let kanbanViewRaw: string | null = null;
let statusesRaw: string | null = null;
import {
  CANVAS_SHEETS_PATH,
  readCanvasSheets,
  canvasId,
} from './canvas-sheets';
import {
  applyDrawing,
  snapshotDrawings,
  mergeDrawingFile,
  isDrawingPath,
  drawingPath,
  readDrawingFile,
  serializeDrawing,
} from './drawing-model';
let drawingFiles: Record<string, string> = {};
let gameUiFiles: Record<string, string> = {};
import type {
  CanvasDocument,
  CanvasSection,
  CodexRunEvent,
  GameCanvasApi,
  PreviewResult,
  PreviewWindowState,
  HistoryEntry,
  CollaborationState,
  FileAuthorship,
} from './shared';
import { normalizePreviewWindow } from './preview-window';
import { EditJournal } from './edit-journal';
import {
  DocumentSaveQueue,
  type DocumentSaveRecord,
  type DocumentSaveState,
} from './document-save-queue';
import { resolveDocumentOutputs } from './document-output';
import type { DocumentOutputTemplate } from './document-format';
import { taskInstructions } from './task-instructions';
import { legacyTaskRecord } from './ai-task-records';
import {
  gamejamSnapshotFromInput,
  type GamejamSavedRequest,
} from './gamejam-history';
import { cardColor } from './card-colors';
import { assertAiFilesUnlocked } from './ai-file-lock';
import {
  verticalLayouts,
  NEW_FILE_GAP,
  enclosingRect,
  nearDocumentPosition,
} from './canvas-placement';
import {
  moveDestination,
  legacyResultMoves,
  type ResultMove,
} from './result-folder-plan';
import {
  displayHomeProjects,
  editHomeOrganization,
  readHomeOrganization,
  homeName,
  type HomeEdit,
  type HomeOrganization,
} from './home-organization';
import {
  DEFAULT_PREVIEW_PATH,
  assertPreviewPath,
  isPreviewPath,
  resolvePreviewOutput,
  previewVersion,
} from './preview-output';

const now = Date.now();
const taskInputs = new Map<string, string[]>();

let documents: CanvasDocument[] = [
  {
    id: 'raw-loop-note',
    title: '밤이 되면 달라지는 농장',
    type: 'idea',
    status: 'raw',
    relativePath: 'ideas/night-farm.md',
    body: '낮에는 농작물을 키우고, 밤에는 울타리와 자동 장치를 배치한다.\n\n플레이어가 직접 모든 일을 하지 않아도 농장이 움직이면 좋겠다.',
    x: 80,
    y: 100,
    width: 350,
    height: 360,
    collapsed: false,
    sources: [],
    modifiedAt: now,
  },
  {
    id: 'automation-note',
    title: '자동화 아이디어',
    type: 'idea',
    status: 'raw',
    relativePath: 'ideas/automation.md',
    body: '- 작물을 옮기는 컨베이어\n- 조건에 따라 작동하는 장치\n- 멀리서 농장 상태 확인',
    x: 500,
    y: 330,
    width: 330,
    height: 300,
    collapsed: false,
    sources: [],
    modifiedAt: now,
  },
  {
    id: 'core-loop',
    title: '핵심 게임 루프',
    type: 'system',
    status: 'draft',
    relativePath: 'docs/core-loop.md',
    body: '## 플레이 흐름\n\n1. 낮에 씨앗을 선택하고 심는다.\n2. 수확물로 자동화 장치를 해금한다.\n3. 밤에 장치의 효율을 관찰하고 배치를 개선한다.',
    x: 910,
    y: 100,
    width: 390,
    height: 420,
    collapsed: false,
    sources: [
      {
        id: 'raw-loop-note',
        contribution: '낮과 밤의 역할 구분',
      },
      {
        id: 'automation-note',
        contribution: '자동화 장치와 관찰 요소',
      },
    ],
    modifiedAt: now,
  },
];

let sheetsRaw: string | null = null;
let sections: CanvasSection[] = [
  {
    id: 'section-farm-automation',
    title: '농장 자동화 아이디어',
    relativePath: 'sections/section-farm-automation.md',
    x: 40,
    y: 60,
    width: 830,
    height: 630,
    members: [
      { id: 'raw-loop-note', path: 'ideas/night-farm.md' },
      { id: 'automation-note', path: 'ideas/automation.md' },
    ],
    modifiedAt: now,
  },
];

const initialPreview: PreviewResult = {
  exists: true,
  relativePath: 'output/index.html',
  content: `<!doctype html><html><body style="margin:0;background:#102016;color:#eff7e9;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><main style="text-align:center"><div style="font-size:64px">🌱</div><h1>자동 농장 프로토타입</h1><p>낮 3일차 · 순무 12개 수확</p><button style="padding:12px 20px;border:0;border-radius:999px;background:#d8ff72;font-weight:700">다음 날</button></main><script>let day=3;document.querySelector('button').onclick=()=>{document.querySelector('p').textContent='낮 '+(++day)+'일차 · 순무 12개 수확';};</script></body></html>`,
};
let previews: PreviewResult[] = [initialPreview];
const taskOutputs = new Map<string, { output: string; base?: string }>();
const taskRequests = new Map<string, GamejamSavedRequest>();
const taskDocumentOutputs = new Map<
  string,
  {
    outputs: string[];
    inputs: string[];
    x: number;
    y: number;
    systems?: boolean;
    bundleId?: string;
    templates?: DocumentOutputTemplate[];
  }
>();

const listeners = new Set<() => void>();
let devBatchActive = false;
const notify = () => {
  if (!devBatchActive) listeners.forEach((listener) => listener());
};
const runListeners = new Set<(event: CodexRunEvent) => void>();
let lastDevEvent: CodexRunEvent | null = null;
const previewWindows = new Map<string, PreviewWindowState>();
const histories: HistoryEntry[] = [];
const devAuthorship: Record<string, FileAuthorship> = {};
type DevState = {
  gameUiFiles: Record<string, string>;
  drawingFiles: Record<string, string>;
  sheetsRaw: string | null;
  documents: CanvasDocument[];
  sections: CanvasSection[];
  previews: PreviewResult[];
};
const historyStates = new Map<string, { before: DevState; after: DevState }>();
const devSnapshot = (): DevState =>
  structuredClone({
    documents,
    sections,
    previews,
    sheetsRaw,
    drawingFiles,
    gameUiFiles,
  });
const devFiles = (state: DevState): Record<string, string> =>
  Object.fromEntries([
    ...Object.entries(state.drawingFiles),
    ...Object.entries(state.gameUiFiles),
    ...(state.sheetsRaw ? [[CANVAS_SHEETS_PATH, state.sheetsRaw]] : []),
    ...state.documents.map((item) => [
      item.relativePath,
      `${JSON.stringify(item)}\n\n${item.body}`,
    ]),
    ...state.sections.map((item) => [
      item.relativePath,
      JSON.stringify(item, null, 2),
    ]),
    ...state.previews
      .filter((item) => item.exists)
      .map((item) => [item.relativePath, item.content]),
  ]);
const recordDevHistory = (
  before: DevState,
  after: DevState,
  label: string,
  kind: HistoryEntry['kind'],
  status: HistoryEntry['status'] = 'completed',
  taskPath?: string,
  modelId?: string | null,
  providerId?: import('./shared').AiProviderId,
) => {
  const left = devFiles(before),
    right = devFiles(after);
  const entry: HistoryEntry = {
    id: `dev-history-${Date.now()}-${histories.length}`,
    label,
    kind,
    status,
    createdAt: Date.now(),
    finishedAt: Date.now(),
    taskPath,
    modelId,
    providerId,
    files: [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .filter((relative) => left[relative] !== right[relative])
      .map((relativePath) => ({
        relativePath,
        before: left[relativePath] !== undefined,
        after: right[relativePath] !== undefined,
      })),
  };
  const task =
    before.documents.find((doc) => doc.relativePath === taskPath) ??
    after.documents.find((doc) => doc.relativePath === taskPath) ??
    after.documents.find(
      (doc) =>
        entry.files.some((file) => file.relativePath === doc.relativePath) &&
        doc.type === 'ai-task',
    );
  if (task)
    entry.aiTask = {
      ...legacyTaskRecord(task),
      origin: 'snapshot',
      requestSnapshot: taskRequests.get(task.relativePath),
    };
  histories.unshift(entry);
  if (status === 'completed') {
    const actor = {
      name: '로컬 사용자',
      kind: kind === 'ai' ? ('ai' as const) : ('local' as const),
    };
    for (const file of entry.files.filter((file) => file.after)) {
      const existing = devAuthorship[file.relativePath];
      const created =
        !file.before &&
        kind !== 'restore' &&
        !/^(실행 취소|다시 실행)/.test(label);
      devAuthorship[file.relativePath] = {
        ...existing,
        createdBy: existing?.createdBy ?? (created ? actor : undefined),
        createdAt:
          existing?.createdAt ?? (created ? entry.createdAt : undefined),
        lastEditedBy: actor,
        lastEditedAt: entry.createdAt,
      };
    }
  }
  historyStates.set(entry.id, { before, after });
};
let activeDevRun: {
  fileLock: NonNullable<CodexRunEvent['fileLock']>;
  runId: string;
  taskPath: string;
  modelId?: string | null;
  providerId: import('./shared').AiProviderId;
} | null = null;
const emitRun = (event: CodexRunEvent) => {
  lastDevEvent = event;
  runListeners.forEach((listener) => listener(event));
};

export function createDevGameCanvasApi(): GameCanvasApi {
  const moveDevResults = (moves: ResultMove[]) => {
    for (const { from, to } of moves) {
      if (from === to) continue;
      if (previews.some((item) => item.relativePath === to))
        throw new Error('이미 사용 중인 결과 폴더입니다.');
      previews = previews.map((item) =>
        item.relativePath === from
          ? {
              ...item,
              relativePath: to,
              sourceId: item.sourceId ?? item.relativePath,
              previousPaths: [from, ...(item.previousPaths ?? [])],
            }
          : item,
      );
      const state = previewWindows.get(from);
      if (state) {
        previewWindows.set(to, state);
        previewWindows.delete(from);
      }
      const replace = (raw: string) => raw.replaceAll(from, to);
      documents = documents.map(
        (document) =>
          JSON.parse(replace(JSON.stringify(document))) as CanvasDocument,
      );
    }
    notify();
    return moves;
  };
  const journal = new EditJournal();
  const changeHistory = (direction: 'undo' | 'redo') => {
    if (collab.active && (!collab.connected || collab.role === 'viewer'))
      throw new Error('현재 문서 편집을 사용할 수 없습니다.');
    const item = journal.peek(direction),
      stored = historyStates.get(item.id);
    if (!stored) throw new Error('기록을 찾을 수 없습니다.');
    const expected = direction === 'undo' ? stored.after : stored.before,
      desired = direction === 'undo' ? stored.before : stored.after;
    const left = devFiles(expected),
      right = devFiles(desired),
      current = devFiles(devSnapshot());
    const touched = Object.keys({ ...left, ...right }).filter(
      (key) => left[key] !== right[key],
    );
    assertAiFilesUnlocked(activeDevRun?.fileLock, touched);
    if (
      touched.some(
        (key) =>
          !isDrawingPath(key) &&
          !isGameUiPath(key) &&
          current[key] !== left[key],
      )
    )
      throw new Error('이후 변경과 충돌하여 중단했습니다.');
    const before = devSnapshot();
    for (const p of new Set([
      ...Object.keys(expected.drawingFiles),
      ...Object.keys(desired.drawingFiles),
    ])) {
      const raw = mergeDrawingFile(
        p,
        expected.drawingFiles[p],
        desired.drawingFiles[p],
        drawingFiles[p],
        true,
      );
      if (raw === undefined) delete drawingFiles[p];
      else drawingFiles[p] = raw;
    }
    for (const p of new Set([
      ...Object.keys(expected.gameUiFiles),
      ...Object.keys(desired.gameUiFiles),
    ])) {
      const raw = isGameUiPath(p)
        ? mergeGameUi(
            expected.gameUiFiles[p],
            desired.gameUiFiles[p],
            gameUiFiles[p],
            true,
          )
        : desired.gameUiFiles[p];
      if (raw === undefined) delete gameUiFiles[p];
      else gameUiFiles[p] = raw;
    }
    if (touched.includes(CANVAS_SHEETS_PATH)) sheetsRaw = desired.sheetsRaw;
    previews = [
      ...previews.filter((item) => !touched.includes(item.relativePath)),
      ...structuredClone(
        desired.previews.filter((item) => touched.includes(item.relativePath)),
      ),
    ];
    documents = [
      ...documents.filter((doc) => !touched.includes(doc.relativePath)),
      ...structuredClone(
        desired.documents.filter((doc) => touched.includes(doc.relativePath)),
      ),
    ];
    sections = [
      ...sections.filter((doc) => !touched.includes(doc.relativePath)),
      ...structuredClone(
        desired.sections.filter((doc) => touched.includes(doc.relativePath)),
      ),
    ];
    recordDevHistory(
      before,
      devSnapshot(),
      direction === 'undo' ? '실행 취소' : '다시 실행',
      'user',
    );
    journal.finish(direction, item.id);
    notify();
  };
  let collab: CollaborationState = {
    active: false,
    connected: false,
    members: [],
    locks: [],
  };
  const collabListeners = new Set<(state: CollaborationState) => void>();
  const emitCollab = () => {
    collabListeners.forEach((listener) => listener(structuredClone(collab)));
    return structuredClone(collab);
  };
  let home: HomeOrganization = { folders: [], projects: [] };
  let demoProjectName =
    localStorage.getItem('game-canvas-demo-project-name') || '밤의 농장';
  try {
    const saved = localStorage.getItem('game-canvas-demo-home');
    if (saved) home = readHomeOrganization(saved);
  } catch {
    /* Demo storage can be unavailable in private browsing. */
  }
  const editHome = async (edit: HomeEdit) => {
    if (edit.type === 'move-project' && edit.id !== 'demo-local')
      throw new Error('프로젝트를 찾을 수 없습니다.');
    const next = editHomeOrganization(home, edit);
    localStorage.setItem('game-canvas-demo-home', JSON.stringify(next));
    home = next;
  };
  const drafts = new Map<string, import('./editor-drafts').EditorDraft>();
  const saveRecords = new Map<string, DocumentSaveRecord>();
  const saveListeners = new Set<(state: DocumentSaveState) => void>();
  let publicApi: GameCanvasApi;
  const saveScope = 'local:dev-workspace';
  let previewClipboardId: string | undefined;
  const saveQueue = new DocumentSaveQueue(
    {
      load: async () => [],
      put: async (record) => {
        saveRecords.set(record.request.key, structuredClone(record));
      },
      remove: async (_scope, key) => {
        saveRecords.delete(key);
      },
      flush: async () => {},
    },
    (state) => saveListeners.forEach((listener) => listener(state)),
  );
  let activated = false;
  const activateSaves = async () => {
    if (activated) return saveQueue.list(saveScope);
    activated = true;
    return saveQueue.activate({
      scope: saveScope,
      isCurrent: () => true,
      canSend: () => !collab.active || collab.connected,
      read: (relative) => publicApi.getDocument(relative),
      write: (input) => publicApi.saveDocument(input),
    });
  };
  const api: GameCanvasApi = {
    getDocumentStatuses: async () => ({
      value: statusesRaw
        ? validateStatuses(JSON.parse(statusesRaw))
        : defaultStatuses(),
      raw: statusesRaw,
    }),
    saveDocumentStatuses: async (input) => {
      if (input.expected !== statusesRaw)
        throw Error('상태 설정이 변경되었습니다.');
      const value = validateStatuses(input.value);
      for (const d of documents)
        if (
          d.type !== 'ai-task' &&
          statusPropertyApplied(d) &&
          !value.statuses.some(
            (s) => s.id === (d.workflowStatusId ?? 'not-started'),
          )
        ) {
          const target =
            input.replacements?.[d.workflowStatusId ?? 'not-started'];
          if (!value.statuses.some((s) => s.id === target))
            throw Error('대체 상태를 지정해주세요.');
          d.workflowStatusId = target;
        }
      statusesRaw = JSON.stringify(value, null, 2);
      notify();
    },
    getKanbanView: async () => ({
      value: readKanbanView(
        kanbanViewRaw,
        statusesRaw
          ? validateStatuses(JSON.parse(statusesRaw))
          : defaultStatuses(),
      ),
      raw: kanbanViewRaw,
    }),
    saveKanbanView: async (input) => {
      if (input.expected !== kanbanViewRaw)
        throw Error('칸반 설정이 변경되었습니다.');
      kanbanViewRaw = JSON.stringify(validateKanbanView(input.value));
      notify();
    },
    moveKanbanCard: async (input) => {
      const d =
        documents.find((d) => d.id === input.objectId) ??
        previews.find((p) => p.sourceId === input.objectId);
      if (
        !d ||
        !statusPropertyApplied(d) ||
        d.workflowStatusId !== input.expectedStatus ||
        input.expectedView !== kanbanViewRaw
      )
        throw Error('파일 속성 또는 칸반 설정이 변경되었습니다.');
      const statuses = statusesRaw
        ? validateStatuses(JSON.parse(statusesRaw))
        : defaultStatuses();
      if (!statuses.statuses.some((s) => s.id === input.statusId))
        throw Error('상태가 삭제되었습니다.');
      d.workflowStatusId = input.statusId;
      const view = readKanbanView(kanbanViewRaw, statuses);
      view.orders[input.objectId] = Date.now();
      kanbanViewRaw = JSON.stringify(view);
      notify();
    },
    setFileStatusProperty: async (input) => {
      const d =
        documents.find(
          (d) =>
            d.id === input.objectId && d.relativePath === input.relativePath,
        ) ??
        previews.find(
          (p) =>
            p.sourceId === input.objectId &&
            p.relativePath === input.relativePath,
        );
      if (
        !d ||
        statusPropertyApplied(d) !== input.expectedEnabled ||
        d.workflowStatusId !== input.expectedStatus
      )
        throw Error('파일 속성이 변경되었습니다.');
      const statuses = statusesRaw
        ? validateStatuses(JSON.parse(statusesRaw))
        : defaultStatuses();
      const applied = input.enabled ?? statusPropertyApplied(d);
      if (applied) {
        const id =
          input.statusId ??
          (statuses.statuses.some((s) => s.id === d.workflowStatusId)
            ? d.workflowStatusId
            : statuses.defaultStatusId);
        if (!statuses.statuses.some((s) => s.id === id))
          throw Error('상태가 삭제되었습니다.');
        d.workflowStatusId = id;
      }
      d.statusPropertyEnabled = applied;
      notify();
    },
    setDocumentWorkflow: async (input) => {
      const d = documents.find((d) => d.relativePath === input.relativePath);
      if (
        !d ||
        d.id !== input.objectId ||
        d.workflowStatusId !== input.expectedStatus ||
        d.workflowOrder !== input.expectedOrder
      )
        throw Error('문서 상태가 변경되었습니다.');
      const value = statusesRaw
        ? validateStatuses(JSON.parse(statusesRaw))
        : defaultStatuses();
      if (!value.statuses.some((s) => s.id === input.statusId))
        throw Error('상태를 찾을 수 없습니다.');
      d.workflowStatusId = input.statusId;
      d.workflowOrder = Date.now();
      d.statusPropertyEnabled = true;
      statusesRaw ??= JSON.stringify(value, null, 2);
      notify();
    },
    getCanvasChanges: async () => null,
    getDocument: async (relative) =>
      structuredClone(
        (() => {
          const doc = documents.find((item) => item.relativePath === relative);
          return doc
            ? {
                ...doc,
                identitySource: doc.identitySource ?? ('frontmatter' as const),
              }
            : null;
        })(),
      ),
    getEditorDraft: async (key) => drafts.get(key) ?? null,
    setEditorDraft: async (key, draft) => {
      if (draft) drafts.set(key, draft);
      else drafts.delete(key);
    },
    onDraftFlushRequested: () => () => {},
    enqueueDocumentSave: async (request) => {
      await activateSaves();
      return saveQueue.enqueue(request);
    },
    getDocumentSaveStates: activateSaves,
    flushDocumentSaves: (scope, key) => saveQueue.flush(scope, key),
    discardDocumentSave: (scope, key, sequence) =>
      saveQueue.discard(scope, key, sequence),
    onDocumentSaveChanged: (listener) => {
      saveListeners.add(listener);
      return () => {
        saveListeners.delete(listener);
      };
    },
    getWebViewer: async () => ({
      configured: false,
      url: 'https://game-jam-web-viewer.vercel.app',
      accessCode: '',
      projects: [],
      liveLocal: false,
      errors: [],
    }),
    publishWebViewer: async () => {
      throw new Error('웹 게시는 데스크톱 앱에서 사용해주세요.');
    },
    openWebViewer: async () => {
      window.open(
        'https://game-jam-web-viewer.vercel.app',
        '_blank',
        'noopener',
      );
    },
    listProjects: async () =>
      displayHomeProjects(
        [
          {
            id: 'demo-local',
            name: demoProjectName,
            kind: 'local',
            root: 'demo-game',
            lastOpenedAt: now,
            createdAt: now - 86400000,
            modifiedAt: now,
          },
        ],
        home,
      ),
    listProjectFolders: async () => structuredClone(home.folders),
    prepareProjectTrash: async () => {
      throw Error('프로젝트 휴지통은 데스크톱 앱에서 사용해주세요.');
    },
    trashProject: async () => {
      throw Error('프로젝트 휴지통은 데스크톱 앱에서 사용해주세요.');
    },
    listProjectTrash: async () => [],
    restoreProjectTrash: async () => ({}),
    acknowledgeProjectRestore: async () => {},
    purgeProjectTrash: async () => {},
    retryProjectTrash: async () => {},
    getSharedProjectLifecycle: async () => {
      throw Error('협업 서버에 연결해주세요.');
    },
    trashSharedProject: async () => {
      throw Error('협업 서버에 연결해주세요.');
    },
    restoreSharedProject: async () => {
      throw Error('협업 서버에 연결해주세요.');
    },
    purgeSharedProject: async () => {
      throw Error('협업 서버에 연결해주세요.');
    },
    resumeRestoredProject: async () => structuredClone(collab),
    renameProject: async (id, inputName, expectedName) => {
      if (id !== 'demo-local') throw new Error('프로젝트를 찾을 수 없습니다.');
      const name = homeName(inputName);
      if (
        expectedName !== undefined &&
        expectedName !== demoProjectName &&
        name !== demoProjectName
      )
        throw new Error(
          '프로젝트 이름이 바뀌었습니다. 목록을 새로고침해주세요.',
        );
      localStorage.setItem('game-canvas-demo-project-name', name);
      demoProjectName = name;
      notify();
    },
    moveProject: (id, folderId) =>
      editHome({ type: 'move-project', id, folderId }),
    createProjectFolder: (name) =>
      editHome({ type: 'create-folder', id: crypto.randomUUID(), name }),
    renameProjectFolder: (id, name) =>
      editHome({ type: 'rename-folder', id, name }),
    removeProjectFolder: (id) => editHome({ type: 'remove-folder', id }),
    revealProject: async () => {
      throw new Error('저장 위치 보기는 데스크톱 앱에서 사용해주세요.');
    },
    openProject: async () => api.getWorkspace(),
    createProject: async () => {
      throw new Error('새 프로젝트 생성은 데스크톱 앱에서 사용해주세요.');
    },
    goHome: async () => {},
    updateProjectServer: async () => {},
    inspectConnectionInfo: async () => {
      throw new Error('연결 정보 적용은 데스크톱 앱에서 사용해주세요.');
    },
    applyConnectionInfo: async () => {
      throw new Error('연결 정보 적용은 데스크톱 앱에서 사용해주세요.');
    },
    resolveOfflineConflict: async () => {},
    setDocumentColor: async ({ relativePath, color }) => {
      const doc = documents.find((item) => item.relativePath === relativePath);
      if (doc) doc.backgroundColor = cardColor(color);
      const preview = previews.find(
        (item) => item.relativePath === relativePath,
      );
      if (preview) preview.backgroundColor = cardColor(color);
      notify();
    },
    getUpdateState: async () => ({
      status: 'unconfigured',
      currentVersion: '0.10.0',
      repository: null,
      available: false,
      automatic: true,
      message: 'GitHub 배포 저장소 연결 대기 중입니다.',
    }),
    checkForUpdates: async () => api.getUpdateState(),
    setAutomaticUpdates: async (automatic) => ({
      ...(await api.getUpdateState()),
      automatic,
    }),
    installUpdate: async () => api.getUpdateState(),
    onUpdateChanged: () => () => {},
    onUpdateRestartRequested: () => () => {},
    onUpdateRestartReleased: () => () => {},
    getUndoState: async () => journal.state,
    undo: async () => changeHistory('undo'),
    redo: async () => changeHistory('redo'),
    renameSection: async (relativePath, title) => {
      const section = sections.find(
        (item) => item.relativePath === relativePath,
      );
      if (!section || !title.trim())
        throw new Error('섹션 이름을 입력해주세요.');
      section.title = title.trim();
      notify();
    },
    deleteDocuments: async (items) => {
      const ids = new Set(items.map((item) => item.documentId)),
        paths = new Set(items.map((item) => item.relativePath));
      documents = documents.filter(
        (item) => !ids.has(item.id) && !paths.has(item.relativePath),
      );
      for (const section of sections)
        section.members = section.members.filter(
          (member) => !ids.has(member.id) && !paths.has(member.path),
        );
      previews = previews.filter((item) => !paths.has(item.relativePath));
      for (const relative of paths) previewWindows.delete(relative);
      notify();
    },
    getCollaboration: async () => structuredClone(collab),
    importFiles: async () => {
      throw new Error(
        '파일 불러오기는 데스크톱 앱에서 사용해주세요. 브라우저 화면은 UI 미리보기입니다.',
      );
    },
    // Internal selection copying is simulated in this UI preview; never read the OS clipboard.
    markCanvasClipboard: async (input) => {
      previewClipboardId = input.copyId;
    },
    pasteCanvasClipboard: async (input) => {
      if (previewClipboardId && input.internalCopyId === previewClipboardId)
        return { kind: 'internal', copyId: previewClipboardId };
      throw new Error(
        '클립보드 이미지 붙여넣기는 데스크톱 앱에서 사용해주세요.',
      );
    },
    readAsset: async () => {
      throw new Error('이미지는 데스크톱 프로젝트에서 불러올 수 있습니다.');
    },
    getTestUsers: async () => ({
      supported: false,
      isTestUser: false,
      maxWindows: 10,
      windows: [],
    }),
    launchTestUsers: async () => {
      throw new Error(
        '테스트 사용자 창은 데스크톱 앱에서 실행해주세요. 브라우저 미리보기는 실제 서버에 연결되지 않습니다.',
      );
    },
    startLocalCollaborationServer: async () => ({
      serverUrl: 'http://127.0.0.1:4317',
    }),
    createCollaboration: async ({ serverUrl, nickname }) => {
      collab = {
        active: true,
        connected: true,
        taskInstructionsEditable: true,
        taskResultNaming: true,
        gamejamWorkflow: true,
        documentBundles: true,
        documentOutputFormats: true,
        htmlImportAnalysis: true,
        htmlComposition: true,
        canvasSheets: true,
        htmlResultFolders: true,
        editorAi: true,
        multiProviderAi: true,
        serverUrl,
        projectId: 'demo-project',
        projectName: 'demo-game',
        memberId: 'demo-admin',
        role: 'admin',
        members: [
          {
            id: 'demo-admin',
            nickname,
            owner: true,
            role: 'admin',
            online: true,
          },
        ],
        locks: [],
        inviteCode: 'DEMO1234567890123456',
        inviteExpiresAt: Date.now() + 86_400_000,
        recoveryKey: '개발 화면용 예시 복구 키',
        revision: 1,
      };
      return emitCollab();
    },
    joinCollaboration: async ({ serverUrl, nickname }) => {
      collab = {
        active: true,
        connected: true,
        taskInstructionsEditable: true,
        taskResultNaming: true,
        gamejamWorkflow: true,
        documentBundles: true,
        documentOutputFormats: true,
        htmlImportAnalysis: true,
        htmlComposition: true,
        canvasSheets: true,
        htmlResultFolders: true,
        editorAi: true,
        multiProviderAi: true,
        serverUrl,
        projectId: 'demo-project',
        projectName: 'demo-game',
        memberId: 'demo-editor',
        role: 'editor',
        members: [
          {
            id: 'demo-admin',
            nickname: '관리자',
            owner: true,
            role: 'admin',
            online: true,
          },
          {
            id: 'demo-editor',
            nickname,
            owner: false,
            role: 'editor',
            online: true,
          },
        ],
        locks: [],
      };
      return emitCollab();
    },
    leaveCollaboration: async () => {
      collab = { active: false, connected: false, members: [], locks: [] };
      emitCollab();
    },
    recoverCollaboration: async () => {
      throw new Error(
        '개발 화면에서는 실제 관리자 복구를 지원하지 않습니다. Electron 앱에서 사용하세요.',
      );
    },
    rotateInvite: async () => {
      collab.inviteCode = 'DEMO0987654321098765';
      return emitCollab();
    },
    setMemberRole: async (memberId, role) => {
      collab.members =
        role === 'removed'
          ? collab.members.filter((member) => member.id !== memberId)
          : collab.members.map((member) =>
              member.id === memberId ? { ...member, role } : member,
            );
      emitCollab();
    },
    acquireDocumentLock: async () => undefined,
    releaseDocumentLock: async () => undefined,
    updateLayouts: async (updates) => {
      for (const entry of updates)
        if (entry.kind === 'section') await api.updateSectionLayout(entry);
        else await api.updateDocumentLayout(entry);
    },
    onCollaborationChanged: (listener) => {
      collabListeners.add(listener);
      return () => {
        collabListeners.delete(listener);
      };
    },
    getActiveRun: async () => (activeDevRun ? lastDevEvent : null),
    getPreviewWindow: async (relative = DEFAULT_PREVIEW_PATH) =>
      structuredClone(previewWindows.get(assertPreviewPath(relative)) ?? null),
    savePreviewWindow: async (state, relative = DEFAULT_PREVIEW_PATH) => {
      previewWindows.set(
        assertPreviewPath(relative),
        normalizePreviewWindow(structuredClone(state)),
      );
    },
    listPreviews: async () =>
      structuredClone(
        previews
          .filter((item) => item.exists)
          .map((item) => ({
            ...item,
            sourceId: item.sourceId ?? item.relativePath,
          }))
          .sort(
            (left, right) =>
              previewVersion(left.relativePath) -
              previewVersion(right.relativePath),
          ),
      ),
    moveResult: async (input) =>
      moveDevResults([
        {
          from: input.relativePath,
          to: moveDestination(
            Object.fromEntries(
              previews.map((item) => [item.relativePath, item.content ?? '']),
            ),
            input,
          ),
        },
      ]),
    organizeResults: async () =>
      moveDevResults(
        legacyResultMoves(
          Object.fromEntries(
            previews.map((item) => [item.relativePath, item.content ?? '']),
          ),
        ),
      ),
    listHistory: async () => structuredClone(histories),
    getFileAuthorship: async (relative) =>
      structuredClone(devAuthorship[relative] ?? {}),
    readHistoryFile: async (id, relative, version) => {
      const state = historyStates.get(id)?.[version];
      if (!state) throw new Error('기록을 찾을 수 없습니다.');
      return devFiles(state)[relative] ?? null;
    },
    restoreHistory: async (id, relative, version) => {
      const entry = histories.find((item) => item.id === id);
      const states = historyStates.get(id);
      if (!entry || !states) throw new Error('기록을 찾을 수 없습니다.');
      const before = devSnapshot();
      const selected =
        version === 'before' ||
        (!version && entry.files.some((file) => !file.after))
          ? states.before
          : states.after;
      if (!relative || relative === CANVAS_SHEETS_PATH)
        sheetsRaw = selected.sheetsRaw;
      for (const file of entry.files.filter(
        (item) => !relative || item.relativePath === relative,
      )) {
        documents = documents.filter(
          (item) => item.relativePath !== file.relativePath,
        );
        const document = selected.documents.find(
          (item) => item.relativePath === file.relativePath,
        );
        if (document) documents.push(structuredClone(document));
        sections = sections.filter(
          (item) => item.relativePath !== file.relativePath,
        );
        const section = selected.sections.find(
          (item) => item.relativePath === file.relativePath,
        );
        if (section) sections.push(structuredClone(section));
        if (isPreviewPath(file.relativePath)) {
          previews = previews.filter(
            (item) => item.relativePath !== file.relativePath,
          );
          const result = selected.previews.find(
            (item) => item.relativePath === file.relativePath,
          );
          if (result) previews.push(structuredClone(result));
        }
      }
      recordDevHistory(before, devSnapshot(), '버전 복원', 'restore');
      notify();
    },
    getWorkspace: async () => ({
      saveScope,
      clipboardContextId: 'dev-preview',
      root: '/demo/game-canvas',
      name: demoProjectName,
    }),
    selectWorkspace: async () => ({
      root: '/demo/game-canvas',
      name: demoProjectName,
    }),
    getCanvasSheets: async () => ({
      ...readCanvasSheets(sheetsRaw ?? undefined),
      raw: sheetsRaw,
    }),
    changeCanvasSheets: async (input) => {
      if (input.expected !== sheetsRaw)
        throw new Error('캔버스 목록이 변경되었습니다.');
      const registry = readCanvasSheets(sheetsRaw ?? undefined);
      const sheet = registry.canvases.find((item) => item.id === input.id);
      if (input.action === 'add')
        registry.canvases.push({
          id: input.id,
          name: input.name?.trim() || '새 캔버스',
        });
      else if (input.action === 'rename' && sheet)
        sheet.name = input.name?.trim() || sheet.name;
      else if (input.action === 'reorder' && input.order)
        registry.canvases = input.order.map(
          (id) => registry.canvases.find((item) => item.id === id)!,
        );
      else if (
        (input.action === 'move' || input.action === 'delete') &&
        sheet
      ) {
        if (
          !registry.canvases.some((item) => item.id === input.targetId) ||
          input.targetId === input.id
        )
          throw new Error('대상 캔버스를 확인해주세요.');
        const paths = new Set(input.paths ?? []);
        const selected = (item: { relativePath: string; canvasId?: string }) =>
          canvasId(item.canvasId) === input.id &&
          (input.action === 'delete' || paths.has(item.relativePath));
        for (const section of sections.filter(selected))
          for (const member of section.members) paths.add(member.path);
        if (input.action === 'move') {
          const rectOf = (
            item: CanvasDocument | CanvasSection | PreviewResult,
          ) =>
            'x' in item
              ? { x: item.x, y: item.y, width: item.width, height: item.height }
              : (previewWindows.get(item.relativePath) ??
                item.initialWindow ?? {
                  x: 120,
                  y: 120,
                  width: 720,
                  height: 520,
                });
          const items = [...documents, ...sections, ...previews].filter(
            selected,
          );
          if (items.length) {
            const bounds = enclosingRect(items.map(rectOf)),
              occupied = [...documents, ...previews]
                .filter(
                  (d) =>
                    canvasId(d.canvasId) === input.targetId &&
                    (!('type' in d) || d.type !== 'ai-task'),
                )
                .map(rectOf);
            const p = nearDocumentPosition(bounds, occupied),
              dx = p.x - bounds.x,
              dy = p.y - bounds.y;
            for (const item of items) {
              const r = rectOf(item);
              if ('x' in item) {
                item.x = r.x + dx;
                item.y = r.y + dy;
              } else {
                item.placementId = crypto.randomUUID();
                item.initialWindow = {
                  ...r,
                  x: r.x + dx,
                  y: r.y + dy,
                  collapsed: false,
                };
              }
            }
          }
        }
        for (const item of [...documents, ...sections, ...previews])
          if (selected(item)) item.canvasId = input.targetId;
        for (const section of sections)
          section.members = section.members.filter(
            (member) =>
              canvasId(
                documents.find((doc) => doc.relativePath === member.path)
                  ?.canvasId,
              ) === canvasId(section.canvasId),
          );
        if (input.action === 'delete') {
          const from = drawingPath(input.id),
            to = drawingPath(input.targetId!);
          const objects = readDrawingFile(drawingFiles[from], input.id).objects;
          if (objects.length)
            drawingFiles[to] = serializeDrawing({
              version: 1,
              canvasId: input.targetId!,
              objects: [
                ...readDrawingFile(drawingFiles[to], input.targetId!).objects,
                ...objects.map((o) => ({
                  ...o,
                  generation: crypto.randomUUID(),
                })),
              ],
            });
          delete drawingFiles[from];
          registry.canvases = registry.canvases.filter(
            (item) => item.id !== input.id,
          );
        }
      } else throw new Error('캔버스를 찾을 수 없습니다.');
      sheetsRaw =
        JSON.stringify(readCanvasSheets(JSON.stringify(registry)), null, 2) +
        '\n';
      notify();
    },
    // Dev documents are generated with explicit IDs, just like imported files.
    listDocuments: async () =>
      structuredClone(
        documents.map((d) => ({
          ...d,
          identitySource: d.identitySource ?? ('frontmatter' as const),
        })),
      ),
    applyCanvasCommands: async ({ commands }) => {
      const before = devSnapshot();
      devBatchActive = true;
      try {
        const results: unknown[] = [];
        for (const command of commands) {
          const input = command.input as never;
          if (command.channel === 'drawings:apply') {
            drawingFiles = applyDrawing(drawingFiles, input);
            results.push(undefined);
          } else if (command.channel === 'documents:duplicate')
            results.push(await api.duplicateDocuments(input));
          else if (command.channel === 'layouts:update') {
            await api.updateLayouts(
              (
                command.input as {
                  updates: Parameters<GameCanvasApi['updateLayouts']>[0];
                }
              ).updates,
            );
            results.push(undefined);
          } else if (command.channel === 'documents:delete-many') {
            await api.deleteDocuments(
              (
                command.input as {
                  documents: Parameters<GameCanvasApi['deleteDocuments']>[0];
                }
              ).documents,
            );
            results.push(undefined);
          } else if (command.channel === 'sections:delete')
            results.push(await api.deleteSection(input));
          else if (command.channel === 'canvases:change')
            results.push(await api.changeCanvasSheets(input));
          else throw new Error('허용되지 않은 묶음 작업입니다.');
        }
        return results;
      } catch (error) {
        documents = before.documents;
        sections = before.sections;
        previews = before.previews;
        sheetsRaw = before.sheetsRaw;
        drawingFiles = before.drawingFiles;
        throw error;
      } finally {
        devBatchActive = false;
      }
    },
    listGameUi: async () => snapshotGameUi(gameUiFiles),
    exportGameUiPng: async () => true,
    applyGameUiCommand: async (input) => {
      if (collab.active && collab.role === 'viewer')
        throw new Error('보기 권한입니다.');
      const before = devSnapshot();
      let files: Record<string, string> = {
        ...gameUiFiles,
        ...(sheetsRaw ? { [CANVAS_SHEETS_PATH]: sheetsRaw } : {}),
      };
      for (const d of documents)
        if (files[d.relativePath] && d.relativePath.startsWith('docs/ui/')) {
          const meta = matter(files[d.relativePath]).data;
          files[d.relativePath] = matter.stringify(d.body, {
            ...meta,
            title: d.title,
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
          });
        }
      files = applyGameUi(files, input);
      gameUiFiles = Object.fromEntries(
        Object.entries(files).filter(
          ([p]) => isGameUiPath(p) || p.startsWith('docs/ui/'),
        ),
      );
      for (const [p, raw] of Object.entries(gameUiFiles))
        if (p.endsWith('.md')) {
          const m = matter(raw),
            data = m.data;
          const doc: CanvasDocument = {
            id: data.id,
            title: data.title,
            type: 'reference',
            status: 'draft',
            relativePath: p,
            canvasId: data.canvas_id,
            body: m.content,
            x: data.x,
            y: data.y,
            width: data.width,
            height: data.height,
            collapsed: false,
            sources: [],
            modifiedAt: Date.now(),
          };
          documents = [...documents.filter((d) => d.relativePath !== p), doc];
        }
      recordDevHistory(before, devSnapshot(), '게임 UI 편집', 'user');
      const entry = histories[0];
      if (entry) journal.push({ id: entry.id, label: entry.label });
      notify();
      return snapshotGameUi(gameUiFiles);
    },
    listDrawings: async () => snapshotDrawings(drawingFiles),
    getDrawingChanges: async (known) => {
      const objects = snapshotDrawings(drawingFiles),
        signatures = Object.fromEntries(
          objects.map((o) => [o.id, JSON.stringify(o)]),
        );
      return {
        changed: objects.filter((o) => signatures[o.id] !== known[o.id]),
        removed: Object.keys(known).filter((id) => !signatures[id]),
        signatures,
      };
    },
    applyDrawingCommand: async (input) => {
      if (collab.active && collab.role === 'viewer')
        throw new Error('보기 권한입니다.');
      const before = devSnapshot();
      drawingFiles = applyDrawing(drawingFiles, input);
      recordDevHistory(before, devSnapshot(), '도형 · 그림 편집', 'user');
      const entry = histories[0];
      if (entry) journal.push({ id: entry.id, label: entry.label });
      notify();
      return snapshotDrawings(drawingFiles);
    },
    listSections: async () => structuredClone(sections),
    createIdea: async ({ x, y, width, height, canvasId: selectedCanvas }) => {
      const id = `idea-${documents.length + 1}`;
      const explicit = width !== undefined && height !== undefined;
      const [automatic] = explicit
        ? []
        : verticalLayouts(
            [{ width: 340, height: 300 }],
            documents.filter(
              (item) => canvasId(item.canvasId) === canvasId(selectedCanvas),
            ),
            { x, y },
          );
      const layout = explicit ? { x, y, width, height } : automatic;
      const document: CanvasDocument = {
        statusPropertyEnabled: false,
        canvasId: canvasId(selectedCanvas),
        id,
        title: '새 아이디어',
        type: 'idea',
        status: 'raw',
        relativePath: `ideas/${id}.md`,
        body: '여기에 아이디어를 적어보세요.',
        ...layout,
        collapsed: false,
        sources: [],
        modifiedAt: Date.now(),
      };
      documents = [...documents, document];
      notify();
      return structuredClone(document);
    },
    createSection: async ({
      title,
      x,
      y,
      width,
      height,
      members,
      canvasId: selectedCanvas,
    }) => {
      const memberKeys = new Set(
        members.flatMap((member) => [member.id, member.path]),
      );
      sections = sections.map((section) => ({
        ...section,
        members: section.members.filter(
          (member) =>
            !memberKeys.has(member.id) && !memberKeys.has(member.path),
        ),
      }));
      const id = `section-${Date.now()}`;
      const section: CanvasSection = {
        canvasId: canvasId(selectedCanvas),
        id,
        title,
        relativePath: `sections/${id}.md`,
        x,
        y,
        width,
        height,
        members,
        modifiedAt: Date.now(),
      };
      sections = [...sections, section];
      notify();
      return structuredClone(section);
    },
    saveDocument: async ({ relativePath, title, body }) => {
      documents = documents.map((document) =>
        document.relativePath === relativePath
          ? { ...document, title, body, modifiedAt: Date.now() }
          : document,
      );
      notify();
      const document = documents.find(
        (document) => document.relativePath === relativePath,
      );
      if (!document) throw new Error('문서를 찾을 수 없습니다.');
      return structuredClone(document);
    },
    setDocumentCollapsed: async ({ relativePath, collapsed }) => {
      documents = documents.map((document) =>
        document.relativePath === relativePath
          ? { ...document, collapsed, modifiedAt: Date.now() }
          : document,
      );
      notify();
    },
    deleteDocument: async ({ documentId, relativePath }) => {
      if (isPreviewPath(relativePath)) {
        previews = previews.filter(
          (item) => item.relativePath !== relativePath,
        );
        previewWindows.delete(relativePath);
      }
      documents = documents.filter(
        (document) =>
          document.id !== documentId && document.relativePath !== relativePath,
      );
      sections = sections.map((section) => ({
        ...section,
        members: section.members.filter(
          (member) => member.id !== documentId && member.path !== relativePath,
        ),
        modifiedAt: Date.now(),
      }));
      notify();
    },
    deleteSection: async ({ sectionId, relativePath, deleteMembers }) => {
      const section = sections.find(
        (candidate) =>
          candidate.id === sectionId || candidate.relativePath === relativePath,
      );
      if (!section) throw new Error('삭제할 섹션을 확인할 수 없습니다.');
      let deletedDocumentCount = 0;
      let preservedDocumentCount = section.members.length;
      if (deleteMembers) {
        const memberKeys = new Set(
          section.members.flatMap((member) => [member.id, member.path]),
        );
        const deletable = documents.filter(
          (document) =>
            memberKeys.has(document.id) ||
            memberKeys.has(document.relativePath),
        );
        const deletedKeys = new Set(
          deletable.flatMap((document) => [document.id, document.relativePath]),
        );
        documents = documents.filter(
          (document) => !deletedKeys.has(document.id),
        );
        sections = sections.map((candidate) => ({
          ...candidate,
          members: candidate.members.filter(
            (member) =>
              !deletedKeys.has(member.id) && !deletedKeys.has(member.path),
          ),
        }));
        deletedDocumentCount = deletable.length;
        preservedDocumentCount = 0;
      }
      sections = sections.filter((candidate) => candidate.id !== section.id);
      notify();
      return { deletedDocumentCount, preservedDocumentCount };
    },
    duplicateDocuments: async ({
      documents: members,
      offsetX,
      offsetY,
      canvasId: selectedCanvas,
    }) => {
      const copies = members.flatMap((member) => {
        const source = documents.find(
          (document) =>
            document.id === member.id || document.relativePath === member.path,
        );
        if (!source) return [];
        const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
        const sourceDirectory =
          source.relativePath === 'project.md'
            ? 'docs'
            : source.relativePath.slice(
                0,
                source.relativePath.lastIndexOf('/'),
              );
        const sourceName = source.relativePath
          .slice(source.relativePath.lastIndexOf('/') + 1)
          .replace(/\.md$/i, '');
        return [
          {
            ...source,
            canvasId: selectedCanvas ?? source.canvasId,
            id: `${source.id}-copy-${suffix}`,
            title: `${source.title} 복사본`,
            relativePath: `${sourceDirectory}/${sourceName}-copy-${suffix}.md`,
            x: source.x + offsetX,
            y: source.y + offsetY,
            modifiedAt: Date.now(),
          },
        ];
      });
      documents = [...documents, ...copies];
      notify();
      return structuredClone(copies);
    },
    updateDocumentLayout: async ({ relativePath, x, y, width, height }) => {
      documents = documents.map((document) =>
        document.relativePath === relativePath
          ? { ...document, x, y, width, height }
          : document,
      );
    },
    updateSectionLayout: async ({
      relativePath,
      x,
      y,
      width,
      height,
      moveMembers = true,
    }) => {
      const current = sections.find(
        (section) => section.relativePath === relativePath,
      );
      if (!current) return;
      const deltaX = x - current.x;
      const deltaY = y - current.y;
      const memberPaths = new Set(current.members.map((member) => member.path));
      documents = documents.map((document) =>
        moveMembers && memberPaths.has(document.relativePath)
          ? {
              ...document,
              x: document.x + deltaX,
              y: document.y + deltaY,
            }
          : document,
      );
      sections = sections.map((section) =>
        section.relativePath === relativePath
          ? { ...section, x, y, width, height, modifiedAt: Date.now() }
          : section,
      );
      notify();
    },
    moveDocumentToSection: async ({
      documentId,
      documentPath,
      targetSectionId,
      x,
      y,
      width,
      height,
    }) => {
      const target = targetSectionId
        ? sections.find((section) => section.id === targetSectionId)
        : null;
      if (targetSectionId && !target)
        throw new Error('대상 섹션을 찾을 수 없습니다.');

      sections = sections.map((section) => {
        const remaining = section.members.filter(
          (member) => member.id !== documentId && member.path !== documentPath,
        );
        return {
          ...section,
          members:
            section.id === target?.id
              ? [...remaining, { id: documentId, path: documentPath }]
              : remaining,
          modifiedAt: Date.now(),
        };
      });
      documents = documents.map((document) =>
        document.id === documentId || document.relativePath === documentPath
          ? { ...document, x, y, width, height, modifiedAt: Date.now() }
          : document,
      );
      notify();
    },
    createTask: async ({
      canvasId: selectedCanvas,
      kind,
      sourceMode,
      inputPaths,
      x,
      y,
      htmlResult,
      documentResult,
      instructions,
      resultName,
      thenImplement,
      requestSnapshot,
    }) => {
      const id = `${thenImplement ? 'gamejam' : kind}-task-${Date.now()}`;
      const commandText = taskInstructions(kind, instructions);
      const htmlChoice = thenImplement?.htmlResult ?? htmlResult;
      const output =
        kind === 'implement' || thenImplement
          ? resolvePreviewOutput(
              previews.map((result) => result.relativePath),
              [
                ...previews.map((result) => result.relativePath),
                ...[...taskOutputs.values()].map((item) => item.output),
              ],
              htmlChoice,
              thenImplement?.resultName ?? resultName,
            ).path
          : undefined;
      const document: CanvasDocument = {
        canvasId: canvasId(selectedCanvas),
        id,
        title: thenImplement
          ? 'gamejam! · 문서 정리 → HTML 구현'
          : kind === 'organize'
            ? sourceMode
              ? 'HTML 게임 문서 추출 요청'
              : 'AI 문서 정리 요청'
            : 'HTML 구현 요청',
        type: 'ai-task',
        status: 'ready',
        relativePath: `.ai/tasks/${id}.md`,
        body: `## 입력 문서\n\n${inputPaths.map((path) => `- \`${path}\``).join('\n')}\n\n## 사용자 작업 지시\n\n${commandText}${thenImplement ? `\n\n## HTML 구현 지시\n\n${taskInstructions('implement', thenImplement.instructions)}` : ''}`,
        x,
        y,
        width: 380,
        height: 320,
        collapsed: false,
        sources: [],
        modifiedAt: Date.now(),
      };
      taskRequests.set(
        document.relativePath,
        gamejamSnapshotFromInput({
          canvasId: selectedCanvas,
          kind,
          sourceMode,
          inputPaths,
          x,
          y,
          htmlResult,
          documentResult,
          instructions,
          resultName,
          thenImplement,
          requestSnapshot,
        }),
      );
      if (kind === 'organize') {
        const outputs = resolveDocumentOutputs(
          [
            ...documents.map((doc) => doc.relativePath),
            ...[...taskDocumentOutputs.values()].flatMap(
              (value) => value.outputs,
            ),
          ],
          documentResult,
          resultName,
        );
        if (outputs.some((path) => inputPaths.includes(path)))
          throw new Error(
            '[GC-AI-004] 입력 문서를 동시에 덮어쓸 수 없습니다. 새 버전을 선택하세요.',
          );
        document.body += `\n\n## 출력\n\n${outputs.map((path) => `- \`${path}\``).join('\n')}`;
        taskDocumentOutputs.set(document.relativePath, {
          outputs,
          inputs: inputPaths,
          templates:
            documentResult?.structure === 'custom'
              ? documentResult.documents
              : undefined,
          x,
          y,
          systems:
            (outputs.length === 1 && documentResult?.structure === 'systems') ||
            outputs.some((path) => /-?system-[a-z0-9-]+\.md$/.test(path)),
          bundleId:
            documents.find((doc) => doc.relativePath === outputs[0])
              ?.documentBundleId ?? `bundle-${id}`,
        });
      }
      documents = [...documents, document];
      taskInputs.set(document.relativePath, inputPaths);
      if (output)
        document.body +=
          kind === 'organize'
            ? `\n- \`${output}\``
            : `\n\n## 출력\n\n- \`${output}\``;
      if (output)
        taskOutputs.set(document.relativePath, {
          output,
          base: htmlChoice?.basePath,
        });
      notify();
      return structuredClone(document);
    },
    getCodexStatus: async () => ({
      available: true,
      authenticated: true,
      version: 'codex-cli dev-mock',
      executablePath: 'C:/demo/codex.exe',
      message: 'Codex CLI가 연결되어 있습니다.',
    }),
    getAiStatus: async (providerId) => ({
      providerId,
      available: true,
      authenticated: true,
      version: 'dev-mock (실제 AI 호출 없음)',
      executablePath: 'C:/demo/ai.exe',
      message:
        '개발 화면의 모의 연결입니다. 실제 계정이나 AI를 호출하지 않습니다.',
    }),
    startCodexRun: async ({ taskPath, providerId, modelId }) => {
      if (collab.active && (!collab.connected || collab.role === 'viewer'))
        throw new Error('관리자·편집자만 AI를 실행할 수 있습니다.');
      if (activeDevRun) throw new Error('이미 실행 중인 AI 작업이 있습니다.');
      if (!['codex-cli', 'claude-cli', 'gemini-cli'].includes(providerId))
        throw new Error('지원하지 않는 AI 제공자입니다.');
      const runId = `dev-run-${Date.now()}`;
      const before = devSnapshot();
      const target = taskOutputs.get(taskPath);
      const docTarget = taskDocumentOutputs.get(taskPath);
      const fileLock = {
        paths: [
          ...new Set([
            taskPath,
            ...(docTarget?.inputs ?? taskInputs.get(taskPath) ?? []),
            ...(docTarget?.outputs ?? []),
            ...(target
              ? [target.output, ...(target.base ? [target.base] : [])]
              : []),
          ]),
        ],
        folders: [] as string[],
      };
      for (const relative of fileLock.paths) {
        const image = documents.find(
          (doc) => doc.relativePath === relative,
        )?.asset;
        if (image) fileLock.paths.push(image.path);
      }
      activeDevRun = { runId, taskPath, modelId, providerId, fileLock };
      const send = (
        status: CodexRunEvent['status'],
        kind: CodexRunEvent['kind'],
        message: string,
      ) =>
        emitRun({
          runId,
          taskPath,
          status,
          kind,
          message,
          timestamp: Date.now(),
          providerId,
          modelId,
          actorId: collab.memberId,
          fileLock,
        });
      send(
        'starting',
        'status',
        `모의 AI를 시작하고 있습니다. · ${modelId ?? '기본 모델'}`,
      );
      const progressMessages = [
        `작업 파일 읽기: ${taskPath}`,
        '선택된 Markdown 문서를 분석하고 있습니다.',
        '아이디어 간 중복 내용을 찾고 있습니다.',
        '게임 규칙과 미결정 사항을 분리하고 있습니다.',
        '출력 Markdown 구조를 구성하고 있습니다.',
        '참고한 원본 메모를 연결하고 있습니다.',
        '결과 파일의 형식을 검증하고 있습니다.',
        '마지막 결과를 정리하고 있습니다.',
      ];
      progressMessages.forEach((message, index) => {
        setTimeout(
          () => {
            if (activeDevRun?.runId !== runId) return;
            send('running', 'log', message);
          },
          250 + index * 300,
        );
      });
      setTimeout(() => {
        if (activeDevRun?.runId !== runId) return;
        documents = documents.map((document) =>
          document.relativePath === taskPath
            ? { ...document, status: 'completed', modifiedAt: Date.now() }
            : document,
        );
        const target = taskOutputs.get(taskPath);
        const docTarget = taskDocumentOutputs.get(taskPath);
        if (docTarget) {
          const systems = docTarget.systems;
          if (systems && docTarget.outputs.length === 1) {
            const prefix =
              docTarget.outputs[0].slice(0, -'game-overview.md'.length) +
              'system-';
            docTarget.outputs.push(
              ...['play', 'progression', 'rewards'].map(
                (key) => `${prefix}${key}.md`,
              ),
            );
          }
          const sources = [
            ...documents
              .filter((doc) => docTarget.inputs.includes(doc.relativePath))
              .map((doc) => ({ id: doc.id })),
            ...previews
              .filter((preview) =>
                docTarget.inputs.includes(preview.relativePath),
              )
              .map((preview) => ({
                id: preview.sourceId ?? preview.relativePath,
              })),
          ];
          docTarget.outputs.forEach((relativePath, index) => {
            const previous = documents.find(
              (doc) => doc.relativePath === relativePath,
            );
            documents = [
              ...documents.filter((doc) => doc.relativePath !== relativePath),
              {
                ...previous,
                canvasId:
                  previous?.canvasId ??
                  documents.find((doc) => doc.relativePath === taskPath)
                    ?.canvasId,
                id: previous?.id ?? `${runId}-doc-${index}`,
                relativePath,
                ...(docTarget.templates
                  ? {
                      documentBundleId: docTarget.bundleId,
                      outputKey: docTarget.templates[index].key,
                      outputInstructions:
                        docTarget.templates[index].instructions,
                      ...(docTarget.templates[index].type === 'system'
                        ? {
                            systemId: `${docTarget.bundleId}:${docTarget.templates[index].key}`,
                          }
                        : {}),
                    }
                  : {}),
                title: docTarget.templates
                  ? docTarget.templates[index].title
                  : systems
                    ? index === 0
                      ? '게임 개요'
                      : (['플레이 시스템', '성장 시스템', '보상 시스템'][
                          index - 1
                        ] ??
                        previous?.title ??
                        '시스템 문서')
                    : ['게임 개요', '핵심 게임 루프', '미결정 사항'][index],
                type: docTarget.templates
                  ? docTarget.templates[index].type
                  : index === 0
                    ? 'overview'
                    : systems
                      ? 'system'
                      : index === 2
                        ? 'question'
                        : 'system',
                ...(systems
                  ? {
                      documentBundleId: docTarget.bundleId,
                      ...(index
                        ? {
                            systemId: `${docTarget.bundleId}:${relativePath.split('system-').at(-1)!.replace(/\.md$/, '')}`,
                          }
                        : {}),
                    }
                  : {}),
                status: 'draft',
                body: `## 정리 결과\n\n선택한 원본 메모 ${sources.length}개를 정리했습니다.`,
                sources,
                x: previous?.x ?? docTarget.x,
                y:
                  previous?.y ??
                  docTarget.y + 400 + (340 + NEW_FILE_GAP) * index,
                width: previous?.width ?? 380,
                height: previous?.height ?? 340,
                collapsed: false,
                modifiedAt: Date.now(),
              },
            ];
          });
        }
        if (target) {
          const base =
            previews.find(
              (item) => item.relativePath === (target.base ?? target.output),
            ) ?? initialPreview;
          previews = [
            ...previews.filter((item) => item.relativePath !== target.output),
            {
              canvasId:
                previews.find((item) => item.relativePath === target.output)
                  ?.canvasId ??
                documents.find((doc) => doc.relativePath === taskPath)
                  ?.canvasId,
              exists: true,
              relativePath: target.output,
              content: base.content + `<!-- dev result ${Date.now()} -->`,
            },
          ];
        }
        recordDevHistory(
          before,
          devSnapshot(),
          'AI 결과 생성',
          'ai',
          'completed',
          taskPath,
          modelId,
          providerId,
        );
        send('completed', 'result', '개발 모드 Codex 작업이 완료되었습니다.');
        activeDevRun = null;
        notify();
      }, 2_900);
      return { runId, taskPath, status: 'starting', providerId, modelId };
    },
    cancelCodexRun: async (runId) => {
      if (!activeDevRun || activeDevRun.runId !== runId) return;
      const { taskPath, modelId, providerId } = activeDevRun;
      activeDevRun = null;
      recordDevHistory(
        devSnapshot(),
        devSnapshot(),
        'AI 작업 중지',
        'ai',
        'cancelled',
        taskPath,
        modelId,
        providerId,
      );
      emitRun({
        runId,
        taskPath,
        status: 'cancelled',
        kind: 'status',
        message: '모의 AI 작업을 취소했습니다.',
        providerId,
        modelId,
        actorId: collab.memberId,
        timestamp: Date.now(),
      });
    },
    readPreview: async (relative = DEFAULT_PREVIEW_PATH) =>
      structuredClone(
        previews.find(
          (item) => item.relativePath === assertPreviewPath(relative),
        ) ?? { exists: false, relativePath: relative, content: '' },
      ),
    revealPath: async () => undefined,
    openWorkspace: async () => undefined,
    copyText: async (text) => navigator.clipboard.writeText(text),
    onWorkspaceChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onCodexRunEvent: (listener) => {
      runListeners.add(listener);
      return () => runListeners.delete(listener);
    },
  };
  const mutating = new Set([
    'applyCanvasCommands',
    'changeCanvasSheets',
    'moveResult',
    'organizeResults',
    'createIdea',
    'createSection',
    'saveDocument',
    'setDocumentColor',
    'setDocumentCollapsed',
    'deleteDocument',
    'deleteSection',
    'duplicateDocuments',
    'updateDocumentLayout',
    'updateSectionLayout',
    'moveDocumentToSection',
    'createTask',
    'restoreHistory',
    'selectWorkspace',
    'renameSection',
    'updateLayouts',
    'deleteDocuments',
  ]);
  const noHistory = new Set(['restoreHistory', 'selectWorkspace']);
  publicApi = new Proxy(api, {
    get(target, property: keyof GameCanvasApi) {
      const method = target[property];
      if (typeof method !== 'function') return method;
      if (!mutating.has(property)) return method;
      return async (...args: unknown[]) => {
        if (
          collab.active &&
          (!collab.connected || collab.role === 'viewer') &&
          property !== 'setDocumentCollapsed'
        )
          throw new Error('현재 문서 편집을 사용할 수 없습니다.');
        if (
          collab.active &&
          collab.role !== 'admin' &&
          property === 'restoreHistory'
        )
          throw new Error('관리자만 사용할 수 있습니다.');
        if (
          activeDevRun &&
          ['createTask', 'selectWorkspace'].includes(property)
        )
          throw new Error(
            '현재 AI가 문서 정리 또는 HTML 구현을 진행하고 있습니다. 문서 추가·수정·삭제와 배치 변경을 잠시 사용할 수 없습니다.',
          );
        const before = devSnapshot();
        const result = await Reflect.apply(method, target, args);
        if (activeDevRun) {
          const left = devFiles(before),
            right = devFiles(devSnapshot());
          try {
            assertAiFilesUnlocked(
              activeDevRun.fileLock,
              Object.keys({ ...left, ...right }).filter(
                (path) => left[path] !== right[path],
              ),
            );
          } catch (error) {
            documents = before.documents;
            sections = before.sections;
            previews = before.previews;
            sheetsRaw = before.sheetsRaw;
            drawingFiles = before.drawingFiles;
            notify();
            throw error;
          }
        }
        if (!noHistory.has(property)) {
          recordDevHistory(
            before,
            devSnapshot(),
            property === 'saveDocument'
              ? '문서 저장'
              : property === 'deleteDocument'
                ? '문서 삭제'
                : '문서 변경',
            'user',
          );
          if (
            histories[0]?.files.length &&
            property !== 'createTask' &&
            !(
              property === 'setDocumentCollapsed' &&
              (args[0] as { relativePath: string }).relativePath.startsWith(
                '.ai/tasks/',
              )
            )
          )
            journal.push({ id: histories[0].id, label: histories[0].label });
          notify();
        }
        return result;
      };
    },
  });
  return publicApi;
}
