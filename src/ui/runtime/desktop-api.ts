import type { AppApi, DesktopApi } from '../../contracts/app-api.ts';

/** Unsupported actions fail explicitly; adapters never pretend to complete them. */
export function requireDesktopApi(api: AppApi): DesktopApi {
  if (!api.desktop) {
    throw Object.assign(
      new Error('이 실행 환경에서는 PC 전용 기능을 사용할 수 없습니다.'),
      {
        code: 'GC-RUNTIME-UNSUPPORTED',
      },
    );
  }
  return api.desktop;
}
