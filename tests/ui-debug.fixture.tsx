import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import { UI_DEBUG_ENTRIES } from '../src/ui/debug/uiDebugRegistry';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const api = createDevGameCanvasApi();
const qa = {
  calls: [] as string[],
  events: [] as unknown[],
  entries: UI_DEBUG_ENTRIES,
};
window.gameCanvas = new Proxy(api, {
  get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      qa.calls.push(String(key));
      return Reflect.apply(value, target, args);
    };
  },
});
window.addEventListener('message', (event) => {
  if (
    event.source ===
    document.querySelector<HTMLIFrameElement>('.ui-debug-stage iframe')
      ?.contentWindow
  )
    qa.events.push(event.data);
});
(window as typeof window & { uiDebugQa: typeof qa }).uiDebugQa = qa;
const runtime = createPreviewRuntime(window.gameCanvas, localStorage);
if (new URLSearchParams(location.search).has('noDesktop')) {
  runtime.capabilities = {
    localFiles: false,
    localAiExecution: false,
    selfHostManagement: false,
    appUpdates: false,
    nativeClipboard: false,
    multiplayer: false,
  };
  runtime.api.desktop = undefined;
}
createRoot(document.getElementById('root')!).render(
  <RuntimeProvider runtime={runtime}>
    <App />
  </RuntimeProvider>,
);
