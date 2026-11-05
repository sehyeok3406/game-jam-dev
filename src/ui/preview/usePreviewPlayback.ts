import {
  useState,
  useRef,
  useId,
  useMemo,
  useEffect,
  useLayoutEffect,
} from 'react';
import { useRuntime } from '../runtime/RuntimeProvider';
import type { PreviewWindowState } from '../../contracts/preview';
import {
  previewPreset,
  previewViewport,
  withPreviewKeyboardBridge,
} from '../../preview-window';
import { withMultiplayerSdk } from '../../multiplayer/sdk';
import { previewPlaybackEvents } from './playback-events';

/** Stable iframe identity: entering fullscreen never remounts the running game. */
export function usePreviewPlayback(
  content: string,
  path: string,
  state: PreviewWindowState,
) {
  const { api, capabilities } = useRuntime();

  const [restart, setRestart] = useState(0);
  const cardRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const playAreaRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsId = useId();
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [playAreaSize, setPlayAreaSize] = useState({ width: 1, height: 1 });
  const [settingsPosition, setSettingsPosition] = useState({ left: 0, top: 0 });
  const preset = previewPreset(state);
  const viewport = previewViewport(state);
  const previewHtml = useMemo(
    () =>
      withPreviewKeyboardBridge(
        withMultiplayerSdk(content, 'solo', settingsId),
        settingsId,
      ),
    [content, settingsId],
  );
  const collapsed = state.collapsed && !fullscreen;
  useLayoutEffect(() => {
    const card = cardRef.current,
      frame = frameRef.current;
    if (!card || !frame) return;
    return previewPlaybackEvents(card.ownerDocument).register({
      id: settingsId,
      card,
      frame,
      fullscreen: setFullscreen,
      diagnostic: capabilities.multiplayer
        ? (diagnostic) => {
            void api.preview.multiplayer
              ?.reportPreview?.({ path, diagnostic })
              .catch(() => {});
          }
        : undefined,
    });
  }, [settingsId, restart, path, api, capabilities.multiplayer]);
  useEffect(() => {
    if (fullscreen) frameRef.current?.focus();
  }, [fullscreen]);
  const fitFullscreen = fullscreen && !!preset;
  useLayoutEffect(() => {
    if (!fitFullscreen) return;
    const area = playAreaRef.current;
    if (!area) return;
    let frame = 0;
    const measure = () => {
      const width = area.clientWidth,
        height = area.clientHeight;
      setPlayAreaSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    // Measure before paint when entering fixed-resolution fullscreen. Ordinary
    // cards use CSS sizing and do not need a React update or an observer.
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(area);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fitFullscreen]);
  const toggleFullscreen = async () => {
    if (settingsRef.current?.matches(':popover-open'))
      settingsRef.current.hidePopover();
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === cardRef.current)
        await document.exitFullscreen();
      else await cardRef.current?.requestFullscreen();
    } catch {
      setFullscreenError(
        '전체화면을 시작할 수 없습니다. 창이 활성화된 상태에서 다시 눌러주세요.',
      );
    }
  };

  return {
    restart,
    setRestart,
    cardRef,
    frameRef,
    playAreaRef,
    settingsRef,
    settingsId,
    fullscreen,
    fullscreenError,
    playAreaSize,
    settingsPosition,
    setSettingsPosition,
    preset,
    viewport,
    previewHtml,
    collapsed,
    toggleFullscreen,
  };
}
