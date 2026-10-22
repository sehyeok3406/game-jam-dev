import { CanvasError } from '../../app-errors.ts';
type Ports = { fetch: typeof fetch; signal: () => AbortSignal };
export function createCollaborationTransport(ports: Ports) {
  return async (
    serverUrl: string,
    endpoint: string,
    input: unknown,
    token = '',
    key = '',
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await ports.fetch(`${serverUrl}${endpoint}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(key ? { 'X-Server-Key': key } : {}),
        },
        body: JSON.stringify(input),
        signal: ports.signal(),
      });
    } catch (error) {
      const timeout = (error as { name?: string })?.name === 'TimeoutError';
      throw new CanvasError(
        timeout ? 'GC-NET-001' : 'GC-NET-002',
        timeout
          ? '협업 서버 연결 시간이 초과되었습니다.'
          : '협업 서버에 연결할 수 없습니다.',
        { endpoint },
      );
    }
    if (response.status === 429)
      throw new CanvasError(
        'GC-NET-004',
        '협업 서버의 요청 제한에 도달했습니다.',
        {
          endpoint,
          status: 429,
        },
      );
    let value: {
      error?: string;
      code?: string;
      failure?: unknown;
      lifecycle?: import('../../contracts/project.ts').SharedProjectLifecycle;
    };
    try {
      value = (await response.json()) as typeof value;
      if (
        (!value || typeof value !== 'object') &&
        !(
          response.ok &&
          endpoint.endsWith('/history-read') &&
          (value === null || typeof value === 'string')
        )
      )
        throw new Error('Invalid response');
    } catch (error) {
      if ((error as { name?: string })?.name === 'TimeoutError')
        throw new CanvasError(
          'GC-NET-001',
          '협업 서버 응답 시간이 초과되었습니다.',
          {
            endpoint,
            status: response.status,
          },
        );
      throw new CanvasError(
        'GC-NET-003',
        `협업 서버가 올바른 응답을 반환하지 않았습니다. (HTTP ${response.status})`,
        {
          endpoint,
          status: response.status,
        },
      );
    }
    if (!response.ok)
      if (response.status >= 500)
        throw new CanvasError(
          'GC-NET-003',
          `협업 서버가 요청을 처리하지 못했습니다. (HTTP ${response.status})`,
          {
            endpoint,
            status: response.status,
          },
        );
      else
        throw Object.assign(
          new Error(value.error ?? `협업 서버 오류 (${response.status})`),
          {
            status: response.status,
            code: value.code,
            failure: value.failure,
            lifecycle: value.lifecycle,
          },
        );
    return value;
  };
}
export const collaborationTransport = createCollaborationTransport({
  fetch: (...args) => fetch(...args),
  signal: () => AbortSignal.timeout(12_000),
});
