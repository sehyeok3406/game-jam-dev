import { CanvasError } from './app-errors.ts';
import { resultFileStem } from './result-name.ts';
export const DOCUMENT_NAMES = [
  'game-overview.md',
  'core-loop.md',
  'open-questions.md',
] as const;
export type DocumentResultChoice = { mode: 'new' | 'update'; baseDir?: string };
export const documentOutputs = (baseDir = 'docs', resultName?: string) => {
  const stem = resultFileStem(resultName);
  return DOCUMENT_NAMES.map(
    (name) => `${baseDir}/${stem ? `${stem}-` : ''}${name}`,
  );
};
export function documentVersion(baseDir: string) {
  if (baseDir === 'docs') return 1;
  const match = /^docs\/versions\/v([2-9]\d*|1\d+)$/.exec(baseDir);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new CanvasError(
      'GC-AI-004',
      '정리 문서 버전 경로가 올바르지 않습니다.',
    );
  return Number(match[1]);
}
export function documentSets(paths: string[]) {
  const groups = new Set(
    paths
      .filter((path) =>
        /^(?:[\p{L}\p{M}\p{N}_-]+-)?(?:game-overview|core-loop|open-questions)\.md$/u.test(
          path.split('/').at(-1)!,
        ),
      )
      .map((path) => path.slice(0, path.lastIndexOf('/')))
      .filter(
        (dir) =>
          dir === 'docs' ||
          (/^docs\/versions\/v(?:[2-9]\d*|1\d+)$/.test(dir) &&
            Number.isSafeInteger(Number(dir.split('/').at(-1)!.slice(1)))),
      ),
  );
  return [...groups]
    .sort((a, b) => documentVersion(a) - documentVersion(b))
    .map((baseDir) => {
      const example = paths.find(
        (path) =>
          path.slice(0, path.lastIndexOf('/')) === baseDir &&
          /^(?:[\p{L}\p{M}\p{N}_-]+-)?(?:game-overview|core-loop|open-questions)\.md$/u.test(
            path.split('/').at(-1)!,
          ),
      )!;
      const leaf = example.slice(baseDir.length + 1);
      const role = DOCUMENT_NAMES.find(
        (name) => leaf === name || leaf.endsWith(`-${name}`),
      )!;
      const stem = leaf === role ? '' : leaf.slice(0, -role.length - 1);
      return {
        baseDir,
        version: documentVersion(baseDir),
        label: `${stem ? `${stem} · ` : ''}문서 버전 ${documentVersion(baseDir)}`,
        // Recognizing pre-existing/imported filenames must not apply the new
        // input length/reserved-name policy or crash the whole canvas.
        paths: DOCUMENT_NAMES.map(
          (name) => `${baseDir}/${stem ? `${stem}-` : ''}${name}`,
        ),
      };
    });
}
export function resolveDocumentOutputs(
  reservedPaths: string[],
  choice: DocumentResultChoice = { mode: 'update' },
  name?: string,
) {
  const stem = resultFileStem(name);
  if (!['new', 'update'].includes(choice.mode))
    throw new CanvasError('GC-AI-004', '문서 결과 방식을 확인해주세요.');
  if (choice.baseDir !== undefined) documentVersion(choice.baseDir);
  if (choice.mode === 'update') {
    const base = choice.baseDir ?? 'docs';
    const existing = documentSets(reservedPaths).find(
      (set) => set.baseDir === base,
    );
    if (choice.baseDir && !existing)
      throw new CanvasError(
        'GC-AI-004',
        '갱신할 문서 묶음을 찾을 수 없습니다.',
      );
    return existing?.paths ?? documentOutputs(base, stem);
  }
  const sets = documentSets(reservedPaths);
  return documentOutputs(
    sets.length
      ? `docs/versions/v${Math.max(...sets.map((set) => set.version)) + 1}`
      : 'docs',
    stem,
  );
}
export function reservePaths(
  files: Record<string, string>,
  parseOutputs: (raw: string) => unknown,
) {
  return [
    ...Object.keys(files),
    ...Object.entries(files)
      .filter(([key]) => key.startsWith('.ai/tasks/'))
      .flatMap(([, raw]) => {
        const outputs = parseOutputs(raw);
        return Array.isArray(outputs)
          ? outputs.filter((path): path is string => typeof path === 'string')
          : [];
      }),
  ];
}
