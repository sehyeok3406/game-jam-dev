import type { GameCanvasApi } from '../../contracts/app-api';
import type { AppRuntime } from './RuntimeProvider';
import { groupBridge } from './bridge-runtime';
import { createMemoryPreferences, type PreferenceStore } from './preferences';

/** Receives a sandbox fixture, never the native bridge. No global fallback. */
export function createPreviewRuntime(
  fixture: GameCanvasApi,
  preferences: PreferenceStore = createMemoryPreferences(),
): AppRuntime {
  return {
    api: groupBridge(fixture),
    capabilities: Object.freeze({
      localFiles: true,
      localAiExecution: true,
      selfHostManagement: !!fixture.selfHost,
      appUpdates: true,
      nativeClipboard: true,
      multiplayer: !!fixture.multiplayer,
    }),
    preferences,
  };
}
