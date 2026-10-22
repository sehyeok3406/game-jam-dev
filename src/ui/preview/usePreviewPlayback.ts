import { useState, useRef, useId, useMemo, useEffect } from 'react';
import { useRuntime } from '../runtime/RuntimeProvider';
import type { PreviewWindowState } from '../../contracts/preview';
import {
  previewPreset,
  previewViewport,
  withPreviewKeyboardBridge,
} from '../../preview-window';
import { withMultiplayerSdk } from '../../multiplayer/sdk';

/** Stable iframe identity: entering fullscreen never remounts the running game. */
export function usePreviewPlayback(
  content: string,
  path: string,
  state: PreviewWindowState,
) {
  const { api, capabilities } = useRuntime();

  const [restart, setRestart] = useState(0);
  const cardRef = useRef<HTMLElement>(null);
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
  useEffect(() => {
    if (!capabilities.multiplayer) return;
    const report = (event: MessageEvent) => {
      if (
        event.source !==
          cardRef.current?.querySelector('iframe')?.contentWindow ||
        event.data?.id !== settingsId ||
        event.data?.type !== 'gamejam:diagnostic'
      )
        return;
      void api.preview.multiplayer
        ?.reportPreview?.({
          path: path,
          diagnostic: event.data.diagnostic,
        })
        .catch(() => {});
    };
    window.addEventListener('message', report);
    return () => window.removeEventListener('message', report);
  }, [settingsId, path, capabilities.multiplayer]);
  useEffect(() => {
    const update = () => {
      const active = document.fullscreenElement === cardRef.current;
      cardRef.current
        ?.querySelector('iframe')
        ?.contentWindow?.postMessage(
          { type: 'game-canvas:preview-fullscreen', id: settingsId, active },
          '*',
        );
      setFullscreen(active);
    };
    document.addEventListener('fullscreenchange', update);
    const exit = () => {
      if (document.fullscreenElement === cardRef.current)
        void document.exitFullscreen().catch(() => {});
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exit();
    };
    const frameEscape = (event: MessageEvent) => {
      if (
        event.source ===
          cardRef.current?.querySelector('iframe')?.contentWindow &&
        event.data?.type === 'game-canvas:preview-escape' &&
        event.data?.id === settingsId
      )
        exit();
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('message', frameEscape);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('message', frameEscape);
    };
  }, [settingsId]);
  useEffect(() => {
    if (fullscreen) cardRef.current?.querySelector('iframe')?.focus();
  }, [fullscreen]);
  useEffect(() => {
    const area = playAreaRef.current;
    if (!area) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = area.clientWidth,
          height = area.clientHeight;
        setPlayAreaSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height },
        );
      });
    });
    observer.observe(area);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
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
