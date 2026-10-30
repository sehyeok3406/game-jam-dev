import type { DocumentResultChoice } from './contracts/document-output.ts';
export type { DocumentResultChoice } from './contracts/document-output.ts';
import { CanvasError } from './app-errors.ts';
import { resultFileStem } from './result-name.ts';
import { documentTemplates } from './document-format.ts';
import type { CanvasDocument } from './contracts/documents.ts';
import type { Snapshot } from './contracts/project.ts';
import { readProjectLayout } from './core/projects/project-layout.ts';
import { allocateDocumentPath } from './core/projects/document-path.ts';
import matter from './markdown.ts';
export const DOCUMENT_NAMES = [
  'game-overview.md',
  'core-loop.md',
  'open-questions.md',
] as const;
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
type OutputRecord = Pick<
  CanvasDocument,
  'relativePath' | 'documentBundleId' | 'outputKey' | 'title' | 'type'
>;
export function documentSets(paths: string[], records: OutputRecord[] = []) {
  const bundles = new Map<string, OutputRecord[]>();
  for (const record of records)
    if (record.documentBundleId) {
      const group = bundles.get(record.documentBundleId) ?? [];
      group.push(record);
      bundles.set(record.documentBundleId, group);
    }
  const groupedPaths = new Set(
    [...bundles.values()].flat().map((d) => d.relativePath),
  );
  paths = paths.filter((p) => !groupedPaths.has(p));
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
  const legacy = [...groups]
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
  return [
    ...legacy,
    ...[...bundles].map(([id, docs]) => ({
      baseDir: `bundle:${id}`,
      version: 1,
      label: docs.find((d) => d.outputKey === 'd1')?.title ?? docs[0].title,
      structure: docs.some((d) => d.outputKey)
        ? ('custom' as const)
        : ('systems' as const),
      paths: docs
        .sort((a, b) =>
          a.outputKey && b.outputKey
            ? Number(a.outputKey.slice(1)) - Number(b.outputKey.slice(1))
            : Number(b.type === 'overview') - Number(a.type === 'overview') ||
              a.relativePath.localeCompare(b.relativePath),
        )
        .map((d) => d.relativePath),
    })),
  ];
}
export function documentOutputRecords(files: Snapshot): OutputRecord[] {
  return Object.entries(files)
    .filter(([p]) => p.startsWith('docs/') && p.endsWith('.md'))
    .map(([relativePath, raw]) => {
      const data = matter(raw).data;
      return {
        relativePath,
        title: String(data.title ?? relativePath),
        type: data.type,
        outputKey: data.document_output?.key,
        documentBundleId: data.document_bundle_id ?? data.document_bundle?.id,
      };
    });
}
export function resolveDocumentOutputs(
  reservedPaths: string[],
  choice: DocumentResultChoice = { mode: 'update' },
  name?: string,
  context?: { files: Snapshot; id: string },
) {
  const stem = resultFileStem(name);
  if (
    choice.structure !== undefined &&
    !['systems', 'legacy', 'custom'].includes(choice.structure)
  )
    throw new CanvasError('GC-AI-004', '문서 결과 구성을 확인해주세요.');
  if (!['new', 'update'].includes(choice.mode))
    throw new CanvasError('GC-AI-004', '문서 결과 방식을 확인해주세요.');
  if (choice.baseDir !== undefined && !choice.baseDir.startsWith('bundle:'))
    documentVersion(choice.baseDir);
  const templates =
    choice.structure === 'custom'
      ? documentTemplates(choice.documents)
      : undefined;
  if (
    context &&
    (readProjectLayout(context.files) || choice.baseDir?.startsWith('bundle:'))
  ) {
    const sets = documentSets(
      reservedPaths,
      documentOutputRecords(context.files),
    );
    const existing =
      choice.mode === 'update'
        ? sets.find(
            (set) => set.baseDir === (choice.baseDir ?? sets.at(-1)?.baseDir),
          )
        : undefined;
    if (choice.mode === 'update' && choice.baseDir && !existing)
      throw new CanvasError(
        'GC-AI-004',
        '갱신할 문서 묶음을 찾을 수 없습니다.',
      );
    if (existing) {
      if (templates && existing.structure !== 'custom')
        throw new CanvasError(
          'GC-AI-004',
          '다른 출력 구성은 새 문서 묶음으로 만들어주세요.',
        );
      if (!templates) return existing.paths;
      const byKey = new Map(
        existing.paths.map((path) => [
          matter(context.files[path]).data.document_output?.key,
          path,
        ]),
      );
      if (
        existing.paths.some(
          (path) =>
            !templates.some(
              (t) =>
                t.key === matter(context.files[path]).data.document_output?.key,
            ),
        )
      )
        throw new CanvasError('GC-AI-004', '기존 묶음의 문서는 유지해주세요.');
      const used = [...reservedPaths];
      return templates.map((doc) => {
        const path =
          byKey.get(doc.key) ??
          allocateDocumentPath(
            `${stem ? stem + '-' : ''}${doc.title}`,
            used,
            `${context.id}-${doc.key}`,
          );
        used.push(path);
        return path;
      });
    }
    if (templates) {
      const used = [...reservedPaths];
      return templates.map((doc) => {
        const path = allocateDocumentPath(
          `${stem ? stem + '-' : ''}${doc.title}`,
          used,
          `${context.id}-${doc.key}`,
        );
        used.push(path);
        return path;
      });
    }
    let prefix = stem || '문서';
    let version = 1;
    while (
      documentOutputs('docs', prefix).some((p) => reservedPaths.includes(p))
    )
      prefix = `${stem || '문서'}-v${++version}`;
    return documentOutputs('docs', prefix).slice(
      0,
      choice.structure === 'systems' ? 1 : 3,
    );
  }
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
