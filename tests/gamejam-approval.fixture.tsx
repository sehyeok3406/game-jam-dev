import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import type { CollaborationState } from '../src/shared';
import type { GamejamApproval } from '../src/gamejam-approval';
import '@xyflow/react/dist/style.css';
import '../src/index.css';

const api = createDevGameCanvasApi();
let discordStatus: import('../src/discord-approval-types').DiscordApprovalStatus =
  {
    configured: false,
    connected: false,
    message: '디스코드가 연결되지 않았습니다.',
  };
api.discordApproval = {
  openHelp: async (page) => {
    qa.helpLink = page;
  },
  sendTest: async () => ({ message: '테스트 알림을 보냈습니다.' }),
  status: async () => structuredClone(discordStatus),
  configure: async ({ token, ...settings }) => {
    if (!token) throw Error('토큰을 입력해주세요.');
    discordStatus = {
      configured: true,
      connected: true,
      message: '연결됨 · 테스트 연결',
      settings,
      projectName: '승인 UI 프로젝트',
    };
    return structuredClone(discordStatus);
  },
  disconnect: async () => {
    discordStatus = {
      configured: false,
      connected: false,
      message: '연결을 해제했습니다.',
    };
    return structuredClone(discordStatus);
  },
  onPrepare: () => () => {},
};
const source = (await api.listDocuments())[0];
const listeners = new Set<(state: CollaborationState) => void>();
let connectedAi = false;
let state: CollaborationState = {
  active: true,
  connected: true,
  projectId: 'approval-ui-project',
  memberId: 'team',
  role: 'editor',
  members: [],
  locks: [],
  requestApprovalVersion: 1,
  requestDeletionVersion: 1,
  requestsVersion: 0,
  revision: 1,
  pendingRequests: 0,
};
let items: GamejamApproval[] = [];
const publish = () => {
  state = {
    ...state,
    pendingRequests: items.filter((r) => r.status === 'pending').length,
  };
  listeners.forEach((f) => f({ ...state }));
};
const qa = {
  helpLink: '',
  submits: 0,
  creates: 0,
  runs: 0,
  addPending() {
    const item = structuredClone(items[0]);
    item.id = crypto.randomUUID();
    item.status = 'pending';
    item.revision = 1;
    item.request.resultName = '삭제 대상 요청';
    item.changes = [];
    items.push(item);
    state = { ...state, requestsVersion: (state.requestsVersion ?? 0) + 1 };
    publish();
  },
  local(local: boolean) {
    state = { ...state, active: !local, connected: !local };
    publish();
  },
  role(role: 'admin' | 'editor' | 'viewer') {
    state = { ...state, role, memberId: role === 'admin' ? 'admin' : 'team' };
    publish();
  },
  login() {
    connectedAi = true;
  },
  changeSource() {
    state = { ...state, revision: (state.revision ?? 0) + 1 };
    publish();
  },
  changeRequest() {
    items = items.map((r) => ({
      ...r,
      revision: r.revision + 1,
      request: { ...r.request, resultName: '팀원이 변경한 요청' },
    }));
    state = { ...state, requestsVersion: (state.requestsVersion ?? 0) + 1 };
    publish();
  },
  startElsewhere() {
    items = items.map((r) => ({
      ...r,
      revision: r.revision + 1,
      status: 'running',
    }));
    state = { ...state, requestsVersion: (state.requestsVersion ?? 0) + 1 };
    publish();
  },
};
api.getCollaboration = async () => ({ ...state });
api.onCollaborationChanged = (f) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
api.getTestUsers = async () => ({
  supported: false,
  isTestUser: true,
  maxWindows: 0,
  windows: [],
});
api.getAiStatus = async () => ({
  available: connectedAi,
  authenticated: connectedAi,
  message: connectedAi ? '테스트 연결' : 'AI 미설치',
  executablePath: null,
  version: null,
});
api.listHistory = async () => [
  {
    id: 'template',
    label: '작성 템플릿',
    kind: 'ai',
    status: 'failed',
    createdAt: 1,
    files: [],
    aiTask: {
      title: 'template',
      specification: '',
      inputs: [],
      outputs: [],
      origin: 'snapshot',
      requestSnapshot: {
        version: 1,
        providerId: 'codex-cli',
        modelId: '',
        request: {
          organize: false,
          implement: true,
          inputPaths: [source.relativePath],
          x: 200,
          y: 100,
          resultName: '팀원 게임',
          htmlResult: { mode: 'new' },
          instructions: {
            organize: '문서를 정리해줘',
            implement: '키보드로 움직이는 게임을 만들어줘',
          },
        },
      },
    },
  },
];
api.createTask = async () => {
  qa.creates++;
  throw new Error('팀원이 직접 실행하면 안 됩니다.');
};
api.listApprovals = async () =>
  structuredClone({ items, version: state.requestsVersion ?? 0 });
api.readApproval = async (id) => ({
  item: structuredClone(items.find((r) => r.id === id)!),
  reviewToken: String(state.revision),
  outputs: ['output/test/index.html'],
});
api.mutateApproval = async (action, input) => {
  qa.submits++;
  const item = items.find((r) => r.id === input.id);
  if (action === 'create')
    items.push({
      id: input.commandId,
      projectId: state.projectId!,
      authorId: state.memberId!,
      authorName: '팀원',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      revision: 1,
      status: 'pending',
      request: structuredClone(input.request!),
      changes: [],
    });
  else if (
    !item ||
    item.revision !== input.revision ||
    !['pending', 'feedback'].includes(item.status)
  )
    throw new Error('이미 구현이 시작되었거나 요청이 변경되었습니다.');
  else {
    item.revision++;
    item.updatedAt = Date.now();
    if (action === 'delete') {
      if (state.role !== 'admin' || !input.message?.trim())
        throw Error('관리자와 삭제 이유가 필요합니다.');
      item.deletion = {
        reason: input.message.trim(),
        actorId: state.memberId!,
        actorName: '관리자',
        at: Date.now(),
        previousStatus: item.status as Exclude<
          GamejamApproval['status'],
          'deleted'
        >,
      };
      item.status = 'deleted';
    }
    if (action === 'update') {
      item.request = structuredClone(input.request!);
      item.status = 'pending';
    }
    if (action === 'cancel') item.status = 'cancelled';
    if (action === 'feedback') {
      item.status = 'feedback';
      item.feedback = input.message;
    }
  }
  state = { ...state, requestsVersion: (state.requestsVersion ?? 0) + 1 };
  publish();
  return structuredClone(action === 'create' ? items.at(-1)! : item!);
};
api.startCodexRun = async (input) => {
  if (state.role !== 'admin' || !input.approval)
    throw new Error('관리자 승인 필요');
  const item = items.find((r) => r.id === input.approval!.id)!;
  if (
    item.revision !== input.approval.revision ||
    input.approval.reviewToken !== String(state.revision)
  )
    throw new Error('내용 변경');
  qa.runs++;
  item.status = 'running';
  item.revision++;
  item.approvedName = '관리자';
  state = { ...state, requestsVersion: (state.requestsVersion ?? 0) + 1 };
  publish();
  return {
    runId: 'fixture-approved-run',
    taskPath: '.ai/tasks/approved.md',
    status: 'starting',
    providerId: input.providerId,
    modelId: input.modelId,
  };
};
(window as unknown as { qaApproval: typeof qa }).qaApproval = qa;
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeProvider
      runtime={createPreviewRuntime(window.gameCanvas, localStorage)}
    >
      <App />
    </RuntimeProvider>
  </StrictMode>,
);
