import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import { App } from './ui/App';
import type { GameCanvasApi } from './shared';

async function bootstrap() {
  const browserWindow = window as typeof window & {
    gameCanvas?: GameCanvasApi;
  };

  if (!browserWindow.gameCanvas) {
    if (!import.meta.env.DEV)
      throw new Error('Game Canvas API is unavailable.');
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
