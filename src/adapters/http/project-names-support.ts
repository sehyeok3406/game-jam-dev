import { CanvasError } from '../../app-errors.ts';

export async function requireProjectNamesSupport(serverUrl: string) {
  let response: Response;
  try {
    response = await fetch(new URL('/health', serverUrl), {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CanvasError('GC-NET-002', '협업 서버에 연결할 수 없습니다.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.projectNamesVersion !== 1)
    throw Error(
      '이름 중복 검사와 참여 사전 확인을 지원하는 협업 서버로 업데이트해주세요.',
    );
}
