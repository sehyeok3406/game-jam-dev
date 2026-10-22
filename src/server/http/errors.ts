import type { ServerResponse } from 'node:http';
import { errorText, failureInfo } from '../../app-errors.ts';
import { reply } from './response.ts';
import { ApiError } from '../services/errors.ts';
export { ApiError } from '../services/errors.ts';

export function replyError(response: ServerResponse, error: unknown) {
  if ((error as ApiError)?.code === 'SERVER_MAINTENANCE')
    response.setHeader('Retry-After', '2');
  const failure = failureInfo(error, 'GC-COLLAB-001');
  reply(response, error instanceof ApiError ? error.status : 400, {
    error: errorText(failure),
    failure,
    code: (error as ApiError).code,
    lifecycle: (error as ApiError).lifecycle,
  });
}
