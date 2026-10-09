import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const selfHostEnabled =
  process.env.GAME_CANVAS_SELF_HOST !== '0' && process.platform === 'win32';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: selfHostEnabled
      ? {}
      : {
          '../features/self-host/SelfHostDialog': path.resolve(
            'src/features/self-host/disabled-view.tsx',
          ),
        },
  },
  define: {
    __SELF_HOST_ENABLED__: JSON.stringify(selfHostEnabled),
  },
  plugins: [react()],
});
