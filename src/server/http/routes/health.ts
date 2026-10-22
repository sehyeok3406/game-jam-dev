import { serverCapabilities } from '../../capabilities.ts';
import type { HttpRoute } from '../router.ts';
import { reply } from '../response.ts';

export function healthRoute(version: string): HttpRoute {
  return (request, response, url) => {
    if (request.method !== 'GET' || url.pathname !== '/health') return false;
    reply(response, 200, {
      name: 'Game Canvas Collaboration',
      ...serverCapabilities(),
      protocol: 1,
      version,
    });
    return true;
  };
}

export function readyRoute(ready: () => boolean): HttpRoute {
  return (request, response, url) => {
    if (request.method !== 'GET' || url.pathname !== '/ready') return false;
    const value = ready();
    reply(response, value ? 200 : 503, { ready: value });
    return true;
  };
}
