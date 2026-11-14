import type { ModelAsset } from '../../contracts/documents.ts';
import { objResources } from './obj-resources.ts';

export const MODEL_DIRECTORY = 'assets/models';
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;
export const MAX_LOCAL_MEDIA_BATCH_BYTES = 256 * 1024 * 1024;
export const MODEL_MIME = {
  glb: 'model/gltf-binary',
  fbx: 'application/octet-stream',
  obj: 'text/plain; charset=utf-8',
  blend: 'application/octet-stream',
};

export function modelExtension(
  name: string,
): keyof typeof MODEL_MIME | undefined {
  const match = /\.(glb|fbx|obj|blend)$/i.exec(name);
  return match?.[1].toLowerCase() as keyof typeof MODEL_MIME | undefined;
}

export function modelDigest(path: unknown) {
  return typeof path === 'string'
    ? /^assets\/models\/([a-f0-9]{64})\.(?:glb|fbx|obj|blend)$/.exec(path)?.[1]
    : undefined;
}

export function modelSizeLimit(extension: string) {
  return extension === 'blend' ? MAX_LOCAL_MEDIA_BATCH_BYTES : MAX_MODEL_BYTES;
}

export function modelAsset(value: unknown): ModelAsset | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const asset = value as ModelAsset;
  const extension =
    typeof asset.originalName === 'string' &&
    modelExtension(asset.originalName);
  const resources = objResources(asset.resources);
  return modelDigest(asset.path) &&
    extension &&
    extension === modelExtension(asset.path) &&
    Number.isSafeInteger(asset.bytes) &&
    asset.bytes > 0 &&
    asset.bytes <= modelSizeLimit(extension) &&
    (asset.resources === undefined || (extension === 'obj' && resources))
    ? {
        path: asset.path,
        originalName: asset.originalName,
        bytes: asset.bytes,
        ...(resources ? { resources } : {}),
      }
    : undefined;
}
