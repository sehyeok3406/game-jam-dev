import { createServer, build } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: 'tests/real-save-ui.electron.ts',
    outDir: 'out/real-save-ui',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
      output: { format: 'es', entryFileNames: 'runner.mjs' },
    },
  },
});
const server = await createServer({
  configFile: 'vite.renderer.config.mts',
  cacheDir: 'out/real-save-ui/vite-cache',
  resolve: { dedupe: ['react', 'react-dom', '@xyflow/react'] },
  optimizeDeps: { entries: ['tests/real-save-ui.fixture.html'], force: true },
  server: {
    host: '127.0.0.1',
    port: 0,
    hmr: false,
    watch: null,
  },
});
await server.listen();
try {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['out/real-save-ui/runner.mjs'], {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/real-save-ui.fixture.html`,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error('Real save UI test exited ' + code)),
    );
  });
} finally {
  await server.close();
}
