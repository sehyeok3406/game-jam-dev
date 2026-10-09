import { CanvasError } from './app-errors.ts';

type PresentableWindow = {
  show: () => void;
  setSkipTaskbar: (skip: boolean) => void;
  isVisible: () => boolean;
  isDestroyed: () => boolean;
};

/** Loading/connecting is not sufficient: the user must have a visible window. */
export async function presentWindow(
  window: PresentableWindow,
  load: () => Promise<unknown>,
) {
  try {
    await load();
    if (window.isDestroyed()) throw new Error('화면 준비 중 창이 닫혔습니다.');
    window.setSkipTaskbar(false);
    window.show();
    // Windows can deliver the show event before native visibility is updated.
    for (
      let attempt = 0;
      attempt < 20 && !window.isDestroyed() && !window.isVisible();
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (window.isDestroyed() || !window.isVisible())
      throw new Error(
        '앱 프로세스는 시작했지만 창이 화면에 표시되지 않았습니다.',
      );
  } catch (error) {
    throw new CanvasError(
      'GC-TEST-002',
      `창 표시 실패: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
