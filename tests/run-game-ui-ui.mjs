import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import path from 'node:path';
const server = await createServer({
  configFile: 'vite.renderer.config.mts',
  resolve: {
    alias: { 'node:crypto': path.resolve('tests/mocks/browser-crypto.ts') },
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    watch: { ignored: ['**/out/**'] },
  },
});
await server.listen();
try {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['tests/game-ui.electron.mjs'], {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/canvas-sheets-ui.fixture.html`,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`Game UI QA failed: ${code}`)),
    );
  });
} finally {
  await server.close();
}
