import { ServerLimits } from '../../contracts/server-limits.ts';
import { GameBuildLimits } from '../../contracts/game-build.ts';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './errors.ts';

type Reservation = {
  bytes: number;
  limit: number;
  reserve: (bytes: number) => void;
};
const reservations = new WeakMap<IncomingMessage, Reservation>();
export function requestByteLimit(request: IncomingMessage) {
  return request.headers?.['x-game-build-storage-version'] === '1'
    ? GameBuildLimits.requestBytes
    : ServerLimits.requestBytes;
}
/** Per-server budget held through JSON parsing, project FIFO and durable commit. */
export function createRequestAdmission(
  options: { bytes?: number; concurrent?: number } = {},
) {
  const budget = options.bytes ?? 96_000_000,
    concurrent = options.concurrent ?? 4;
  let used = 0,
    active = 0;
  return (request: IncomingMessage) => {
    if (request.method !== 'POST') return () => {};
    const limit = requestByteLimit(request);
    const length = request.headers['content-length'];
    const declared = length === undefined ? 0 : Number(length);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)
      throw new ApiError('요청이 너무 큽니다.', 413);
    const capacity = () => {
      const error = new ApiError(
        '서버가 큰 요청을 처리 중입니다. 잠시 후 같은 작업으로 다시 시도해주세요.',
        503,
      );
      error.code = 'REQUEST_CAPACITY';
      return error;
    };
    if (active >= concurrent || used + declared > budget) throw capacity();
    active++;
    used += declared;
    const reservation: Reservation = {
      bytes: declared,
      limit,
      reserve(bytes) {
        const extra = Math.max(0, bytes - reservation.bytes);
        if (used + extra > budget) throw capacity();
        used += extra;
        reservation.bytes += extra;
      },
    };
    reservations.set(request, reservation);
    return () => {
      used -= reservation.bytes;
      active--;
      reservations.delete(request);
    };
  };
}

export async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  const limit = requestByteLimit(request);
  const declared = Number(request.headers?.['content-length'] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit)
    throw new ApiError('요청이 너무 큽니다.', 413);
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw new ApiError('요청이 너무 큽니다.', 413);
    reservations.get(request)?.reserve(size);
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
