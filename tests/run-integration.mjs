import { build } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

async function compile(entry, file, alias = {}) {
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias },
    define: {
      __SELF_HOST_ENABLED__: 'false',
      __dirname: JSON.stringify(path.resolve('out/test-validation')),
      MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173/'),
      MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
    },
    build: {
      ssr: entry,
      outDir: 'out/test-validation',
      emptyOutDir: false,
      rollupOptions: {
        external: ['electron-squirrel-startup'],
        output: { format: 'es', entryFileNames: file },
      },
    },
  });
}
async function run(executable, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Integration test exited ${code}`)),
    );
  });
}
await compile('tests/main-flow-runner.ts', 'main-flow-runner.mjs', {
  electron: path.resolve('tests/mocks/electron.ts'),
  'node:child_process': path.resolve('tests/mocks/process.ts'),
});
await run(process.execPath, ['out/test-validation/main-flow-runner.mjs']);
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: 'tests/html-validation-runner.ts',
    outDir: 'out/test-validation',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'html-validation-runner.cjs' },
    },
  },
});
await run(electron, ['out/test-validation/html-validation-runner.cjs']);
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: 'tests/preview-pointer-electron.ts',
    outDir: 'out/test-validation',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'preview-pointer-electron.cjs' },
    },
  },
});
await run(electron, ['out/test-validation/preview-pointer-electron.cjs']);
await build({
  configFile: false,
  logLevel: 'error',
  resolve: {
    alias: { electron: path.resolve('tests/multi-user-electron.ts') },
  },
  define: {
    __SELF_HOST_ENABLED__: 'false',
    __dirname: JSON.stringify(path.resolve('out/test-validation')),
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173/'),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    ssr: 'tests/test-user-worker.ts',
    outDir: 'out/test-validation',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron/main', 'electron-squirrel-startup'],
      output: { format: 'cjs', entryFileNames: 'test-user-worker.cjs' },
    },
  },
});
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: 'tests/test-users-electron-runner.ts',
    outDir: 'out/test-validation',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'test-users-electron-runner.cjs',
      },
    },
  },
});
await run(electron, ['out/test-validation/test-users-electron-runner.cjs']);
await run(process.execPath, ['tests/run-canvas-sheets-ui.mjs']);

await run(process.execPath, ['tests/run-sync-ui.mjs']);
