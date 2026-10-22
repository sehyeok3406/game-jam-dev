import { defineConfig } from 'vite';
import path from 'node:path';

const selfHostEnabled =
  process.env.GAME_CANVAS_SELF_HOST !== '0' && process.platform === 'win32';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rolldownOptions: {
      // discord.js probes this optional native accelerator and catches its absence.
      // Keep the probe at runtime; its supported uncompressed Gateway needs no addon.
      external: ['zlib-sync'],
    },
  },
  resolve: {
    alias: selfHostEnabled
      ? []
      : [
          {
            find: /^(?:\.\/|\.\.\/)+features\/self-host\/register$/,
            replacement: path.resolve('src/features/self-host/disabled.ts'),
          },
        ],
  },
  define: {
    __SELF_HOST_ENABLED__: JSON.stringify(selfHostEnabled),
  },
});
