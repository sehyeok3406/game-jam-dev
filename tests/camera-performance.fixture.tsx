import { createRoot } from 'react-dom/client';
import { RuntimeProvider } from '../src/ui/runtime/RuntimeProvider';
import { createPreviewRuntime } from '../src/ui/runtime/preview-runtime';
import { App } from '../src/ui/App';
import { createDevGameCanvasApi } from '../src/dev-api';
import { newGameUiItem } from '../src/game-ui-model';
import { mixedCanvasFixture } from './helpers/mixed-canvas-fixture';
import '@xyflow/react/dist/style.css';
import '../src/index.css';
const p = new URLSearchParams(location.search),
  kind = p.get('kind') ?? 'markdown',
  n = Number(p.get('n') ?? 20);
const editing = p.has('editing');
const api = createDevGameCanvasApi(),
  sample = (await api.listDocuments())[0];
const pos = (i: number) => ({ x: (i % 16) * 460, y: Math.floor(i / 16) * 380 });
const body =
  '## 게임 설계 문서\n\n' +
  Array.from(
    { length: 10 },
    (_, i) =>
      `### ${i + 1}. 전투와 보상\n\n- 플레이어의 **선택**과 피드백\n- [ ] 확인할 항목\n\n탐색하고 전투하며 보상을 얻는 흐름을 확인합니다.\n\n| 항목 | 값 |\n| --- | --- |\n| 체력 | 100 |\n`,
  ).join('\n');
const documents = ['markdown', 'images'].includes(kind)
  ? Array.from({ length: n }, (_, i) => ({
      ...sample,
      id: `perf-${i}`,
      relativePath: `docs/perf-${i}.md`,
      title: `점검 ${i}`,
      type: kind === 'images' ? 'image' : 'idea',
      ...pos(i),
      width: 420,
      height: 330,
      collapsed: false,
      body: kind === 'images' ? '이미지 참고 자료' : body,
      asset: kind === 'images' ? { path: `assets/image-${i}.png` } : undefined,
    }))
  : [];
const drawings = ['shapes', 'text', 'strokes'].includes(kind)
  ? Array.from({ length: n }, (_, i) => ({
      id: editing ? crypto.randomUUID() : `drawing-perf-${i}`,
      generation: editing ? crypto.randomUUID() : `generation-${i}`,
      canvasId: 'default',
      kind:
        kind === 'shapes' ? 'shape' : kind === 'strokes' ? 'stroke' : 'text',
      transform: {
        ...pos(i),
        width: kind === 'text' ? 400 : 320,
        height: kind === 'text' ? 240 : 220,
        rotation: 0,
      },
      style: {
        fill: kind === 'shapes' ? '#eff2ff' : null,
        stroke: '#6366f1',
        strokeWidth: 2,
        opacity: 1,
        strokePattern: 'solid',
      },
      layer: 'annotation',
      order: i,
      createdAt: 1,
      updatedAt: 1,
      geometry:
        kind === 'shapes'
          ? { shape: 'rounded-rectangle', cornerRadius: 12 }
          : kind === 'strokes'
            ? {
                brush: 'pen',
                sourceWidth: 320,
                sourceHeight: 220,
                points: Array.from({ length: 500 }, (_, j) => [
                  (j * 320) / 499,
                  110 + Math.sin(j / 11) * 70,
                  0.5,
                ]),
                pressureEnabled: false,
                rendererVersion: 1,
              }
            : {
                document: JSON.stringify({
                  type: 'doc',
                  content: Array.from({ length: 5 }, (_, j) => ({
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: `텍스트 ${i} / ${j} — 캔버스 표시 성능 점검`,
                      },
                    ],
                  })),
                }),
                fontSize: 24,
                color: '#273142',
                fontFamily: 'sans-serif',
                align: 'left',
              },
    }))
  : [];
const frames =
  kind === 'game-ui'
    ? Array.from({ length: n }, (_, i) => ({
        version: 1,
        id: crypto.randomUUID(),
        generation: crypto.randomUUID(),
        canvasId: 'default',
        title: `게임 UI ${i}`,
        ...pos(i),
        width: 420,
        viewportWidth: 1280,
        viewportHeight: 720,
        descriptionPath: null,
        items: Array.from({ length: 20 }, (_, j) => ({
          ...newGameUiItem(
            (['health', 'mana', 'button', 'text', 'skills'] as const)[j % 5],
            () => crypto.randomUUID(),
          ),
          x: (j % 4) * 300,
          y: Math.floor(j / 4) * 130,
        })),
      }))
    : [];
const html = `<!doctype html><html><body style="margin:0;background:#182638;color:white"><h2>HTML 게임 점검</h2><canvas width="360" height="200"></canvas>${kind === 'html-active' ? '<script>const c=document.querySelector("canvas"),x=c.getContext("2d");function draw(t){x.fillStyle="#182638";x.fillRect(0,0,360,200);for(let i=0;i<60;i++){x.fillStyle="hsl("+i*6+" 65% 55%)";x.fillRect((i*31+t/20)%360,(i*17)%200,12,12)}requestAnimationFrame(draw)}requestAnimationFrame(draw)</script>' : ''}</body></html>`;
const previews = kind.startsWith('html-')
  ? Array.from({ length: n }, (_, i) => ({
      exists: true,
      title: `게임 ${i}`,
      sourceId: `preview-${i}`,
      canvasId: 'default',
      relativePath: `output/inbox/game-${i}/v001/index.html`,
      content: html,
    }))
  : [];
