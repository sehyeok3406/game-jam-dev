import { build } from 'vite';
await build({
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: 'tools/web-viewer/worker.ts',
    target: 'node24',
    outDir: 'out/web-viewer',
    emptyOutDir: false,
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'worker.cjs' },
    },
  },
});
console.log('Built windowless web viewer publisher.');
