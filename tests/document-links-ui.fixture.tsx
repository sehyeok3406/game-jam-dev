import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import { documentLinkMarkdown } from '../src/document-links';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
async function boot() {
  const api = createDevGameCanvasApi();
  window.gameCanvas = api;
  await api.saveDocument({
    relativePath: 'ideas/night-farm.md',
    title: '링크 원본',
    body:
      documentLinkMarkdown(
        'gamejam://document/automation-note',
        '연결 대상',
        true,
      ) + '\n\n[고정 문구](gamejam://document/automation-note)\n\n본문',
  });
  await api.saveDocument({
    relativePath: 'ideas/automation.md',
    title: '연결 대상',
    body: '대상 내용',
  });
  createRoot(document.getElementById('root')!).render(
    <RuntimeProvider
      runtime={createPreviewRuntime(window.gameCanvas, localStorage)}
    >
      <App />
    </RuntimeProvider>,
  );
}
void boot();
