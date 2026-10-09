import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
const server = await createServer({
  configFile: 'vite.renderer.config.mts',
  server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/out/**'] } },
});
await server.listen();
try {
  await new Promise((resolve, reject) => {
    const child = spawn(electron, ['tests/self-host-ui.electron.mjs'], {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_URL: `http://127.0.0.1:${server.httpServer.address().port}/tests/self-host.fixture.html`,
      },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Self-host UI QA exited ${code}`)),
    );
  });
} finally {
  await server.close();
}
