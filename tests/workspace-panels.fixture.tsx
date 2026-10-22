import { createRoot } from 'react-dom/client';
import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createDevGameCanvasApi } from '../src/dev-api';
import { App } from '../src/ui/App';
import type { UpdateState } from '../src/contracts/desktop';
import '@xyflow/react/dist/style.css';
import '../src/index.css';

const bridge = createDevGameCanvasApi(localStorage);
const updates = new Set<(state: UpdateState) => void>();
let rejectJoin: ((error: Error) => void) | undefined;
bridge.onUpdateChanged = (listener) => {
  updates.add(listener);
  return () => {
    updates.delete(listener);
  };
};
bridge.joinCollaboration = async () =>
  new Promise((_resolve, reject) => {
    rejectJoin = reject;
  });
const qa = {
  get subscriptions() {
    return updates.size;
  },
  failJoin() {
    rejectJoin?.(Error('격리한 참여 실패'));
  },
  async update() {
    const state: UpdateState = {
      ...(await bridge.getUpdateState()),
      status: 'ready',
      available: true,
      message: '격리한 자동 알림',
      lastCheckedAt: Date.now(),
    };
    for (const listener of updates) listener(state);
  },
};
(window as unknown as { qaPanels: typeof qa }).qaPanels = qa;
window.gameCanvas = bridge;
createRoot(document.getElementById('root')!).render(
  <RuntimeProvider runtime={createPreviewRuntime(bridge, localStorage)}>
    <App />
  </RuntimeProvider>,
);
