import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  define: {
    __SELF_HOST_ENABLED__: JSON.stringify(
      process.env.GAME_CANVAS_SELF_HOST !== '0' && process.platform === 'win32',
    ),
  },
});
