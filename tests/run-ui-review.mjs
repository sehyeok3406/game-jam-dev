import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
const server = await createServer({
  configFile: 'vite.renderer.config.mts',
  server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/out/**'] } },
});
await server.listen();
try {
  const port = server.httpServer.address().port;
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['tests/ui-review.electron.mjs'], {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_URL: `http://127.0.0.1:${port}/tests/ui-review.fixture.html`,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error('UI review QA failed: ' + code)),
    );
  });
} finally {
  await server.close();
}
