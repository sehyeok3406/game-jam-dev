import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import { App } from './ui/App';
import type { GameCanvasApi } from './shared';

async function bootstrap() {
  const preview = new URLSearchParams(window.location.search).get(
    'uiDebugPreview',
  );
  if (preview !== null) {
    const { bootstrapUiDebugPreview } =
      await import('./ui/debug/uiDebugPreview');
    await bootstrapUiDebugPreview(preview);
    return;
  }
  const browserWindow = window as typeof window & {
    gameCanvas?: GameCanvasApi;
  };

  if (!browserWindow.gameCanvas) {
    if (!import.meta.env.DEV) throw new Error('Game Jam! API is unavailable.');
    const { createDevGameCanvasApi } = await import('./dev-api');
    browserWindow.gameCanvas = createDevGameCanvasApi();
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element is missing.');

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
