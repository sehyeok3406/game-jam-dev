import { createRoot } from 'react-dom/client';
import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createDevGameCanvasApi } from '../src/dev-api';
import { App } from '../src/ui/App';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const bridge = createDevGameCanvasApi(localStorage);
const changed = bridge.onWorkspaceChanged;
// Real file/SSE notifications arrive after command receipts. Undo must refresh
// drawing generations itself rather than relying on this delayed notification.
bridge.onWorkspaceChanged = (listener) => {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const stop = changed(() => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      listener();
    }, 300);
    timers.add(timer);
  });
  return () => {
    stop();
    for (const timer of timers) clearTimeout(timer);
  };
};
window.gameCanvas = bridge;
createRoot(document.getElementById('root')!).render(
  <RuntimeProvider runtime={createPreviewRuntime(bridge, localStorage)}>
    <App />
  </RuntimeProvider>,
);
