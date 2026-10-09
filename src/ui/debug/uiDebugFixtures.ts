import type {
  CanvasDocument,
  CanvasSection,
  CollaborationState,
  CodexRunEvent,
  GameCanvasApi,
  HistoryEntry,
  PreviewResult,
  ProjectEntry,
  UpdateState,
} from '../../shared';
import type { UiDebugSelection } from './uiDebugRegistry';

export const SAMPLE_TIME = Date.UTC(2026, 9, 9, 3);
export const SAMPLE_DOCUMENT: CanvasDocument = {
  id: 'ui-sample-note',
  title: '전투 시스템 아이디어',
  type: 'idea',
  status: 'raw',
  relativePath: 'ideas/ui-sample.md',
  body: '## 전투의 흐름\n\n- 짧은 전투와 분명한 보상\n- [x] 플레이어 이동\n- [ ] 적의 공격 패턴\n\n> 선택이 결과에 영향을 주도록 설계합니다.\n\n| 단계 | 내용 |\n| --- | --- |\n| 탐색 | 주변을 살펴보기 |\n| 전투 | 공격과 회피 |',
  x: 120,
  y: 120,
  width: 420,
  height: 440,
  collapsed: false,
  sources: [],
  modifiedAt: SAMPLE_TIME,
};
export const SAMPLE_SECTION: CanvasSection = {
  id: 'ui-sample-section',
  title: '전투 기획',
  relativePath: 'sections/ui-sample.md',
  x: 70,
  y: 65,
  width: 950,
  height: 630,
  members: [{ id: SAMPLE_DOCUMENT.id, path: SAMPLE_DOCUMENT.relativePath }],
  modifiedAt: SAMPLE_TIME,
};
export const SAMPLE_PREVIEW: PreviewResult = {
  exists: true,
  title: '전투 시제품',
  relativePath: 'output/inbox/combat/v001/index.html',
  content:
    '<!doctype html><html lang="ko"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#182638;color:#f3f6ff;font-family:system-ui"><main style="text-align:center"><div style="font-size:48px">⚔️</div><h1>전투 시제품</h1><p>체력 100 · 스테이지 1</p><button style="padding:12px 30px;border:0;border-radius:8px;background:#c6ff78">게임 시작</button><p>UI 검토용 정적 샘플</p></main></body></html>',
};
export const SAMPLE_PROJECTS: ProjectEntry[] = [
  {
    id: 'ui-local',
    name: '전투 시스템 연구',
    kind: 'local',
    root: 'UI 미리보기',
    folderId: 'ui-folder',
    lastOpenedAt: SAMPLE_TIME,
    createdAt: SAMPLE_TIME - 86400000,
    modifiedAt: SAMPLE_TIME,
  },
  {
    id: 'ui-shared',
    name: '팀 게임잼',
    kind: 'shared',
    serverUrl: 'https://preview.invalid',
    projectId: 'ui-project',
    role: 'admin',
    connected: true,
    lastOpenedAt: SAMPLE_TIME - 30000,
    createdAt: SAMPLE_TIME - 86400000,
    modifiedAt: SAMPLE_TIME,
    pendingChanges: 2,
  },
];
export const SAMPLE_HISTORY: HistoryEntry = {
  id: 'ui-history',
  label: '전투 기획 문서 정리',
  kind: 'ai',
  status: 'completed',
  createdAt: SAMPLE_TIME,
  finishedAt: SAMPLE_TIME + 60000,
  actorName: '미리보기 사용자',
  providerId: 'codex-cli',
  taskPath: '.ai/tasks/ui-sample.md',
  files: [
    { relativePath: SAMPLE_DOCUMENT.relativePath, before: true, after: true },
  ],
  aiTask: {
    title: '전투 기획 문서 정리',
    origin: 'snapshot',
    specification:
      '## 작업 지시\n\n전투 아이디어를 정리하고 핵심 흐름을 작성해주세요.',
    inputs: [SAMPLE_DOCUMENT.relativePath],
    outputs: ['docs/combat.md'],
  },
};
export function sampleRun(state: string): CodexRunEvent {
  const status = [
    'starting',
    'running',
    'validating',
    'completed',
    'failed',
    'cancelled',
  ].includes(state)
    ? (state as CodexRunEvent['status'])
    : 'running';
  return {
    runId: 'ui-run',
    taskPath: '.ai/tasks/ui-sample.md',
    status,
    kind: status === 'failed' ? 'error' : 'log',
    message:
      status === 'failed'
        ? '샘플 오류: AI 연결을 확인해주세요.'
        : '선택한 문서를 확인하고 전투 시스템을 정리하고 있습니다.',
    timestamp: SAMPLE_TIME,
    providerId: 'codex-cli',
    ...(status === 'failed'
      ? {
          failure: {
            code: 'GC-AI-008' as const,
            stage: 'AI 연결·인증',
            message: '샘플 오류: AI 연결을 확인해주세요.',
            hint: '선택한 CLI를 설치하고 본인 계정으로 로그인한 뒤 다시 확인해주세요.',
            details: { preview: true },
            diagnosticPath: '.ai/diagnostics/ui-sample.json',
          },
        }
      : {}),
  };
}
export function sampleCollaboration(
  selection: UiDebugSelection,
): CollaborationState {
  const { id, state } = selection;
  const active =
    id === 'offline' ||
    (id === 'collaboration' &&
      [
        'admin',
        'editor',
        'viewer',
        'offline',
        'remove',
        'leave',
        'recovery',
        'test-users',
      ].includes(state)) ||
    ['locked'].includes(state);
  return {
    active,
    connected: active && state !== 'offline' && state !== 'expired',
    role:
      state === 'viewer' || state === 'locked'
        ? 'viewer'
        : state === 'editor'
          ? 'editor'
          : 'admin',
    memberId: 'ui-me',
    projectId: 'ui-project',
    projectName: '팀 게임잼',
    serverUrl: 'https://preview.invalid',
    inviteCode: 'PREVIEW-ONLY',
    recoveryKey: 'SAMPLE-KEY',
    members: [
      {
        id: 'ui-me',
        nickname: '미리보기 사용자',
        role: 'admin',
        owner: true,
        online: true,
      },
      {
        id: 'ui-other',
        nickname: '디자이너',
        role: 'editor',
        owner: false,
        online: true,
      },
      {
        id: 'ui-viewer',
        nickname: '관찰자',
        role: 'viewer',
        owner: false,
        online: false,
      },
    ],
    locks: [],
    offlineSync: true,
    editorAi: true,
    gamejamWorkflow: true,
    canvasSheets: true,
    taskInstructionsEditable: true,
    taskResultNaming: true,
    structuredResults: true,
    pendingChanges: id === 'offline' ? 3 : 0,
    accessDenied: state === 'expired',
    conflicts:
      state === 'conflict'
        ? [
            {
              id: 'ui-conflict',
              paths: [SAMPLE_DOCUMENT.relativePath],
              local: [
                { path: SAMPLE_DOCUMENT.relativePath, content: '내 수정 내용' },
              ],
              server: [
                {
                  path: SAMPLE_DOCUMENT.relativePath,
                  content: '서버의 수정 내용',
                },
              ],
            },
          ]
        : [],
  };
}
export function sampleDocuments(selection: UiDebugSelection): CanvasDocument[] {
  const { id, state } = selection;
  if (
    (id === 'canvas' || id === 'navigator' || id === 'command') &&
    state === 'empty'
  )
    return [];
  const first = {
    ...SAMPLE_DOCUMENT,
    collapsed: id === 'document' && state === 'collapsed',
  };
  if (id === 'image' || (id === 'delete' && state === 'image')) {
    first.type = 'image';
    first.title = '전투 배경 참고';
    first.asset = {
      path: 'assets/ui-sample.png',
      purpose: 'diagram',
      mime: 'image/png',
      originalName: '전투 배경.png',
      bytes: 16384,
    };
  }
  if (id === 'document' && (state === 'system' || state === 'reference'))
    first.type = state;
  if (['document', 'image', 'markdown', 'editor'].includes(id)) return [first];
  return [
    first,
    {
      ...SAMPLE_DOCUMENT,
      id: 'ui-sample-system',
      title: '성장과 보상',
      type: 'system',
      relativePath: 'docs/ui-sample.md',
      x: 590,
    },
  ];
}

