import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import type { CodexRunEvent } from '../src/shared';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const api = createDevGameCanvasApi();
const listeners = new Set<(event: CodexRunEvent) => void>();
let lastRun: CodexRunEvent | null = JSON.parse(
  sessionStorage.getItem('qaRun') ?? 'null',
);
const qa = {
  legacy: false,
  created: [] as unknown[],
  emit(runId: string) {
    lastRun = {
      runId,
      taskPath: '.ai/tasks/implement-review.md',
      status: 'completed',
      kind: 'log',
      message: '샘플 완료',
      timestamp: Date.now(),
      providerId: 'codex-cli',
    };
    sessionStorage.setItem('qaRun', JSON.stringify(lastRun));
    for (const listener of listeners) listener(lastRun);
  },
};
const create = api.createIdea;
api.createIdea = async (input) => {
  qa.created.push(input);
  return create(
    qa.legacy ? { x: input.x, y: input.y, canvasId: input.canvasId } : input,
  );
};
api.getActiveRun = async () => lastRun;
api.onCodexRunEvent = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
(window as unknown as { qaReview: typeof qa }).qaReview = qa;
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(<App />);
