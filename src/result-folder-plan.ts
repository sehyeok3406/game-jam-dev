import type { MoveResultInput } from './contracts/results.ts';
export type { MoveResultInput } from './contracts/results.ts';
import type { ResultMove } from './contracts/results.ts';
export type { ResultMove } from './contracts/results.ts';
import type { Snapshot } from './project-store.ts';
import { readFileNames } from './core/documents/name-registry.ts';
import {
  isPreviewPath,
  previewVersion,
  resultLocation,
  structuredPreviewPath,
  managedPreviewPaths,
} from './preview-output.ts';
export function moveDestination(files: Snapshot, input: MoveResultInput) {
  if (
    !isPreviewPath(input.relativePath) ||
    files[input.relativePath] === undefined
  )
    throw new Error('이동할 HTML 결과를 찾을 수 없습니다.');
  const version =
    resultLocation(input.relativePath)?.version ??
    Math.max(
      1,
      previewVersion(
        readFileNames(files).entries.find((e) => e.path === input.relativePath)
          ?.originalPath ?? input.relativePath,
      ),
    );
  return structuredPreviewPath(input.category, input.feature, version).replace(
    /index\.html$/,
    input.relativePath.split('/').at(-1)!,
  );
}
export function legacyResultMoves(files: Snapshot): ResultMove[] {
  const reserved = new Set(Object.keys(files).map((key) => key.toLowerCase()));
  return managedPreviewPaths(files)
    .filter((key) => !resultLocation(key))
    .sort()
    .map((from) => {
      const entry = readFileNames(files).entries.find(
        (e) => e.kind === 'html' && e.path === from,
      );
      const named =
        from.match(/^output\/games\/v\d+-(.+)\/index\.html$/u)?.[1] ??
        from.match(/^output\/versions\/v\d+-(.+)\.html$/u)?.[1];
      const imported = from.match(
        /^output\/imported\/(import-[a-f0-9-]{36})\.html$/,
      )?.[1];
      const feature = imported ?? named ?? 'legacy-game';
      let version = Math.max(1, previewVersion(entry?.originalPath ?? from));
      const destination = () =>
        structuredPreviewPath('inbox', feature, version).replace(
          /index\.html$/,
          entry ? from.split('/').at(-1)! : 'index.html',
        );
      let to = destination();
      while (reserved.has(to.toLowerCase())) {
        version++;
        to = destination();
      }
      reserved.add(to.toLowerCase());
      return { from, to };
    });
}
