import type { ServerResponse } from 'node:http';

export function reply(
  response: ServerResponse,
  status: number,
  value: unknown,
) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}
