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
    },
  },
  define: {
    __SELF_HOST_ENABLED__: 'false',
    __dirname: JSON.stringify(path.resolve('out/ai-queue-main')),
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173/'),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    ssr: 'tests/ai-queue-main-runner.ts',
    outDir: 'out/ai-queue-main',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron-squirrel-startup'],
      output: { format: 'es', entryFileNames: 'runner.mjs' },
    },
  },
});
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['out/ai-queue-main/runner.mjs'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error('Queue main QA failed: ' + code)),
  );
});
