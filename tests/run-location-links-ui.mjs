import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
await build({
  configFile: 'vite.renderer.config.mts',
  base: './',
  logLevel: 'error',
  build: {
    outDir: 'out/location-links-ui/web',
    emptyOutDir: false,
    rollupOptions: { input: 'tests/location-links-ui.fixture.html' },
  },
});
const server = await preview({
  configFile: false,
  build: { outDir: 'out/location-links-ui/web' },
  preview: { host: '127.0.0.1', port: 0 },
});
try {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['tests/location-links-ui.electron.mjs'], {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/location-links-ui.fixture.html`,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`Location UI QA failed: ${code}`)),
    );
  });
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
}
