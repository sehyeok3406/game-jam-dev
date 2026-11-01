import type { Snapshot } from '../../contracts/project.ts';
import type { PreviewResult } from '../../contracts/preview.ts';
export type PreviewNameCodec = {
  describe(files: Snapshot, path: string): PreviewResult;
  controlPath(path: string): string;
  hash(body: string): string;
  paths(files: Snapshot): string[];
  rewrite(files: Snapshot, aliases: Record<string, string>): Snapshot;
};
