import type {
  GameBuildProjectAsset,
  GameBuildAssetReference,
} from '../../contracts/game-build.ts';
import {
  MAX_MODEL_BYTES,
  modelDigest,
  modelExtension,
} from './model-assets.ts';

export function isGameBuildProjectAsset(
  value: unknown,
): value is GameBuildProjectAsset {
  if (!value || typeof value !== 'object') return false;
  const asset = value as GameBuildProjectAsset;
  return (
    asset.kind === 'glb' &&
    typeof asset.path === 'string' &&
    modelExtension(asset.path) === 'glb' &&
    typeof asset.sha256 === 'string' &&
    modelDigest(asset.path) === asset.sha256 &&
    Number.isSafeInteger(asset.bytes) &&
    asset.bytes > 0 &&
    asset.bytes <= MAX_MODEL_BYTES
  );
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
