import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const api = createDevGameCanvasApi();
const save = api.saveDocument;
const qa = {
  delay: 0,
  starts: 0,
  acknowledgements: 0,
  reads: 0,
  assetReads: 0,
  layoutStarts: 0,
  layoutAcks: 0,
  layouts: [] as { x: number; y: number; relativePath: string }[],
  sent: [] as { title: string; body: string }[],
};
const readAsset = api.readAsset;
api.readAsset = async (relative) => {
  if (relative !== 'assets/images/save-test.png') return readAsset(relative);
  qa.assetReads++;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return (
    'data:image/svg+xml;base64,' +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>',
    )
  );
};
api.saveDocument = async (input) => {
  const snapshot = structuredClone(input);
  qa.starts++;
  qa.sent.push(snapshot);
  await new Promise((resolve) => setTimeout(resolve, qa.delay));
  const result = await save(snapshot);
  qa.acknowledgements++;
  return result;
};
const layout = api.updateDocumentLayout;
api.updateDocumentLayout = async (input) => {
  const snapshot = structuredClone(input);
  qa.layoutStarts++;
  qa.layouts.push(snapshot);
  await new Promise((resolve) => setTimeout(resolve, qa.delay));
  await layout(snapshot);
  qa.layoutAcks++;
};
const get = api.getDocument;
api.getDocument = async (relative) => {
  qa.reads++;
  return structuredClone(await get(relative));
};
(window as unknown as { qa: typeof qa }).qa = qa;
window.gameCanvas = api;
createRoot(document.getElementById('root')!).render(<App />);
