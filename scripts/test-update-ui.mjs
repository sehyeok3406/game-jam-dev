import path from 'node:path';
import { build } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

// Requires production renderer/preload from npm run package or npm run make.
await build({
  configFile: false,
  logLevel: 'error',
  define: {
    __dirname: JSON.stringify(path.resolve('.vite/build')),
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(''),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    ssr: 'tests/update-electron-runner.ts',
    outDir: 'out/test-update-ui',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron', 'electron-squirrel-startup'],
      output: { format: 'es', entryFileNames: 'update-ui.mjs' },
    },
  },
});
await new Promise((resolve, reject) => {
  const child = spawn(electron, ['out/test-update-ui/update-ui.mjs'], {
    stdio: 'inherit',
    windowsHide: false,
  });
  child.on('error', reject);
  child.on('close', (code) =>
    code === 0 ? resolve() : reject(new Error(`Update UI test exited ${code}`)),
  );
});
