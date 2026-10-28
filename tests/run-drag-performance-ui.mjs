import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

await (
  await import('node:fs/promises')
).mkdir('out/drag-performance', { recursive: true });
const server = await createServer({
  configFile: 'vite.renderer.config.mts',
  server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/out/**'] } },
  plugins: [
    {
      name: 'temporary-drag-investigation',
      enforce: 'pre',
      transform(source, id) {
        source = source.replaceAll('\r\n', '\n');
        if (
          id.endsWith('/src/ui/documents/DocumentCard.tsx') &&
          process.env.DRAG_BASELINE === '1'
        ) {
          return source
            .replace(
              'const DocumentCardContent = memo(function DocumentCardContent(',
              'function DocumentCardContent(',
            )
            .replace('});\n\n// Position', '}\n\n// Position');
        }
        if (id.endsWith('/src/ui/DocumentMarkdown.tsx'))
          return source.replace(
            "image: RenderSettings['image'];\n}) {",
            "image: RenderSettings['image'];\n}) { ((globalThis as any).__dragCounts ??= {card:0,markdown:0}).markdown++;",
          );
      },
    },
  ],
});
await server.listen();
try {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['tests/drag-performance-ui.electron.mjs'], {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/ui-review.fixture.html`,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`Probe failed: ${code}`)),
    );
  });
} finally {
  await server.close();
}
