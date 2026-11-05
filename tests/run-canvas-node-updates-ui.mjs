import { build, preview } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';

const directory = 'out/canvas-stage2';
const snapshot = process.env.CANVAS_NODE_BASELINE;
const originals = new Map();
const changed = [
  'src/ui/canvas/useCanvasNodes.ts',
  'src/ui/workspace/WorkspaceScreen.tsx',
  'src/ui/canvas/WorkspaceCanvas.tsx',
  'src/ui/DocumentLinksContext.tsx',
  'src/ui/documents/DocumentCard.tsx',
  'src/ui/documents/types.ts',
  'src/ui/drawing/useDrawing.ts',
  'src/features/game-ui/useGameUi.ts',
];
if (snapshot)
  for (const file of changed)
    originals.set(file, await fs.readFile(path.join(snapshot, file), 'utf8'));
const anchors = new Map([
  [
    'src/ui/documents/DocumentCard.tsx',
    [
      "}: Pick<NodeProps<DocumentCanvasNode>, 'data' | 'selected'>) {",
      'document',
    ],
  ],
  [
    'src/ui/drawing/DrawingNode.tsx',
    ['}: NodeProps<DrawingCanvasNode>) {', 'drawing'],
  ],
  [
    'src/features/game-ui/GameUiNode.tsx',
    ["}: Pick<NodeProps<GameUiCanvasNode>, 'data' | 'selected'>) {", 'gameUi'],
  ],
  [
    'src/ui/preview/PreviewCard.tsx',
    [
      "}: Pick<NodeProps<PreviewCanvasNode>, 'data' | 'selected'>) {",
      'preview',
    ],
  ],
]);
await fs.mkdir(directory, { recursive: true });
await build({
  configFile: 'vite.renderer.config.mts',
  base: '/',
  resolve: {
    alias: { 'node:crypto': path.resolve('tests/mocks/browser-crypto.ts') },
  },
  plugins: [
    {
      name: 'node-update-regression-counters',
      enforce: 'pre',
      transform(source, id) {
        const file = path.relative(process.cwd(), id).replaceAll('\\', '/');
        let result = (originals.get(file) ?? source).replaceAll('\r\n', '\n');
        if (file === 'src/ui/canvas/WorkspaceCanvas.tsx')
          result = result.replace(
            'flowRef.current = instance;',
            'flowRef.current = instance; (globalThis as any).__perfFlow=instance;',
          );
        if (file === 'src/ui/canvas/useCanvasNodes.ts') {
          const start = 'useEffect(() => {',
            set = 'setNodes((currentNodes) => {',
            end = 'return next.length === currentNodes.length &&';
          for (const anchor of [start, set, end])
            if (!result.includes(anchor))
              throw Error('Node update timing anchor missing: ' + anchor);
          result = result.replace(
            start,
            start +
              ' const __buildStart=performance.now(); (globalThis as any).__perfCounts.nodeEffects=((globalThis as any).__perfCounts.nodeEffects??0)+1;',
          );
          result = result.replace(
            set,
            '(globalThis as any).__perfCounts.buildMs=((globalThis as any).__perfCounts.buildMs??0)+performance.now()-__buildStart; ' +
              set +
              ' const __reconcileStart=performance.now();',
          );
          result = result.replace(
            end,
            '(globalThis as any).__perfCounts.reconcileMs=((globalThis as any).__perfCounts.reconcileMs??0)+performance.now()-__reconcileStart; ' +
              end,
          );
        }
        const entry = anchors.get(file);
        if (entry) {
          const [anchor, name] = entry;
          if (!result.includes(anchor))
            throw Error('Node update counter anchor missing: ' + file);
          result = result.replace(
            anchor,
            anchor +
              `\n(globalThis as any).__perfCounts.${name}=((globalThis as any).__perfCounts.${name}??0)+1;`,
          );
        }
        if (file === 'src/ui/documents/DocumentCard.tsx') {
          const [anchor] = entry;
          result = result.replace(
            anchor,
            anchor +
              '\n((globalThis as any).__perfCounts.documentIds ??= {})[data.document.id] = (((globalThis as any).__perfCounts.documentIds ?? {})[data.document.id] ?? 0) + 1;',
          );
        }
        return result === source ? undefined : result;
      },
    },
  ],
  build: {
    outDir: `${directory}/built`,
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve('tests/camera-performance.fixture.html'),
    },
  },
});
const server = await preview({
  configFile: false,
  build: { outDir: `${directory}/built` },
  preview: { host: '127.0.0.1', port: 0 },
});
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      electron,
      ['tests/canvas-node-updates-ui.electron.mjs'],
      {
        windowsHide: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_UPDATE_VARIANT: snapshot ? 'stage1' : 'stage2',
          QA_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/camera-performance.fixture.html`,
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error('Node update regression failed: ' + code)),
    );
  });
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
}
