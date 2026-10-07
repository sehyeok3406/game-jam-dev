import type { Snapshot } from './project-store.ts';
import {
  isPreviewPath,
  previewVersion,
  resultLocation,
  structuredPreviewPath,
  type ResultCategory,
} from './preview-output.ts';

export type ResultMove = { from: string; to: string };
export type MoveResultInput = {
  relativePath: string;
  category: ResultCategory;
  feature: string;
  revision?: number;
};
export function moveDestination(files: Snapshot, input: MoveResultInput) {
  if (
    !isPreviewPath(input.relativePath) ||
    files[input.relativePath] === undefined
  )
    throw new Error('이동할 HTML 결과를 찾을 수 없습니다.');
  const version =
    resultLocation(input.relativePath)?.version ??
    Math.max(1, previewVersion(input.relativePath));
  return structuredPreviewPath(input.category, input.feature, version);
}

export function legacyResultMoves(files: Snapshot): ResultMove[] {
  const reserved = new Set(Object.keys(files).map((key) => key.toLowerCase()));
  return Object.keys(files)
    .filter((key) => isPreviewPath(key) && !resultLocation(key))
    .sort()
    .map((from) => {
      const named =
        from.match(/^output\/games\/v\d+-(.+)\/index\.html$/u)?.[1] ??
        from.match(/^output\/versions\/v\d+-(.+)\.html$/u)?.[1];
      const imported = from.match(
        /^output\/imported\/(import-[a-f0-9-]{36})\.html$/,
      )?.[1];
      const feature = imported ?? named ?? 'legacy-game';
      let version = Math.max(1, previewVersion(from));
      let to = structuredPreviewPath('inbox', feature, version);
      while (reserved.has(to.toLowerCase()))
        to = structuredPreviewPath('inbox', feature, ++version);
      reserved.add(to.toLowerCase());
      return { from, to };
    });
}
