import { build } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';
const run = (exe, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`Clipboard test exited ${code}`)),
    );
  });
await build({
  configFile: false,
  logLevel: 'error',
  resolve: {
    alias: {
      electron: path.resolve('tests/mocks/electron.ts'),
      'node:child_process': path.resolve('tests/mocks/process.ts'),
    },
  },
  define: {
    __SELF_HOST_ENABLED__: 'false',
    __dirname: JSON.stringify(path.resolve('out/test-validation')),
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173/'),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    ssr: 'tests/clipboard-main-runner.ts',
    outDir: 'out/test-validation',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron-squirrel-startup'],
      output: { format: 'es', entryFileNames: 'clipboard-main-runner.mjs' },
    },
  },
});
await run(process.execPath, ['out/test-validation/clipboard-main-runner.mjs']);
await run(electron, ['tests/clipboard-native.electron.mjs']);
