import type { CanvasDocument } from '../../contracts/documents.ts';
import {
  AUDIO_MIME,
  MAX_AUDIO_BYTES,
  audioDigest,
  audioExtension,
} from './audio-assets.ts';
import {
  MODEL_MIME,
  modelDigest,
  modelExtension,
  modelSizeLimit,
} from './model-assets.ts';

export function localMediaExtension(name: string) {
  return audioExtension(name) ?? modelExtension(name);
}

export function mediaLocation(path: unknown) {
  if (typeof path !== 'string') return;
  const audio = audioDigest(path);
  const audioFormat = audioExtension(path);
  if (audio && audioFormat)
    return {
      digest: audio,
      mime: AUDIO_MIME[audioFormat],
      maxBytes: MAX_AUDIO_BYTES,
      kind: 'audio' as const,
    };
  const model = modelDigest(path);
  const modelFormat = modelExtension(path);
  if (model && modelFormat)
    return {
      digest: model,
      mime: MODEL_MIME[modelFormat],
      maxBytes: modelSizeLimit(modelFormat),
      kind: 'model' as const,
    };
}

export function localMedia(document: Pick<CanvasDocument, 'audio' | 'model'>) {
  return document.audio ?? document.model;
}
