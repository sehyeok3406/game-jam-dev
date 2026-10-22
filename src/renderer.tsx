import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import { App } from './ui/App';
import type { GameCanvasApi } from './shared';
import { RuntimeProvider } from './ui/runtime/RuntimeProvider';
import { createDesktopRuntime } from './ui/runtime/desktop-runtime';
import { createPreviewRuntime } from './ui/runtime/preview-runtime';
import { createMemoryPreferences } from './ui/runtime/preferences';

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

  let runtime;
  if (!browserWindow.gameCanvas) {
    if (!import.meta.env.DEV) throw new Error('Game Jam! API is unavailable.');
    const { createDevGameCanvasApi } = await import('./dev-api');
    const preferences = createMemoryPreferences();
    runtime = createPreviewRuntime(
      createDevGameCanvasApi(preferences),
      preferences,
    );
  } else
    runtime = createDesktopRuntime(
      browserWindow.gameCanvas,
      window.localStorage,
    );

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element is missing.');

  createRoot(root).render(
    <StrictMode>
      <RuntimeProvider runtime={runtime}>
        <App />
      </RuntimeProvider>
    </StrictMode>,
  );
}

void bootstrap();
