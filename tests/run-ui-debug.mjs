import { createServer, build } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import path from 'node:path';
const native = process.argv.includes('--native');
const packaged = native || process.argv.includes('--built');
let server;
let url;
if (packaged) {
  await build({
    configFile: 'vite.renderer.config.mts',
    base: './',
    build: {
      outDir: 'out/ui-debug-build',
      rollupOptions: {
        input: {
          app: path.resolve('index.html'),
          fixture: path.resolve('tests/ui-debug.fixture.html'),
        },
      },
    },
  });
  url = new URL(
    `file:///${path.resolve('out/ui-debug-build/tests/ui-debug.fixture.html').replaceAll('\\', '/')}`,
  ).href;
} else {
  server = await createServer({
    configFile: 'vite.renderer.config.mts',
    server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/out/**'] } },
  });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}/tests/ui-debug.fixture.html`;
}
try {
  if (native) {
    for (const [entry, name] of [
      ['src/preload.ts', 'preload.cjs'],
      ['tests/ui-debug-native.ts', 'runner.cjs'],
    ])
      await build({
        configFile: false,
        logLevel: 'error',
        build: {
          ssr: entry,
          outDir: 'out/ui-debug-native',
          emptyOutDir: false,
          rollupOptions: {
            external: ['electron'],
            output: { format: 'cjs', entryFileNames: name },
          },
        },
      });
  }
  await new Promise((resolve, reject) => {
    const child = spawn(
      electron,
      [
        native
          ? path.resolve('out/ui-debug-native/runner.cjs')
          : 'tests/ui-debug.electron.mjs',
      ],
      {
        windowsHide: true,
        stdio: 'inherit',
        env: { ...process.env, QA_URL: url, QA_BUILT: packaged ? '1' : '0' },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`UI debug QA failed: ${code}`)),
    );
  });
} finally {
  await server?.close();
}
