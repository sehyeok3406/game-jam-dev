import { createContext, useContext } from 'react';
import type { AppApi } from '../../contracts/app-api.ts';
import type { ClientCapabilities } from '../../contracts/capabilities.ts';
import type { PreferenceStore } from './preferences.ts';

export type AppRuntime = {
  api: AppApi;
  capabilities: ClientCapabilities;
  preferences: PreferenceStore;
};

export const RuntimeContext = createContext<AppRuntime | null>(null);

export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('Game Jam! RuntimeProvider is missing.');
  return runtime;
}
