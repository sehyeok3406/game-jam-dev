export { PLAY_ERROR_HINTS } from '../contracts/multiplayer-errors.ts';
import { PLAY_ERRORS } from '../contracts/multiplayer-errors.ts';
export { PLAY_ERRORS } from '../contracts/multiplayer-errors.ts';
import type { PlayErrorCode } from '../contracts/multiplayer-errors.ts';
export type { PlayErrorCode } from '../contracts/multiplayer-errors.ts';
import type { PlayFailure } from '../contracts/multiplayer-errors.ts';
export type { PlayFailure } from '../contracts/multiplayer-errors.ts';
import type { PlayDetails } from '../contracts/multiplayer-errors.ts';
export type { PlayDetails } from '../contracts/multiplayer-errors.ts';
const tokens: Record<string, RegExp> = {
  side: /^(main|server|game|preview|client|validation)$/,
  operation:
    /^(list|create|join|leave|ready|start|artifact|open|connect|send|copy|preview|receive|runtime|validate)$/,
  roomStatus: /^(lobby|loading|running|paused|finished|closed)$/,
  callback:
    /^(register|createState|validateInput|step|render|getOutcome|serialize|script|reportIssue)$/,
  errorName:
    /^(Error|TypeError|SyntaxError|RangeError|ReferenceError|EvalError|URIError|AggregateError)$/,
  customCode: /^GAME-[A-Z]{2,16}-\d{3}$/,
  projectRef: /^[a-f0-9]{16}$/,
  roomRef: /^[a-f0-9]{16}$/,
  matchRef: /^[a-f0-9]{16}$/,
  sessionRef: /^[a-f0-9]{16}$/,
  sourceHash: /^[a-f0-9]{64}$/,
  transportCode:
    /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ERR_TLS_CERT_ALTNAME_INVALID|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT)$/,
  resourceType:
    /^(image|media|font|script|stylesheet|xhr|fetch|other|mainFrame|subFrame)$/,
  connectionStage:
    /^(server|joining|connecting|preparing|ready|playing|recovering|failed)$/,
  serverVersion:
    /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:-[A-Za-z0-9.-]{1,40})?$/,
};
const numbers = new Set([
  'line',
  'column',
  'closeCode',
  'httpStatus',
  'attempt',
  'durationMs',
  'bytes',
  'limit',
  'tick',
  'sequence',
  'multiplayerVersion',
  'multiplayerDiagnosticsVersion',
  'multiplayerLobbyVersion',
]);
export function playDetails(value: unknown): PlayDetails {
  const result: PlayDetails = {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return result;
  for (const [key, input] of Object.entries(value)) {
    if (
      typeof input === 'string' &&
      Object.hasOwn(tokens, key) &&
      tokens[key].test(input)
    )
      result[key] = input;
    if (
      typeof input === 'number' &&
      numbers.has(key) &&
      Number.isSafeInteger(input) &&
      input >= 0 &&
      input <= Number.MAX_SAFE_INTEGER
    )
      result[key] = input;
  }
  return result;
}
export function isPlayCode(value: unknown): value is PlayErrorCode {
  return typeof value === 'string' && Object.hasOwn(PLAY_ERRORS, value);
}
export class PlayError extends Error {
  readonly code: PlayErrorCode;
  readonly details: PlayDetails;
  readonly failure?: PlayFailure;
  constructor(
    code: PlayErrorCode,
    details: unknown = {},
    failure?: PlayFailure,
  ) {
    super(`[${code}] ${PLAY_ERRORS[code].message}`);
    this.name = 'PlayError';
    this.code = code;
    this.details = playDetails(details);
    this.failure = failure;
  }
}
/** Only catalog text + allowlisted scalars cross logging/UI boundaries. */
export function playFailure(
  error: unknown,
  fallback: PlayErrorCode = 'GC-MP-029',
  details: unknown = {},
): PlayFailure {
  const value = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    details?: unknown;
    failure?: unknown;
    id?: unknown;
    at?: unknown;
    status?: unknown;
  };
  const carried = (
    value?.failure && typeof value.failure === 'object' ? value.failure : value
  ) as typeof value;
  const embedded =
    typeof value?.message === 'string'
      ? value.message.match(/\[(GC-MP-\d{3})\]/)?.[1]
      : undefined;
  const code = isPlayCode(carried?.code)
    ? carried.code
    : isPlayCode(embedded)
      ? embedded
      : value?.code === 'GC-NET-001'
        ? 'GC-MP-006'
        : value?.code === 'GC-NET-002'
          ? 'GC-MP-005'
          : value?.code === 'GC-NET-004'
            ? 'GC-MP-022'
            : value?.code === 'GC-NET-003'
              ? 'GC-MP-007'
              : value?.status === 401 || value?.status === 403
                ? 'GC-MP-008'
                : value?.status === 404 || value?.status === 410
                  ? 'GC-MP-009'
                  : value?.status === 429
                    ? 'GC-MP-022'
                    : typeof value?.status === 'number' && value.status >= 500
                      ? 'GC-MP-007'
                      : fallback;
  const incident =
    typeof value?.message === 'string'
      ? value.message.match(/\[incident:([a-f0-9-]{36})\]/)?.[1]
      : undefined;
  return {
    schema: 1,
    id:
      typeof carried?.id === 'string' && /^[a-f0-9-]{36}$/.test(carried.id)
        ? carried.id
        : (incident ?? crypto.randomUUID()),
    at:
      typeof carried?.at === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(carried.at) &&
      Number.isFinite(Date.parse(carried.at))
        ? carried.at
        : new Date().toISOString(),
    code,
    ...PLAY_ERRORS[code],
    details: {
      ...playDetails(carried?.details),
      ...playDetails(value?.details),
      ...playDetails({ errorName: value?.name, httpStatus: value?.status }),
      ...playDetails(details),
    },
  };
}
