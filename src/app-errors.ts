import type { FailureInfo } from './contracts/errors.ts';
export type { FailureInfo } from './contracts/errors.ts';
import type { ErrorCode } from './contracts/errors.ts';
export type { ErrorCode } from './contracts/errors.ts';
import { ERROR_CODES } from './contracts/errors.ts';
export { ERROR_CODES } from './contracts/errors.ts';
import { PlayError } from './multiplayer/errors.ts';
export class CanvasError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;
  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CanvasError';
    this.code = code;
    this.details = details;
  }
}
export function failureInfo(
  error: unknown,
  fallback: ErrorCode = 'GC-APP-001',
): FailureInfo {
  const message = error instanceof Error ? error.message : String(error);
  const embedded = message.match(/\[(GC-[A-Z]+-\d{3})\]/)?.[1] as
    | ErrorCode
    | undefined;
  const code =
    error instanceof CanvasError
      ? error.code
      : embedded && embedded in ERROR_CODES
        ? embedded
        : fallback;
  return {
    code,
    stage: ERROR_CODES[code][0],
    message: message.replace(/^\[GC-[A-Z]+-\d{3}\]\s*/, ''),
    hint: ERROR_CODES[code][1],
    details:
      error instanceof CanvasError || error instanceof PlayError
        ? error.details
        : {},
  };
}
export function errorText(failure: FailureInfo) {
  return `[${failure.code}] ${failure.message}`;
}
export function redactDiagnostic(value: string) {
  return value
    .replace(
      /("(?:token|api[_-]?key|authorization|secret)"\s*:\s*")[^"\n]*(")/gi,
      '$1[REDACTED]$2',
    )
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(
      /((?:token|api[_-]?key|authorization|secret)\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}
