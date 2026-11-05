import { memo, type RefObject } from 'react';
import { PREVIEW_SANDBOX } from '../../preview-permissions';

/** Metadata, canvas movement and fullscreen chrome never replace the game. */
export const PreviewGameFrame = memo(function PreviewGameFrame({
  html,
  restart,
  id,
  cardRef,
  frameRef,
}: {
  html: string;
  restart: number;
  id: string;
  cardRef: RefObject<HTMLElement | null>;
  frameRef: RefObject<HTMLIFrameElement | null>;
}) {
  return (
    <iframe
      ref={frameRef}
      key={restart}
      className="nodrag nowheel"
      title="생성된 HTML 게임 미리보기"
      sandbox={PREVIEW_SANDBOX}
      onLoad={(event) =>
        event.currentTarget.contentWindow?.postMessage(
          {
            type: 'game-canvas:preview-fullscreen',
            id,
            active:
              cardRef.current?.ownerDocument.fullscreenElement ===
              cardRef.current,
          },
          '*',
        )
      }
      srcDoc={html}
    />
  );
});
