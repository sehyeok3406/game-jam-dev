/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
/// <reference types="vite/client" />
import type { GameCanvasApi } from './shared';

declare global {
  interface Window {
    gameCanvas: GameCanvasApi;
  }
}
