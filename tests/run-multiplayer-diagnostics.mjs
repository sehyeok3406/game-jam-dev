import { build } from 'vite';
import electron from 'electron';
import { spawn } from 'node:child_process';
const directory = 'out/multiplayer-diagnostics-qa';
await build({
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: 'tests/multiplayer-diagnostics.electron.ts',
    outDir: directory,
    emptyOutDir: false,
    target: 'esnext',
    rollupOptions: {
      external: ['electron'],
      output: { format: 'es', entryFileNames: 'main.mjs' },
    },
  },
});
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    lib: {
      entry: 'src/multiplayer-player-preload.ts',
      formats: ['cjs'],
      fileName: () => 'multiplayer-player-preload.cjs',
    },
    outDir: directory,
    emptyOutDir: false,
    rollupOptions: { external: ['electron'] },
  },
});
const child = spawn(electron, [directory + '/main.mjs'], {
  windowsHide: true,
  stdio: 'inherit',
});
const timer = setTimeout(() => child.kill(), 45000);
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  clearTimeout(timer);
}
