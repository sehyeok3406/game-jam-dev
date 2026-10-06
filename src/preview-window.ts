import type { PreviewWindowState } from './shared';

// Border + header (38px); presets describe the iframe,
// not the outer window, so browser media queries use the advertised resolution.
export const PREVIEW_CHROME = { width: 2, height: 40 };

// Sandboxed frames have an opaque origin: relay only Escape, never app APIs.
// This is a preview-only addition; the generated HTML file stays unchanged.
export function withPreviewKeyboardBridge(html: string, id: string) {
  const bridgeId = JSON.stringify(id).replaceAll('<', '\\u003c');
  return `${html}\n<script data-game-canvas-preview-controls>window.addEventListener('keydown',function(event){if(event.key==='Escape')window.parent.postMessage({type:'game-canvas:preview-escape',id:${bridgeId}},'*');},true);window.addEventListener('message',function(event){if(event.source===window.parent&&event.data&&event.data.type==='game-canvas:preview-fullscreen'&&event.data.id===${bridgeId}&&event.data.active===false&&document.pointerLockElement){document.exitPointerLock();}});</script>`;
}

export function fitPreviewViewport(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
) {
  return Math.min(
    Math.max(1, availableWidth) / width,
    Math.max(1, availableHeight) / height,
  );
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
export function viewportRatio(width: number, height: number) {
  // Keep familiar display names (16:10, 21:9) rather than reducing to 8:5, 7:3.
  const common = [
    '1:1',
    '16:9',
    '16:10',
    '4:3',
    '3:2',
    '21:9',
    '32:9',
    '9:16',
    '10:16',
    '3:4',
    '2:3',
  ];
  const name = common.find((ratio) => {
    const [w, h] = ratio.split(':').map(Number);
    return width * h === height * w;
  });
  if (name) return name;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}
export const PREVIEW_PRESETS = [
  { id: 'mobile-320', device: '모바일', width: 320, height: 568 },
  {
    id: 'mobile-360',
    device: '모바일',
    width: 360,
    height: 640,
    ratio: '9:16',
  },
  { id: 'mobile-360-tall', device: '모바일', width: 360, height: 800 },
  { id: 'mobile-375', device: '모바일', width: 375, height: 667 },
  { id: 'mobile-375-tall', device: '모바일', width: 375, height: 812 },
  { id: 'mobile-390', device: '모바일', width: 390, height: 844 },
  { id: 'mobile-393', device: '모바일', width: 393, height: 852 },
  { id: 'mobile-412', device: '모바일', width: 412, height: 915 },
  { id: 'mobile-430', device: '모바일', width: 430, height: 932 },
  {
    id: 'mobile-720',
    device: '모바일',
    width: 720,
    height: 1280,
    ratio: '9:16',
  },
  { id: 'mobile-1080', device: '모바일', width: 1080, height: 1920 },
  {
    id: 'mobile-landscape-640',
    device: '모바일 가로',
    width: 640,
    height: 360,
  },
  {
    id: 'mobile-landscape-844',
    device: '모바일 가로',
    width: 844,
    height: 390,
  },
  {
    id: 'mobile-landscape-932',
    device: '모바일 가로',
    width: 932,
    height: 430,
  },
  { id: 'tablet-768', device: '태블릿', width: 768, height: 1024 },
  { id: 'tablet-820', device: '태블릿', width: 820, height: 1180 },
  { id: 'tablet-1024', device: '태블릿', width: 1024, height: 1366 },
  {
    id: 'tablet-landscape-1180',
    device: '태블릿 가로',
    width: 1180,
    height: 820,
  },
  {
    id: 'tablet-landscape-1366',
    device: '태블릿 가로',
    width: 1366,
    height: 1024,
  },
  { id: 'pc-720', device: 'PC', width: 1280, height: 720, ratio: '16:9' },
  { id: 'pc-1366', device: 'PC', width: 1366, height: 768 },
  { id: 'pc-1080', device: 'PC', width: 1920, height: 1080, ratio: '16:9' },
  { id: 'pc-1440p', device: 'PC', width: 2560, height: 1440 },
  { id: 'pc-4k', device: 'PC', width: 3840, height: 2160 },
  { id: 'pc-768', device: 'PC', width: 1024, height: 768, ratio: '4:3' },
  { id: 'pc-1440', device: 'PC', width: 1440, height: 1080, ratio: '4:3' },
  { id: 'pc-1080-720', device: 'PC', width: 1080, height: 720, ratio: '3:2' },
  { id: 'pc-900', device: 'PC', width: 1440, height: 900 },
  { id: 'pc-1200', device: 'PC', width: 1920, height: 1200 },
  { id: 'square-720', device: '정사각형', width: 720, height: 720 },
  { id: 'square-1080', device: '정사각형', width: 1080, height: 1080 },
  { id: 'wide-21-9', device: '울트라와이드', width: 2520, height: 1080 },
  { id: 'wide-3440', device: '울트라와이드', width: 3440, height: 1440 },
  { id: 'wide-32-9', device: '울트라와이드', width: 5120, height: 1440 },
].map((preset) => ({
  ...preset,
  ratio: viewportRatio(preset.width, preset.height),
}));

export function previewPreset(state: PreviewWindowState) {
  return PREVIEW_PRESETS.find((preset) => preset.id === state.presetId);
}

function freeSize(size: { width: number; height: number }) {
  return {
    width: Number.isFinite(size.width) ? Math.max(420, size.width) : 720,
    height: Number.isFinite(size.height) ? Math.max(300, size.height) : 520,
  };
}

export function normalizePreviewWindow(
  state: PreviewWindowState,
): PreviewWindowState {
  const preset = previewPreset(state);
  return {
    ...state,
    ...(preset
      ? {
          width: preset.width + PREVIEW_CHROME.width,
          height: preset.height + PREVIEW_CHROME.height,
        }
      : freeSize(state)),
    ...(state.presetId !== undefined ? { presetId: preset?.id ?? 'free' } : {}),
    ...(state.freeSize ? { freeSize: freeSize(state.freeSize) } : {}),
  };
}

export function selectPreviewPreset(
  state: PreviewWindowState,
  presetId: string,
) {
  const previous = normalizePreviewWindow(state);
  const savedFreeSize = previewPreset(previous)
    ? (previous.freeSize ?? { width: 720, height: 520 })
    : freeSize(previous);
  return normalizePreviewWindow({
    ...previous,
    ...(presetId === 'free' ? savedFreeSize : {}),
    presetId,
    freeSize: savedFreeSize,
  });
}

export function previewViewport(state: PreviewWindowState) {
  const normalized = normalizePreviewWindow(state);
  const width = Math.round(normalized.width - PREVIEW_CHROME.width);
  const height = Math.round(normalized.height - PREVIEW_CHROME.height);
  return { width, height, ratio: viewportRatio(width, height) };
}
