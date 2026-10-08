import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
const server = await createServer({
  configFile: 'vite.renderer.config.mts',
  server: {
    host: '127.0.0.1',
    port: 0,
    watch: { ignored: ['**/out/**/profile/**'] },
  },
});
await server.listen();
try {
  const port = server.httpServer.address().port;
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['tests/canvas-sheets-ui.electron.mjs'], {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_URL: `http://127.0.0.1:${port}/tests/canvas-sheets-ui.fixture.html`,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`Canvas UI QA failed: ${code}`)),
    );
  });
} finally {
  await server.close();
}
