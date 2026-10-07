import { resultFileStem } from './result-name.ts';
export const RESULT_CATEGORIES = {
  systems: '시스템',
  'ui-ux': 'UI·UX',
  content: '콘텐츠',
  prototypes: '통합 시제품',
  inbox: '미분류',
} as const;
export type ResultCategory = keyof typeof RESULT_CATEGORIES;
const STRUCTURED_PATH =
  /^output\/(systems|ui-ux|content|prototypes|inbox)\/([\p{L}\p{M}\p{N}_-]+)\/v(\d{3,})\/index\.html$/u;
export function resultLocation(relative: string) {
  const match = relative.match(STRUCTURED_PATH);
  if (
    !match ||
    !Number.isSafeInteger(Number(match[3])) ||
    Number(match[3]) < 1 ||
    match[3] !== String(Number(match[3])).padStart(3, '0')
  )
    return undefined;
  try {
    if (resultFileStem(match[2]) !== match[2]) return undefined;
  } catch {
    return undefined;
  }
  return {
    category: match[1] as ResultCategory,
    feature: match[2],
    version: Number(match[3]),
  };
}
export function structuredPreviewPath(
  category: ResultCategory,
  feature: string,
  version: number,
) {
  if (
    !Object.hasOwn(RESULT_CATEGORIES, category) ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new Error('결과물 분류·버전이 올바르지 않습니다.');
  const stem = resultFileStem(feature);
  if (!stem) throw new Error('기능 이름을 입력해주세요.');
  return `output/${category}/${stem}/v${String(version).padStart(3, '0')}/index.html`;
}
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
    !!resultLocation(relative) ||
    (RESULT_PATH.test(relative) &&
      Number.isSafeInteger(Number(relative.match(RESULT_PATH)![1])))
  );
}
export function isImportedPreviewPath(relative: string) {
  return (
    IMPORT_PATH.test(relative) ||
    /^import-[a-f0-9-]{36}$/.test(resultLocation(relative)?.feature ?? '')
  );
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
  const location = resultLocation(relative);
  if (location) return location.version;
  return relative === DEFAULT_PREVIEW_PATH
    ? 1
    : Number(resultMatch(relative)![1]);
}

export function previewLabel(relative: string) {
  const location = resultLocation(relative);
  if (location)
    return `${RESULT_CATEGORIES[location.category]} / ${location.feature} · 버전 ${location.version}`;
  if (isImportedPreviewPath(relative)) return '불러온 HTML';
  const name = resultMatch(relative)?.[2];
  return `${name ? `${name} · ` : ''}버전 ${previewVersion(relative)}`;
}

export function nextPreviewPath(
  reservedPaths: string[],
  name?: string,
  basePath?: string,
) {
  const base = basePath ? resultLocation(basePath) : undefined;
  const category = base?.category ?? 'inbox';
  const feature = resultFileStem(name) || base?.feature || 'untitled';
  const highest = Math.max(
    0,
    ...reservedPaths.flatMap((relative) => {
      const location = resultLocation(relative);
      return location?.category === category && location.feature === feature
        ? [location.version]
        : [];
    }),
  );
  return structuredPreviewPath(category, feature, highest + 1);
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
        ? nextPreviewPath(reservedPaths, name, base)
        : base,
    choice: { mode: choice.mode, ...(base ? { basePath: base } : {}) },
  };
}

export function previewWindowPath(relative = DEFAULT_PREVIEW_PATH) {
  assertPreviewPath(relative);
  const location = resultLocation(relative);
  if (location)
    return `.canvas/previews/result-${location.category}-${location.feature}-v${location.version}.json`;
  if (isResultFolderPath(relative))
    return `.canvas/previews/game-${relative.split('/')[2]}.json`;
  return relative === DEFAULT_PREVIEW_PATH
    ? '.canvas/preview.json'
    : `.canvas/previews/${relative
        .split('/')
        .at(-1)!
        .replace(/\.html$/, '.json')}`;
}
