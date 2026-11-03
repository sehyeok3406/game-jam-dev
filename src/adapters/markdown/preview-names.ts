import type { PreviewNameCodec } from '../../application/ports/preview-names.ts';
import {
  describePreview,
  htmlHash,
  htmlSourcePath,
} from '../../html-source.ts';
import { managedPreviewPaths } from '../../preview-output.ts';
import { rewritePreviewLinks } from './html-name-links.ts';

/** Edit only parsed URL attributes. Script expressions are never rewritten or executed. */
export const previewNameCodec: PreviewNameCodec = {
  describe: describePreview,
  controlPath: htmlSourcePath,
  hash: htmlHash,
  paths: managedPreviewPaths,
  rewrite: rewritePreviewLinks,
};
