import { CanvasError } from '../../app-errors.ts';

/** Negotiate before submitting a new layout to an older server. No creation side effects. */
export async function requireProjectLayoutSupport(serverUrl: string) {
  let response: Response;
  try {
    response = await fetch(new URL('/health', serverUrl), {
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new CanvasError('GC-NET-002', '협업 서버에 연결할 수 없습니다.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.projectLayoutVersion !== 2)
    throw Error(
      '새 파일 구조를 지원하는 협업 서버로 업데이트해주세요. 프로젝트는 생성하지 않았습니다.',
    );
}