if (kind === 'mixed') {
  const mixed = mixedCanvasFixture(n, sample as any);
  documents.push(...mixed.documents);
  drawings.push(...mixed.drawings);
  frames.push(...mixed.frames);
  previews.push(...mixed.previews);
  (window as any).__fixtureCounts = mixed.counts;
}
if (p.has('updates') && documents.length > 1)
  documents[1].sources = [
    { id: documents[0].id, contribution: '참고 제목 갱신 검사' },
  ];
if (p.has('preview-source')) {
  previews.push({
    exists: true,
    title: 'HTML 참고 원본',
    sourceId: 'preview-source',
    canvasId: 'default',
    relativePath: 'output/inbox/source/v001/index.html',
    content: html,
  });
  if (documents[1])
    documents[1].sources.push({
      id: 'preview-source',
      contribution: 'HTML 제목 갱신 검사',
    });
}
api.listDocuments = async () => structuredClone(documents) as any;
api.getDocument = async (relative) =>
  structuredClone(
    documents.find((d) => d.relativePath === relative) ?? null,
  ) as any;
api.listSections = async () => [];
api.listPreviews = async () => structuredClone(previews);
api.getPreviewWindow = async (relative) => ({
  ...pos(Number(relative?.match(/game-(\d+)/)?.[1] ?? 0)),
  width: 420,
  height: 330,
  collapsed: false,
});
if (p.has('preview-lifecycle')) {
  documents.push({
    ...sample,
    id: 'preview-metadata',
    relativePath: 'docs/preview-metadata.md',
    title: 'HTML 참고 설명',
    body: '첫 설명',
    htmlSource: previews[0].relativePath,
    x: 100000,
    y: 100000,
    width: 420,
    height: 330,
    collapsed: false,
  });
  const layouts = new Map<string, any>();
  const get = api.getPreviewWindow;
  api.getPreviewWindow = async (relative) =>
    layouts.get(relative) ?? get(relative);
  api.savePreviewWindow = async (state, relative) => {
    layouts.set(relative, structuredClone(state));
  };
  (window as any).__previewReports = [];
  api.multiplayer = {
    ...api.multiplayer,
    reportPreview: async (input: unknown) => {
      (window as any).__previewReports.push(input);
    },
  } as any;
}
if (editing) {
  await api.applyDrawingCommand({
    action: 'create',
    canvasId: 'default',
    objects: drawings.map(
      ({ canvasId: _canvasId, ...object }) => object,
    ) as any,
  });
} else {
  api.listDrawings = async () => structuredClone(drawings) as any;
  api.getDrawingChanges = async () =>
    ({
      changed: structuredClone(drawings),
      removed: [],
      signatures: {},
    }) as any;
}
api.listGameUi = async () => structuredClone(frames);
api.getCanvasSheets = async () => ({
  version: 1,
  canvases: [
    { id: 'default', name: '성능 점검' },
    ...(p.has('preparation') ? [{ id: 'other', name: '다른 화면' }] : []),
  ],
  raw: null,
});
api.getEditorDraft = async () => null;
api.getDocumentSaveStates = async () => [];
if (p.has('updates')) {
  const workspaceListeners = new Set<() => void>();
  const oldWorkspaceListener = api.onWorkspaceChanged;
  api.onWorkspaceChanged = (listener) => {
    workspaceListeners.add(listener);
    const stop = oldWorkspaceListener(listener);
    return () => {
      workspaceListeners.delete(listener);
      stop();
    };
  };
  const collaborationListeners = new Set<(state: any) => void>();
  const oldCollaborationListener = api.onCollaborationChanged;
  api.onCollaborationChanged = (listener) => {
    collaborationListeners.add(listener);
    const stop = oldCollaborationListener(listener);
    return () => {
      collaborationListeners.delete(listener);
      stop();
    };
  };
  const collaboration = await api.getCollaboration();
  const notify = () => {
    for (const listener of workspaceListeners) listener();
  };
  (window as any).qaNodeUpdates = {
    heartbeat: () => {
      for (const listener of collaborationListeners)
        listener(structuredClone(collaboration));
    },
    rename: (title: string) => {
      documents[0] = {
        ...documents[0],
        title,
        modifiedAt: documents[0].modifiedAt + 1,
      };
      notify();
    },
    body: (body: string) => {
      documents[0] = {
        ...documents[0],
        body,
        modifiedAt: documents[0].modifiedAt + 1,
      };
      notify();
    },
    asset: () => {
      documents[0] = {
        ...documents[0],
        assetVersion: (documents[0].assetVersion ?? 0) + 1,
        modifiedAt: documents[0].modifiedAt + 1,
      };
      notify();
    },
    renamePreview: (title: string) => {
      previews[0] = { ...previews[0], title };
      notify();
    },
    lock: (nickname: string) => {
      const state = {
        ...collaboration,
        active: true,
        connected: true,
        role: 'admin',
        memberId: 'self',
        pendingChanges: 0,
        locks: [
          {
            relativePath: documents[0].relativePath,
            memberId: 'peer',
            nickname,
          },
        ],
      };
      for (const listener of collaborationListeners) listener(state);
    },
  };
}
api.readAsset = async (relative) => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 640;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 1024, 640);
  g.addColorStop(0, '#4466bb');
  g.addColorStop(1, '#cc77aa');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 640);
  ctx.fillStyle = 'white';
  ctx.font = '40px sans-serif';
  ctx.fillText(relative, 50, 100);
  const url = canvas.toDataURL('image/png');
  // The fixture synthesizes files; release its temporary drawing surface just
  // as the production thumbnail preparation releases its own canvas.
  canvas.width = canvas.height = 0;
  return url;
};
(window as any).gameCanvas = api;
(window as any).__perfCounts = {};
createRoot(document.getElementById('root')!).render(
  <RuntimeProvider runtime={createPreviewRuntime(api, localStorage)}>
    <App />
  </RuntimeProvider>,
);
