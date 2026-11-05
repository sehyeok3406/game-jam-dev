import { build, preview } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';

const directory = 'out/camera-performance';
const viewportTest = process.env.CAMERA_VIEWPORT_TEST === '1';
const previewTest = process.env.CAMERA_PREVIEW_TEST === '1';
const streamingTest = process.env.CAMERA_STREAMING_TEST === '1';
const baseline = process.env.CAMERA_BASELINE === '1';
const snapshot = process.env.CAMERA_SOURCE_SNAPSHOT;
const variant = baseline
  ? 'baseline'
  : snapshot
    ? (process.env.CAMERA_SNAPSHOT_VARIANT ?? 'stage4')
    : 'optimized';
const original = new Map();
const anchors = new Map([
  ['src/ui/canvas/useCanvasNodes.ts', ['useEffect(() => {', 'nodeEffects']],
  [
    'src/ui/workspace/WorkspaceScreen.tsx',
    ['const [snapEnabled, setSnapEnabled] = useState(true);', 'workspace'],
  ],
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
    'src/ui/drawing/TextDrawingNode.tsx',
    ['  const { api } = useRuntime();', 'text'],
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
const sourceFiles = [
  ...anchors.keys(),
  'src/ui/canvas/WorkspaceCanvas.tsx',
  'src/ui/canvas/WorkspaceCanvasTools.tsx',
  'src/ui/shell/WorkspaceChrome.tsx',
];
if (baseline)
  for (const file of sourceFiles)
    original.set(
      file,
      execFileSync('git', ['show', `HEAD:${file}`], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }),
    );
if (snapshot) {
  const hashes = JSON.parse(
    await fs.readFile(
      path.join(snapshot, '..', 'baseline-source.json'),
      'utf8',
    ),
  );
  for (const file of Object.keys(hashes))
    original.set(file, await fs.readFile(path.join(snapshot, file), 'utf8'));
}
await fs.mkdir(directory, { recursive: true });
await build({
  configFile: 'vite.renderer.config.mts',
  base: '/',
  resolve: {
    alias: { 'node:crypto': path.resolve('tests/mocks/browser-crypto.ts') },
  },
  plugins: [
    {
      name: 'camera-regression-counters',
      enforce: 'pre',
      transform(source, id) {
        const file = path.relative(process.cwd(), id).replaceAll('\\', '/');
        source = original.get(file) ?? source;
        if (previewTest && file === 'src/ui/DocumentLinksContext.tsx')
          return source.replace(
            'index.current.update(documents);',
            'index.current.update(documents); (globalThis as any).__qaLinkBodies = documents.map(d=>d.body);',
          );
        if (previewTest && file === 'src/ui/preview/usePreviewPlayback.ts') {
          let result = source
            .replace(
              'observer.observe(area);',
              '(globalThis as any).__previewObservers = ((globalThis as any).__previewObservers ?? 0) + 1; observer.observe(area);',
            )
            .replace(
              'observer.disconnect();',
              'observer.disconnect(); (globalThis as any).__previewObservers--;',
            );
          for (const anchor of [
            'const report = (event: MessageEvent) => {',
            'const frameEscape = (event: MessageEvent) => {',
          ])
            result = result.replace(
              anchor,
              anchor +
                ' (globalThis as any).__previewMessageCallbacks = ((globalThis as any).__previewMessageCallbacks ?? 0) + 1;',
            );
          return result;
        }
        if (previewTest && file === 'src/ui/preview/playback-events.ts')
          return source.replace(
            'private message = (event: MessageEvent) => {',
            'private message = (event: MessageEvent) => { (globalThis as any).__previewMessageCallbacks = ((globalThis as any).__previewMessageCallbacks ?? 0) + 1;',
          );
        if (
          process.env.CAMERA_CONTENT_TEST === '1' &&
          file === 'src/ui/canvas/content-cache.ts'
        ) {
          if (!source.includes('this.builds++;'))
            throw Error('Content cache test anchor missing');
          return source.replace(
            'this.builds++;',
            'this.builds++; const counter = ((globalThis as any).__resourceBuilds ??= {}); counter[key] = (counter[key] ?? 0) + 1;',
          );
        }
        if (viewportTest && file === 'src/ui/canvas/CanvasViewport.tsx') {
          const anchor = 'const viewport = useCanvasViewportStore();';
          if (!source.includes(anchor))
            throw Error('Viewport test anchor missing');
          return source.replace(
            anchor,
            anchor +
              '\n(globalThis as any).__viewportStore = viewport; (globalThis as any).__viewportFlowStore = flow;',
          );
        }
        if (viewportTest && file === 'src/ui/canvas/viewport-store.ts') {
          if (
            !source.includes(
              'const { camera, nodes, priorityIds = [] } = this.read();',
            ) ||
            !source.includes('this.index.sync(canvasSpatialItems(geometry));')
          )
            throw Error('Viewport geometry/frame test anchors missing');
          return source
            .replace(
              'const { camera, nodes, priorityIds = [] } = this.read();',
              'const { camera, nodes, priorityIds = [] } = this.read(); (globalThis as any).__viewportFrames = ((globalThis as any).__viewportFrames ?? 0) + 1;',
            )
            .replace(
              'this.index.sync(canvasSpatialItems(geometry));',
              'this.index.sync(canvasSpatialItems(geometry)); (globalThis as any).__viewportGeometryScans = ((globalThis as any).__viewportGeometryScans ?? 0) + 1;',
            );
        }
        if (!sourceFiles.includes(file))
          return original.has(file) ? source : undefined;
        let result = (original.get(file) ?? source).replaceAll('\r\n', '\n');
        if (file === 'src/ui/canvas/WorkspaceCanvas.tsx') {
          const anchor = 'flowRef.current = instance;';
          if (!result.includes(anchor))
            throw Error('Camera test flow anchor missing');
          result = result.replace(
            anchor,
            anchor + ' (globalThis as any).__perfFlow = instance;',
          );
        }
        const entry = anchors.get(file);
        if (entry) {
          const [anchor, name] = entry;
          if (!result.includes(anchor))
            throw Error(`Camera test counter anchor missing: ${file}`);
          result = result.replace(
            anchor,
            anchor +
              `\n(globalThis as any).__perfCounts.${name} = ((globalThis as any).__perfCounts.${name} ?? 0) + 1;`,
          );
        }
        return result;
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
  if (previewTest)
    await build({
      configFile: false,
      logLevel: 'warn',
      build: {
        ssr: 'tests/preview-playback-ui.electron.mjs',
        outDir: 'out/canvas-stage6/native',
        emptyOutDir: true,
        target: 'esnext',
        rollupOptions: {
          external: ['electron', 'ws'],
          output: { format: 'es', entryFileNames: 'main.mjs' },
        },
      },
    });
  await new Promise((resolve, reject) => {
    const child = spawn(
      electron,
      [
        streamingTest
          ? 'tests/canvas-streaming-ui.electron.mjs'
          : previewTest
            ? 'out/canvas-stage6/native/main.mjs'
            : viewportTest
              ? process.env.CAMERA_CONTENT_TEST === '1'
                ? 'tests/canvas-content-ui.electron.mjs'
                : process.env.CAMERA_PREPARATION_TEST === '1'
                  ? 'tests/canvas-preparation-ui.electron.mjs'
                  : 'tests/canvas-viewport-ui.electron.mjs'
              : 'tests/camera-performance-ui.electron.mjs',
      ],
      {
        windowsHide: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          CAMERA_VARIANT: variant,
          QA_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/camera-performance.fixture.html`,
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error(`Camera regression failed: ${code}`)),
    );
  });
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
}
