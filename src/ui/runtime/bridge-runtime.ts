import {
  APP_API_GROUPS,
  type AppApi,
  type GameCanvasApi,
} from '../../contracts/app-api.ts';

/** Preserve optional APIs and callback identity, including fixture overrides. */
export function groupBridge(bridge: GameCanvasApi): AppApi {
  const api = Object.fromEntries(
    [
      'projects',
      'editor',
      'saves',
      'collaboration',
      'ai',
      'history',
      'preview',
      'desktop',
    ].map((group) => [group, {}]),
  ) as AppApi;
  for (const name of Object.keys(APP_API_GROUPS) as (keyof GameCanvasApi)[]) {
    const target = api[APP_API_GROUPS[name]]!;
    let source: unknown;
    let forwarded: unknown;
    Object.defineProperty(target, name, {
      enumerable: true,
      get() {
        const value = bridge[name];
        if (value !== source) {
          source = value;
          forwarded = typeof value === 'function' ? value.bind(bridge) : value;
        }
        return forwarded;
      },
    });
  }
  return api;
}