/** A closed read allowlist. No method delegates to the desktop bridge or dev API. */
export function createUiPreviewApi(
  selection: UiDebugSelection,
  blocked: (method: string) => void,
): GameCanvasApi {
  const documents = sampleDocuments(selection);
  const empty =
    ['canvas', 'compare'].includes(selection.id) && selection.state === 'empty';
  let previews =
    empty || ['document', 'image', 'editor', 'markdown'].includes(selection.id)
      ? []
      : [
          SAMPLE_PREVIEW,
          {
            ...SAMPLE_PREVIEW,
            title: '전투 시제품 v2',
            relativePath: 'output/inbox/combat/v002/index.html',
          },
        ];
  if (selection.id === 'result-folder' && selection.state === 'legacy')
    previews = previews.map((item, index) => ({
      ...item,
      relativePath: index ? 'output/versions/v2.html' : 'output/index.html',
    }));
  const history =
    selection.state === 'empty'
      ? []
      : [
          SAMPLE_HISTORY,
          {
            ...SAMPLE_HISTORY,
            id: 'ui-history-user',
            kind: 'user' as const,
            label: '메모 내용 수정',
            aiTask: undefined,
          },
        ];
  const update: UpdateState = {
    status: (['update', 'update-notice'].includes(selection.id)
      ? selection.state
      : 'idle') as UpdateState['status'],
    currentVersion: '0.12.0',
    repository: 'preview/sample',
    available:
      selection.state !== 'current' &&
      ['update', 'update-notice'].includes(selection.id),
    automatic: true,
    message:
      selection.state === 'error'
        ? '샘플 오류: 업데이트를 다운로드하지 못했습니다.'
        : ((
            {
              ready: '새 버전 다운로드가 완료되었습니다.',
              downloading: '업데이트 다운로드 중… 45%',
              checking: '새 버전을 확인하고 있습니다.',
              current: '최신 버전을 사용하고 있습니다.',
              installing: '업데이트를 설치하고 있습니다.',
            } as Record<string, string>
          )[selection.state] ?? '업데이트 상태를 확인하세요.'),
    lastCheckedAt: SAMPLE_TIME,
    releaseName: 'Game Jam! 미리보기',
    ...(selection.state === 'error' ? { errorCode: 'GC-UPD-003' } : {}),
  };
  const subscribe = () => () => {};
  const reads = {
    getWorkspace: async () => ({
      root: 'ui-preview',
      name: '전투 시스템 연구',
    }),
    listProjects: async () => {
      if (selection.id === 'home' && selection.state === 'loading')
        return new Promise<ProjectEntry[]>(() => {});
      if (selection.id === 'home' && selection.state === 'error')
        throw Error('샘플 오류: 프로젝트 목록을 불러오지 못했습니다.');
      return selection.id === 'home' && selection.state === 'empty'
        ? []
        : structuredClone(SAMPLE_PROJECTS);
    },
    listProjectFolders: async () => [{ id: 'ui-folder', name: '게임잼 기획' }],
    getCanvasChanges: async () => null,
    getCanvasSheets: async () => ({
      version: 1 as const,
      canvases: [
        { id: 'default', name: '기본 캔버스' },
        { id: 'combat', name: '전투' },
      ],
      raw: null,
    }),
    listDocuments: async () => structuredClone(documents),
    getDocument: async (path: string) =>
      structuredClone(
        documents.find((item) => item.relativePath === path) ?? null,
      ),
    listSections: async () =>
      empty ||
      ['document', 'image', 'editor', 'markdown'].includes(selection.id) ||
      (['navigator', 'command'].includes(selection.id) &&
        selection.state === 'empty')
        ? []
        : [structuredClone(SAMPLE_SECTION)],
    listPreviews: async () => structuredClone(previews),
    readPreview: async (path?: string) =>
      structuredClone(
        previews.find((item) => item.relativePath === path) ?? SAMPLE_PREVIEW,
      ),
    getPreviewWindow: async (path?: string) => ({
      x: path?.includes('v002') ? 1760 : 1060,
      y: 120,
      width: 640,
      height: 480,
      collapsed: selection.id === 'preview' && selection.state === 'collapsed',
    }),
    getEditorDraft: async () => null,
    getUndoState: async () => ({ undo: null, redo: null }),
    getCollaboration: async () => sampleCollaboration(selection),
    getTestUsers: async () => ({
      supported: true,
      isTestUser: false,
      maxWindows: 5,
      windows:
        selection.state === 'test-users'
          ? [
              {
                id: 'ui-test',
                memberId: 'ui-other',
                projectId: 'ui-project',
                nickname: '테스트 사용자 1',
                role: 'editor' as const,
                status: 'ready' as const,
              },
            ]
          : [],
    }),
    getUpdateState: async () => structuredClone(update),
    getActiveRun: async () => null,
    getAiStatus: async () => ({
      available: selection.state !== 'unavailable',
      authenticated: selection.state !== 'unavailable',
      version: '미리보기',
      executablePath: null,
      message: '샘플 연결 상태입니다.',
    }),
    getCodexStatus: async () => ({
      available: true,
      authenticated: true,
      version: '미리보기',
      executablePath: null,
      message: '샘플 연결 상태입니다.',
    }),
    listHistory: async () => structuredClone(history),
    getFileAuthorship: async () => ({
      createdBy: { name: '기획자', kind: 'local' as const },
      lastEditedBy: { name: '디자이너', kind: 'member' as const },
      createdAt: SAMPLE_TIME - 86400000,
      lastEditedAt: SAMPLE_TIME,
    }),
    readHistoryFile: async () => SAMPLE_DOCUMENT.body,
    readAsset: async () => {
      if (selection.id === 'image' && selection.state === 'error')
        throw Error('샘플 이미지 오류');
      // Embedded SVG: never read real project assets or remote URLs.
      return (
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#213128"/><rect x="40" y="40" width="180" height="120" rx="18" fill="#8bae7e"/><rect x="420" y="200" width="180" height="120" rx="18" fill="#e9bc66"/><path d="M220 100H320V260H420" fill="none" stroke="#e7f0da" stroke-width="8"/><text x="80" y="109" fill="#162016" font-family="sans-serif" font-size="28">탐색</text><text x="460" y="269" fill="#302813" font-family="sans-serif" font-size="28">전투</text></svg>',
        )
      );
    },
    getWebViewer: async () => {
      if (selection.id === 'web-viewer' && selection.state === 'error')
        throw Error('샘플 웹 뷰어 오류');
      return {
        configured: selection.state !== 'unconfigured',
        url: 'https://preview.invalid',
        accessCode: 'SAMPLE-CODE',
        projects: ['ui-local'],
        liveLocal: false,
        errors: [],
      };
    },
    onDraftFlushRequested: subscribe,
    onWorkspaceChanged: subscribe,
    onCollaborationChanged: subscribe,
    onCodexRunEvent: subscribe,
    onUpdateChanged: subscribe,
    onUpdateRestartRequested: subscribe,
    onUpdateRestartReleased: subscribe,
  } satisfies Partial<GameCanvasApi>;
  return new Proxy(reads, {
    get(target, property) {
      if (Object.hasOwn(target, property)) return Reflect.get(target, property);
      return async () => {
        blocked(String(property));
        throw Error('미리보기: 실제 작업은 실행하지 않았습니다.');
      };
    },
    set: () => false,
  }) as unknown as GameCanvasApi;
}
