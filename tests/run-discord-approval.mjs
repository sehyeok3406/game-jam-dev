import { build } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
await build({
  configFile: false,
  logLevel: 'error',
  resolve: {
    alias: {
      electron: path.resolve('tests/mocks/electron.ts'),
      'node:child_process': path.resolve('tests/mocks/process.ts'),
      './discord-transport': path.resolve('tests/mocks/discord-transport.ts'),
    },
  },
  define: {
    __SELF_HOST_ENABLED__: 'false',
    __dirname: JSON.stringify(path.resolve('out/test-discord')),
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173/'),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    ssr: 'tests/discord-main-flow-runner.ts',
    outDir: 'out/test-discord',
    emptyOutDir: false,
    rolldownOptions: {
      external: ['electron-squirrel-startup'],
      output: { format: 'es', entryFileNames: 'discord-main-flow-runner.mjs' },
    },
  },
});
await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ['out/test-discord/discord-main-flow-runner.mjs'],
    { stdio: 'inherit', windowsHide: true },
  );
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(Error(`Discord IPC test exited ${code}`)),
  );
});
