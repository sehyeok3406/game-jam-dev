import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import type { CollaborationState, CodexConnectionStatus } from '../src/shared';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const api = createDevGameCanvasApi();
let connection: CodexConnectionStatus = {
  available: true,
  authenticated: true,
  message: '샘플 연결',
  version: null,
  executablePath: null,
};
const listeners = new Set<(state: CollaborationState) => void>();
const qa = {
  creates: 0,
  runs: 0,
  requests: [] as unknown[],
  connection(available: boolean, authenticated: boolean) {
    connection = {
      ...connection,
      available,
      authenticated,
      message: !available
        ? '샘플 CLI가 설치되어 있지 않습니다.'
        : authenticated
          ? '샘플 연결'
          : '샘플 AI 로그인이 필요합니다.',
    };
  },
  shared(change: Partial<CollaborationState>) {
    const state: CollaborationState = {
      active: true,
      connected: true,
      members: [],
      locks: [],
      role: 'admin',
      htmlResultFolders: true,
      htmlComposition: true,
      htmlImportAnalysis: true,
      gamejamWorkflow: true,
      taskResultNaming: true,
      taskInstructionsEditable: true,
      multiProviderAi: true,
      ...change,
    };
    for (const listener of listeners) listener(state);
  },
};
api.getTestUsers = async () => ({
  supported: false,
  isTestUser: true,
  maxWindows: 10,
  windows: [],
});
api.getAiStatus = async () => connection;
api.createTask = async (input) => {
  qa.creates++;
  qa.requests.push(input);
  throw Error('테스트 서버에서 작업 요청을 거절했습니다. 입력은 유지됩니다.');
};
api.startCodexRun = async () => {
  qa.runs++;
  throw Error('AI 실행 금지');
};
api.onCollaborationChanged = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
(window as unknown as { qaValidation: typeof qa }).qaValidation = qa;
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(<App />);
