import { createRoot } from 'react-dom/client';
import { App } from '../src/ui/App';
import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { createDevGameCanvasApi } from '../src/dev-api';
import {
  parseLocationLink,
  locationLinkHref,
} from '../src/core/projects/location-links';
import { previewNodeId } from '../src/ui/workspace/workspace-types';
import type { LocationItem } from '../src/contracts/location-links';
import '@xyflow/react/dist/style.css';
import '../src/index.css';

async function boot() {
  const api = createDevGameCanvasApi();
  const projectId = '11111111-1111-4111-8111-111111111111',
    blockId = '22222222-2222-4222-8222-222222222222';
  const session = {
    projectKey: `shared:${projectId}`,
    sessionId: 'ui-session',
    epoch: 1,
  };
  const workspace = api.getWorkspace.bind(api);
  api.getWorkspace = async () => ({
    ...(await workspace()),
    session,
    saveScope: `shared:${projectId}:member`,
  });
  const collab = api.getCollaboration.bind(api);
  api.getCollaboration = async () => ({
    ...(await collab()),
    active: true,
    connected: true,
    projectId,
    role: 'admin',
    locationAnchorVersion: 1,
    drawingTextVersion: 1,
    drawingTextAlignmentVersion: 1,
  });
  await api.saveDocument({
    relativePath: 'ideas/night-farm.md',
    title: '위치 링크 문단 검증',
    body: Array.from(
      { length: 35 },
      (_, i) =>
        `문단 ${i + 1}${i === 30 ? `<!--gamejam:block:${blockId}-->` : ''}`,
    ).join('\n\n'),
  });
  let pending: { id: number; href: string } | null = null,
    listener = () => {};
  api.locationLinks = {
    create: async (target) =>
      locationLinkHref({ version: 1, projectId, target }),
    open: async (href) => {
      const link = parseLocationLink(href);
      const docs = await api.listDocuments(),
        drawings = await api.listDrawings(),
        previews = await api.listPreviews();
      const doc = docs.find((doc) => doc.id === link.target.id);
      const drawing = drawings.find((item) => item.id === link.target.id);
      const html = previews.find(
        (item) =>
          item.sourceId === link.target.id ||
          previewNodeId(item) === link.target.id,
      );
      const item: LocationItem = doc
        ? {
            target: link.target,
            canvasId: doc.canvasId ?? 'default',
            documentId: doc.id,
            relativePath: doc.relativePath,
          }
        : drawing
          ? { target: link.target, canvasId: drawing.canvasId }
          : {
              target: link.target,
              canvasId: html?.canvasId ?? 'default',
              relativePath: html?.relativePath,
              previewIdentityPath: html?.identityPath,
            };
      if (!doc && !drawing && !html) throw Error('링크 대상 없음');
      return { workspace: await api.getWorkspace(), item };
    },
    pending: async () => pending,
    acknowledge: async (id) => {
      if (pending?.id === id) pending = null;
    },
    onReceived: (fn) => {
      listener = fn;
      return () => {
        listener = () => {};
      };
    },
  };
  api.copyText = async (text) => {
    (window as any).copiedLocation = text;
  };
  Object.assign(window, {
    gameCanvas: api,
    sendLocation: (target: unknown) => {
      pending = {
        id: Date.now(),
        href: locationLinkHref({
          version: 1,
          projectId,
          target: target as any,
        }),
      };
      listener();
    },
  });
  createRoot(document.getElementById('root')!).render(
    <RuntimeProvider runtime={createPreviewRuntime(api, localStorage)}>
      <App />
    </RuntimeProvider>,
  );
}
void boot();
