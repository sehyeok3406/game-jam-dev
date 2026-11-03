import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, replyError } from './errors.ts';
import { createRequestAdmission } from './request.ts';

export type HttpRoute = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => boolean | Promise<boolean>;

/** Routes claim a request explicitly; no body is consumed before dispatch. */
export function createHttpHandler(
  routes: readonly HttpRoute[],
  fallback: (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) => Promise<void>,
  options: {
    accepting?: () => boolean;
    observe?: (request: IncomingMessage, response: ServerResponse) => void;
    requestBudget?: { bytes?: number; concurrent?: number };
  } = {},
) {
  const admit = createRequestAdmission(options.requestBudget);
  return async (request: IncomingMessage, response: ServerResponse) => {
    let release: (() => void) | undefined;
    let workDone = false,
      responseDone = false,
      released = false;
    const finish = () => {
      if (!workDone || !responseDone || released) return;
      released = true;
      release?.();
      response.removeListener('finish', responseFinished);
      response.removeListener('close', responseFinished);
    };
    const responseFinished = () => {
      responseDone = true;
      finish();
    };
    try {
      release = admit(request);
      response.once('finish', responseFinished);
      response.once('close', responseFinished);
      options.observe?.(request, response);
      // Desktop transport only, including form POSTs. Proxy headers confer no trust.
      if (request.headers.origin)
        throw new ApiError('초기 서버는 데스크톱 앱 연결만 지원합니다.', 403);
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (
        options.accepting &&
        !options.accepting() &&
        !['/health', '/ready'].includes(url.pathname)
      ) {
        const error = new ApiError(
          '서버가 종료 중입니다. 같은 작업으로 다시 연결해주세요.',
          503,
        );
        error.code = 'SERVER_MAINTENANCE';
        throw error;
      }
      for (const route of routes)
        if (await route(request, response, url)) return;
      await fallback(request, response, url);
    } catch (error) {
      replyError(response, error);
    } finally {
      workDone = true;
      responseDone ||= response.writableFinished || response.destroyed;
      finish();
    }
  };
}
