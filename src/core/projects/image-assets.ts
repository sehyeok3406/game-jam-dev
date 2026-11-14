import type { ImageAsset } from '../../contracts/documents.ts';

export const MAX_IMAGE_BYTES = 5_000_000;
export const IMAGE_MIMES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as Record<string, string>;

export function isProjectImagePath(
  value: unknown,
): value is `assets/images/${string}` {
  return (
    typeof value === 'string' &&
    /^assets\/images\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif)$/.test(value)
  );
}

export function imageAsset(value: unknown): ImageAsset | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const asset = value as ImageAsset;
  return isProjectImagePath(asset.path) &&
    ['asset', 'diagram'].includes(asset.purpose) &&
    typeof asset.originalName === 'string' &&
    typeof asset.mime === 'string' &&
    Number.isFinite(asset.bytes)
    ? asset
    : undefined;
}
