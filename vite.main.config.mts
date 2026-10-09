import { defineConfig } from 'vite';
import path from 'node:path';

const selfHostEnabled =
  process.env.GAME_CANVAS_SELF_HOST !== '0' && process.platform === 'win32';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: selfHostEnabled
      ? {}
      : {
          './features/self-host/register': path.resolve(
            'src/features/self-host/disabled.ts',
          ),
        },
  },
  define: {
    __SELF_HOST_ENABLED__: JSON.stringify(selfHostEnabled),
  },
});
