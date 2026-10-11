import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import type { CreateTaskInput, HistoryEntry } from '../src/shared';
import { defaultDocumentTemplates } from '../src/document-format';
import '@xyflow/react/dist/style.css';
import '../src/index.css';

const api = createDevGameCanvasApi();
const source = (await api.listDocuments())[0];
const failure: HistoryEntry = {
  id: 'interrupted-fixture',
  label: '중단된 문서 추출',
  kind: 'ai',
  status: 'failed',
  createdAt: 42,
  error: '샘플 사용량 한도에 도달했습니다.',
  files: [],
  providerId: 'claude-cli',
  modelId: 'recovery-model',
  aiTask: {
    title: '중단된 문서 추출',
    specification: '## 사용자 작업 지시\n\n실패 기록에서 불러온 지시',
    inputs: [source.relativePath],
    outputs: [],
    origin: 'snapshot',
    requestSnapshot: {
      version: 1,
      providerId: 'claude-cli',
      modelId: 'recovery-model',
      request: {
        canvasId: 'default',
        organize: true,
        implement: false,
        inputPaths: [source.relativePath],
        x: 120,
        y: 180,
        resultName: '실패 기록 복원',
        documentResult: {
          mode: 'new',
          structure: 'custom',
          documents: defaultDocumentTemplates(),
        },
        instructions: {
          organize: '실패 기록에서 불러온 지시',
          implement: '비활성 단계도 보관',
        },
      },
    },
  },
};
const history = api.listHistory;
api.listHistory = async () => [...(await history()), failure];
api.getTestUsers = async () => ({
  supported: false,
  isTestUser: true,
  maxWindows: 10,
  windows: [],
});
const qa = { creates: 0, runs: 0, requests: [] as CreateTaskInput[] };
const create = api.createTask;
api.createTask = async (input) => {
  qa.creates++;
  qa.requests.push(structuredClone(input));
  return create(input);
};
api.startCodexRun = async () => {
  qa.runs++;
  throw Error('샘플 AI 연결이 끊겼습니다. 실제 AI 호출 없음.');
};
(window as unknown as { qaHistory: typeof qa }).qaHistory = qa;
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(<App />);
