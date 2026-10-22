import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import '@xyflow/react/dist/style.css';
import '../src/index.css';

const api = createDevGameCanvasApi();
const source = (await api.listDocuments()).find((d) => d.type === 'idea')!;
const html = (await api.listPreviews())[0];
api.getTestUsers = async () => ({
  supported: false,
  isTestUser: true,
  maxWindows: 10,
  windows: [],
});
const qa = {
  api,
  source,
  html,
  enqueue: async () => {
    const task = await api.createTask({
      queueVersion: 1,
      kind: 'implement',
      inputPaths: [source.relativePath, html.relativePath],
      htmlResult: { mode: 'new' },
      resultName: '예약 게임',
      x: 500,
      y: 400,
    });
    return api.startCodexRun({
      queueVersion: 1,
      taskPath: task.relativePath,
      providerId: 'codex-cli',
      modelId: null,
    });
  },
};
(window as unknown as { qaQueue: typeof qa }).qaQueue = qa;
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(
  <RuntimeProvider
    runtime={createPreviewRuntime(window.gameCanvas, localStorage)}
  >
    <App />
  </RuntimeProvider>,
);
