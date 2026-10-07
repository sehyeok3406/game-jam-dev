import { resultFileStem } from './result-name.ts';
export const DEFAULT_PREVIEW_PATH = 'output/index.html';
const VERSION_PATH =
  /^output\/versions\/v([1-9]\d*)(?:-([\p{L}\p{M}\p{N}_-]+))?\.html$/u;
const IMPORT_PATH = /^output\/imported\/import-[a-f0-9-]{36}\.html$/;
const RESULT_PATH =
  /^output\/games\/v([1-9]\d*)(?:-([\p{L}\p{M}\p{N}_-]+))?\/index\.html$/u;
const resultMatch = (relative: string) =>
  relative.match(RESULT_PATH) ?? relative.match(VERSION_PATH);
export function isResultFolderPath(relative: string) {
  return (
    RESULT_PATH.test(relative) &&
    Number.isSafeInteger(Number(relative.match(RESULT_PATH)![1]))
  );
}
export function isImportedPreviewPath(relative: string) {
  return IMPORT_PATH.test(relative);
}

/** Dedicated result folders belong to one HTML result; legacy parents are shared. */
export function previewDeletionTarget(relative: string) {
  assertPreviewPath(relative);
  return isResultFolderPath(relative)
    ? relative.slice(0, relative.lastIndexOf('/'))
    : relative;
}

export function isPreviewPath(relative: string): boolean {
  return (
    relative === DEFAULT_PREVIEW_PATH ||
    isResultFolderPath(relative) ||
    isImportedPreviewPath(relative) ||
    (VERSION_PATH.test(relative) &&
      Number.isSafeInteger(Number(relative.match(VERSION_PATH)![1])))
  );
}

export function assertPreviewPath(relative: string) {
  if (typeof relative !== 'string' || !isPreviewPath(relative))
    throw new Error('올바르지 않은 HTML 결과 경로입니다.');
  return relative;
}

export function previewVersion(relative: string) {
  assertPreviewPath(relative);
  if (isImportedPreviewPath(relative)) return 0;
  return relative === DEFAULT_PREVIEW_PATH
    ? 1
    : Number(resultMatch(relative)![1]);
}

export function previewLabel(relative: string) {
  if (isImportedPreviewPath(relative)) return '불러온 HTML';
  const name = resultMatch(relative)?.[2];
  return `${name ? `${name} · ` : ''}버전 ${previewVersion(relative)}`;
}

export function nextPreviewPath(reservedPaths: string[], name?: string) {
  const highest = Math.max(
    0,
    ...reservedPaths.filter(isPreviewPath).map(previewVersion),
  );
  const stem = resultFileStem(name);
  return `output/games/v${highest + 1}${stem ? `-${stem}` : ''}/index.html`;
}

/** Only existing results can be updated; pending tasks reserve new folders. */
export function resolvePreviewOutput(
  existingPaths: string[],
  reservedPaths: string[],
  choice: import('./shared').HtmlResultChoice = { mode: 'update' },
  name?: string,
) {
  const existing = existingPaths.filter(
    (relative) => isPreviewPath(relative) && !isImportedPreviewPath(relative),
  );
  const base =
    choice.basePath ??
    (choice.mode === 'update'
      ? existing.includes(DEFAULT_PREVIEW_PATH)
        ? DEFAULT_PREVIEW_PATH
        : existing.sort((a, b) => previewVersion(a) - previewVersion(b)).at(-1)
      : undefined);
  return {
    path:
      choice.mode === 'new' || !base
        ? nextPreviewPath(reservedPaths, name)
        : base,
    choice: { mode: choice.mode, ...(base ? { basePath: base } : {}) },
  };
}

export function previewWindowPath(relative = DEFAULT_PREVIEW_PATH) {
  assertPreviewPath(relative);
  if (isResultFolderPath(relative))
    return `.canvas/previews/game-${relative.split('/')[2]}.json`;
  return relative === DEFAULT_PREVIEW_PATH
    ? '.canvas/preview.json'
    : `.canvas/previews/${relative
        .split('/')
        .at(-1)!
        .replace(/\.html$/, '.json')}`;
}
