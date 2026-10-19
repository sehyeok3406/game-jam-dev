import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const api = createDevGameCanvasApi();
for (const [id, name] of [
  ['materials-a', '재료 A'],
  ['materials-b', '결과 B'],
]) {
  const registry = await api.getCanvasSheets();
  await api.changeCanvasSheets({
    action: 'add',
    id,
    name,
    expected: registry.raw ?? null,
  });
}
for (const [title, canvasId, x, y] of [
  ['직접 쓴 기획', 'materials-a', 120, 120],
  ['AI가 정리한 문서', 'materials-a', 820, 120],
  ['아래쪽 자료', 'materials-a', 120, 850],
  ['다른 캔버스 자료', 'materials-b', 120, 120],
] as const) {
  const doc = await api.createIdea({ canvasId, x, y });
  await api.saveDocument({
    relativePath: doc.relativePath,
    title,
    body: '# ' + title,
  });
}
const previews = api.listPreviews;
api.listPreviews = async () =>
  (await previews()).map((p) => ({
    ...p,
    canvasId: 'materials-a',
    title: '캔버스 게임 이름',
  }));
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(<App />);
