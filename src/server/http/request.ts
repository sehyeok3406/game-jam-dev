import { ServerLimits } from '../../contracts/server-limits.ts';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.ts';

export async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > ServerLimits.requestBytes)
      throw new ApiError('요청이 너무 큽니다.', 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    // Decode after joining: a tunnel may split a Korean character across chunks.
    const raw = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new ApiError('요청 형식이 올바르지 않습니다.', 400);
  }
}

export function bearerToken(request: IncomingMessage) {
  return String(request.headers.authorization ?? '').replace(/^Bearer /, '');
}
