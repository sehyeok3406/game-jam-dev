import { build } from 'vite';

// A Node-only server: no Electron, renderer or AI credentials in this bundle.
await build({
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: 'src/collaboration-server-entry.ts',
    target: 'node24',
    outDir: 'out/collaboration-server',
    emptyOutDir: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'server.mjs' },
    },
  },
});
console.log('Built out/collaboration-server/server.mjs (Node.js 24+)');
