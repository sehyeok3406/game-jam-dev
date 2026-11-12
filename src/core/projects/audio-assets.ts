import type { AudioAsset } from '../../contracts/documents.ts';

export const AUDIO_DIRECTORY = 'assets/audio';
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_BATCH_BYTES = 256 * 1024 * 1024;
export const AUDIO_MIME = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export function audioExtension(
  name: string,
): keyof typeof AUDIO_MIME | undefined {
  const match = /\.(mp3|wav|ogg)$/i.exec(name);
  return match?.[1].toLowerCase() as keyof typeof AUDIO_MIME | undefined;
}

export function audioDigest(path: unknown) {
  return typeof path === 'string'
    ? /^assets\/audio\/([a-f0-9]{64})\.(?:mp3|wav|ogg)$/.exec(path)?.[1]
    : undefined;
}

export function audioAsset(value: unknown): AudioAsset | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const asset = value as AudioAsset;
  return audioDigest(asset.path) &&
    typeof asset.originalName === 'string' &&
    audioExtension(asset.originalName) === audioExtension(asset.path) &&
    Number.isSafeInteger(asset.bytes) &&
    asset.bytes > 0 &&
    asset.bytes <= MAX_AUDIO_BYTES
    ? { path: asset.path, originalName: asset.originalName, bytes: asset.bytes }
    : undefined;
}
