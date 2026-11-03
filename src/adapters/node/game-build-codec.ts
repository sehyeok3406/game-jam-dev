import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { isPreviewPath } from '../../preview-output.ts';
import { isAssetPath } from '../../file-assets.ts';
import type { GameBuildCodec } from '../../core/projects/game-build.ts';

export const gameBuildCodec: GameBuildCodec = {
  byteLength: (text) => Buffer.byteLength(text, 'utf8'),
  digest: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
  isHtmlPath: isPreviewPath,
  isAssetPath,
};
