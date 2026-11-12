export type CompactSize = { width: number; height: number };

export type FileNodeStyle = CompactSize & {
  titleHeight: number;
  radius: number;
  markdownTitle: string;
  markdownBody: string;
  htmlTitle: string;
  markdownTitleSize?: number;
  markdownBodySize?: number;
  htmlTitleSize?: number;
};

export const DEFAULT_FILE_NODE_STYLE: FileNodeStyle = {
  width: 340,
  height: 112,
  titleHeight: 38,
  radius: 12,
  markdownTitle: '',
  markdownBody: '',
  htmlTitle: '',
};

export const MIN_COMPACT_WIDTH = 180;
export const MIN_COMPACT_HEIGHT = 88;
export const MIN_NODE_BODY = 50;
export const MIN_NODE_FONT_SIZE = 10;
export const MAX_NODE_FONT_SIZE = 32;

function dimension(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function compactSize(value: Partial<CompactSize> = {}): CompactSize {
  return {
    width: dimension(value.width, 340, MIN_COMPACT_WIDTH, 1200),
    height: dimension(value.height, 112, MIN_COMPACT_HEIGHT, 600),
  };
}

export function readNodePlacement(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const size = value as Partial<CompactSize>;
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height))
    return undefined;
  return compactSize(size);
}

function color(value: unknown) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : '';
}

function fontSize(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? dimension(value, 13, MIN_NODE_FONT_SIZE, MAX_NODE_FONT_SIZE)
    : undefined;
}

export function fileNodeStyle(
  value: Partial<FileNodeStyle> = {},
): FileNodeStyle {
  const size = compactSize(value);
  return {
    ...size,
    titleHeight: dimension(
      value.titleHeight,
      38,
      38,
      size.height - MIN_NODE_BODY,
    ),
    radius: dimension(value.radius, 12, 0, 48),
    markdownTitle: color(value.markdownTitle),
    markdownBody: color(value.markdownBody),
    htmlTitle: color(value.htmlTitle),
    markdownTitleSize: fontSize(value.markdownTitleSize),
    markdownBodySize: fontSize(value.markdownBodySize),
    htmlTitleSize: fontSize(value.htmlTitleSize),
  };
}

export function titleHeightFor(height: number, titleHeight: number) {
  return Math.max(38, Math.min(titleHeight, height - MIN_NODE_BODY));
}

export function readableOn(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 >
    0.179
    ? '#000000'
    : '#ffffff';
}
