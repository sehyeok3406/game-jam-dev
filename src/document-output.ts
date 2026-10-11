import { CanvasError } from './app-errors.ts';
import { resultFileStem } from './result-name.ts';
import {
  documentTemplates,
  type DocumentOutputTemplate,
} from './document-format.ts';
export const DOCUMENT_NAMES = [
  'game-overview.md',
  'core-loop.md',
  'open-questions.md',
] as const;
export type DocumentResultChoice = {
  mode: 'new' | 'update';
  baseDir?: string;
  structure?: 'systems' | 'legacy' | 'custom';
  documents?: DocumentOutputTemplate[];
};
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
        /^(?:[\p{L}\p{M}\p{N}_-]+-)?(?:game-overview|core-loop|open-questions|document-d[1-9]\d*)\.md$/u.test(
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
          /^(?:[\p{L}\p{M}\p{N}_-]+-)?(?:game-overview|core-loop|open-questions|document-d[1-9]\d*)\.md$/u.test(
            path.split('/').at(-1)!,
          ),
      )!;
      const leaf = example.slice(baseDir.length + 1);
      const custom =
        /^(?:([\p{L}\p{M}\p{N}_-]+)-)?document-d[1-9]\d*\.md$/u.exec(leaf);
      const role = DOCUMENT_NAMES.find(
        (name) => leaf === name || leaf.endsWith(`-${name}`),
      )!;
      const stem = custom
        ? (custom[1] ?? '')
        : leaf === role
          ? ''
          : leaf.slice(0, -role.length - 1);
      const customPrefix = `${baseDir}/${stem ? `${stem}-` : ''}document-`;
      const customPaths = paths
        .filter(
          (path) =>
            path.startsWith(customPrefix) &&
            /^d[1-9]\d*\.md$/.test(path.slice(customPrefix.length)),
        )
        .sort();
      const systemPrefix = `${baseDir}/${stem ? `${stem}-` : ''}system-`;
      const systems = paths
        .filter(
          (path) =>
            path.startsWith(systemPrefix) &&
            /^[-a-z0-9]+\.md$/.test(path.slice(systemPrefix.length)),
        )
        .sort();
      const systemStructure =
        systems.length > 0 &&
        !paths.includes(`${baseDir}/${stem ? `${stem}-` : ''}core-loop.md`);
      return {
        baseDir,
        version: documentVersion(baseDir),
        label: `${stem ? `${stem} · ` : ''}문서 버전 ${documentVersion(baseDir)}`,
        // Recognizing pre-existing/imported filenames must not apply the new
        // input length/reserved-name policy or crash the whole canvas.
        structure: custom
          ? ('custom' as const)
          : systemStructure
            ? ('systems' as const)
            : ('legacy' as const),
        paths: custom
          ? customPaths
          : systemStructure
            ? [
                `${baseDir}/${stem ? `${stem}-` : ''}game-overview.md`,
                ...systems,
              ]
            : DOCUMENT_NAMES.map(
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
  if (
    choice.structure !== undefined &&
    !['systems', 'legacy', 'custom'].includes(choice.structure)
  )
    throw new CanvasError('GC-AI-004', '문서 결과 구성을 확인해주세요.');
  if (!['new', 'update'].includes(choice.mode))
    throw new CanvasError('GC-AI-004', '문서 결과 방식을 확인해주세요.');
  if (choice.baseDir !== undefined) documentVersion(choice.baseDir);
  const templates =
    choice.structure === 'custom'
      ? documentTemplates(choice.documents)
      : undefined;
  const customOutputs = (base: string, fileStem: string) =>
    templates!.map(
      (doc) =>
        `${base}/${fileStem ? fileStem + '-' : ''}document-${doc.key}.md`,
    );
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
    if (templates) {
      if (existing && existing.structure !== 'custom')
        throw new CanvasError(
          'GC-AI-004',
          '다른 출력 구성으로 변경하려면 새 문서 버전을 만들어주세요.',
        );
      const existingLeaf = existing?.paths[0]?.slice(base.length + 1);
      const existingStem = existingLeaf
        ? (/^(?:([\p{L}\p{M}\p{N}_-]+)-)?document-d[1-9]\d*\.md$/u.exec(
            existingLeaf,
          )?.[1] ?? '')
        : stem;
      const outputs = customOutputs(base, existingStem);
      if (existing?.paths.some((path) => !outputs.includes(path)))
        throw new CanvasError(
          'GC-AI-004',
          '기존 묶음의 문서는 유지해주세요. 문서를 줄이려면 새 버전을 만들어주세요.',
        );
      return outputs;
    }
    return (
      existing?.paths ??
      documentOutputs(base, stem).slice(
        0,
        choice.structure === 'systems' ? 1 : 3,
      )
    );
  }
  const sets = documentSets(reservedPaths);
  if (templates)
    return customOutputs(
      sets.length
        ? `docs/versions/v${Math.max(...sets.map((set) => set.version)) + 1}`
        : 'docs',
      stem,
    );
  return documentOutputs(
    sets.length
      ? `docs/versions/v${Math.max(...sets.map((set) => set.version)) + 1}`
      : 'docs',
    stem,
  ).slice(0, choice.structure === 'systems' ? 1 : 3);
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
