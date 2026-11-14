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
import { bindGameAssets } from '../../core/projects/game-asset-bootstrap.ts';
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
  assetBuildId?: string,
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
  const collapsed = state.collapsed && !fullscreen;
  const [bound, setBound] = useState<{
    path: string;
    buildId: string;
    restart: number;
    source: string;
    html?: string;
    error?: string;
  }>();
  useEffect(() => {
    if (collapsed || !assetBuildId) return;
    let active = true;
    const load = async () => {
      try {
        if (!api.preview.readGameAssetUrls)
          throw Error('Game Jam! PC 앱에서 프로젝트 에셋을 열어주세요.');
        const urls = await api.preview.readGameAssetUrls(path, assetBuildId);
        if (active)
          setBound({
            path,
            buildId: assetBuildId,
            restart,
            source: content,
            html: bindGameAssets(content, urls),
          });
      } catch (error) {
        if (active)
          setBound({
            path,
            buildId: assetBuildId,
            restart,
            source: content,
            error: error instanceof Error ? error.message : String(error),
          });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [api, assetBuildId, content, path, restart, collapsed]);
  const binding =
    bound &&
    bound.path === path &&
    bound.buildId === assetBuildId &&
    bound.source === content &&
    bound.restart === restart
      ? bound
      : undefined;
  const playable = assetBuildId ? binding?.html : content;
  const previewHtml = useMemo(
    () =>
      playable === undefined
        ? undefined
        : withPreviewKeyboardBridge(
            withMultiplayerSdk(playable, 'solo', settingsId),
            settingsId,
          ),
    [playable, settingsId],
  );
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
  }, [settingsId, restart, path, api, capabilities.multiplayer, previewHtml]);
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
    assetError: binding?.error,
    collapsed,
    toggleFullscreen,
  };
}
