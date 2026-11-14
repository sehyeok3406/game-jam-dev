import type {
  GameBuildProjectAsset,
  GameBuildAssetReference,
  GameBuildAssetFile,
} from '../../contracts/game-build.ts';
import { audioExtension, AUDIO_MIME } from './audio-assets.ts';
import {
  IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  isProjectImagePath,
} from './image-assets.ts';
import { mediaLocation } from './local-media.ts';
import { modelExtension } from './model-assets.ts';

export const GAME_MODEL_DIRECTORY = '.gamejam/local/game-models';
const hash = /^[a-f0-9]{64}$/;

function validFile(
  value: unknown,
  maxBytes: number,
): value is GameBuildAssetFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as GameBuildAssetFile;
  return (
    typeof file.path === 'string' &&
    typeof file.sha256 === 'string' &&
    hash.test(file.sha256) &&
    Number.isSafeInteger(file.bytes) &&
    file.bytes > 0 &&
    file.bytes <= maxBytes
  );
}

export function isGameBuildProjectAsset(
  value: unknown,
): value is GameBuildProjectAsset {
  if (!value || typeof value !== 'object') return false;
  const asset = value as GameBuildProjectAsset;
  if (asset.kind === 'image')
    return (
      validFile(asset, MAX_IMAGE_BYTES) &&
      isProjectImagePath(asset.path) &&
      asset.runtime === undefined
    );
  const media = mediaLocation(asset.path);
  if (
    !media ||
    !validFile(asset, media.maxBytes) ||
    media.digest !== asset.sha256
  )
    return false;
  if (asset.kind === 'blend')
    return (
      modelExtension(asset.path) === 'blend' &&
      validFile(asset.runtime, media.maxBytes) &&
      asset.runtime.path ===
        `${GAME_MODEL_DIRECTORY}/${asset.runtime.sha256}.glb`
    );
  return (
    asset.runtime === undefined &&
    ((asset.kind === 'audio' && media.kind === 'audio') ||
      (['glb', 'fbx', 'obj'].includes(asset.kind) &&
        modelExtension(asset.path) === asset.kind))
  );
}

export function gameBuildAssetMime(asset: GameBuildProjectAsset) {
  if (asset.kind === 'blend' || asset.kind === 'glb')
    return 'model/gltf-binary';
  if (asset.kind === 'image') return IMAGE_MIMES[asset.path.split('.').at(-1)!];
  if (asset.kind === 'audio') return AUDIO_MIME[audioExtension(asset.path)!];
  return mediaLocation(asset.path)!.mime;
}

export function isGameBuildAssetReference(
  value: unknown,
): value is GameBuildAssetReference {
  return (
    isGameBuildProjectAsset(value) &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(
      (value as GameBuildAssetReference).key ?? '',
    ) &&
    typeof (value as GameBuildAssetReference).key === 'string'
  );
}

export function gameBuildAssetReferences(
  raw: string,
): GameBuildAssetReference[] {
  const assets: unknown = JSON.parse(raw)?.assets;
  return Array.isArray(assets) ? assets.filter(isGameBuildAssetReference) : [];
}

export const isGameBuildManifestPath = (path: string) =>
  /^\.game-builds\/[a-f0-9-]{36}\/manifest\.json$/.test(path);
