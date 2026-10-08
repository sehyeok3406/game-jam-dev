import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const api = createDevGameCanvasApi();
const createTask = api.createTask;
api.createTask = async (input) => {
  (window as unknown as { qaLastRequest: unknown }).qaLastRequest = input;
  return createTask(input);
};
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(<App />);
