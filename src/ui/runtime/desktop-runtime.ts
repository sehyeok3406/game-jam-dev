import type { GameCanvasApi } from '../../contracts/app-api';
import type { AppRuntime } from './RuntimeProvider';
import { groupBridge } from './bridge-runtime';
import type { PreferenceStore } from './preferences';

export function createDesktopRuntime(
  bridge: GameCanvasApi,
  preferences: PreferenceStore,
): AppRuntime {
  return {
    api: groupBridge(bridge),
    capabilities: Object.freeze({
      localFiles: true,
      localAiExecution: true,
      selfHostManagement: !!bridge.selfHost,
      appUpdates: true,
      nativeClipboard: true,
      multiplayer: !!bridge.multiplayer,
    }),
    preferences,
  };
}
