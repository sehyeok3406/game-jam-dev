import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import type { CollaborationState, CodexRunEvent } from '../src/shared';
import '@xyflow/react/dist/style.css';
import '../src/index.css';

const api = createDevGameCanvasApi();
const listeners = new Set<(state: CollaborationState) => void>();
const runListeners = new Set<(event: CodexRunEvent) => void>();
let state: CollaborationState = JSON.parse(
  sessionStorage.getItem('qaAiState') ?? 'null',
) ?? {
  active: true,
  connected: true,
  projectId: 'qa-project-a',
  role: 'admin',
  members: [],
  locks: [],
  canvasSheets: true,
  revision: 1,
};
api.getTestUsers = async () => ({
  supported: false,
  isTestUser: true,
  maxWindows: 10,
  windows: [],
});
api.getCollaboration = async () => structuredClone(state);
api.onCollaborationChanged = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
api.onCodexRunEvent = (listener) => {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
};
api.getActiveRun = async () => structuredClone(state.aiRun ?? null);
function publish(next: CollaborationState) {
  state = next;
  sessionStorage.setItem('qaAiState', JSON.stringify(state));
  for (const listener of listeners) listener(structuredClone(state));
}
const qa = {
  run(runId: string, status: CodexRunEvent['status'] = 'completed') {
    publish({
      ...state,
      revision: (state.revision ?? 0) + 1,
      aiRun: {
        runId,
        status,
        taskPath: '.ai/tasks/implement-review.md',
        kind: 'status',
        timestamp: Date.now(),
        providerId: 'codex-cli',
        message: '샘플 작업',
      },
    });
  },
  replay() {
    publish({ ...structuredClone(state), revision: (state.revision ?? 0) + 1 });
  },
  ipc() {
    if (state.aiRun)
      for (const listener of runListeners)
        listener(structuredClone(state.aiRun));
  },
  project(projectId?: string) {
    publish(
      projectId
        ? { ...state, active: true, connected: true, projectId }
        : { active: false, connected: false, members: [], locks: [] },
    );
  },
};
(window as unknown as { qaAi: typeof qa }).qaAi = qa;
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(<App />);
