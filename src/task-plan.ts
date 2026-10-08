import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { reservePaths, resolveDocumentOutputs } from './document-output.ts';
import { isPreviewPath, resolvePreviewOutput } from './preview-output.ts';
import { createTaskSpecification } from './task-specification.ts';
import { expectedArtifacts } from './ai-artifacts.ts';
import { taskInstructions } from './task-instructions.ts';
import type { CreateTaskInput } from './shared.ts';
import type { Snapshot } from './project-store.ts';
import { prepareHtmlSource, htmlSourcePath } from './html-source.ts';
import { describeHtmlInput } from './html-inputs.ts';

/** Source records and tasks are committed together under the same user history. */
export function createTaskFiles(
  input: CreateTaskInput,
  id: string,
  files: Snapshot,
): Snapshot {
  const source = prepareHtmlSource(files, input.inputPaths, input.sourceMode);
  return {
    ...source?.additions,
    [`.ai/tasks/${id}.md`]: createTaskPlan(input, id, {
      ...files,
      ...source?.additions,
    }),
  };
}

/** One reservation/lease covers both stages, including mixed new/update modes. */
export function createTaskPlan(
  input: CreateTaskInput,
  id: string,
  files: Snapshot,
) {
  if (
    input.sourceMode !== undefined &&
    !['html', 'html-compose'].includes(input.sourceMode)
  )
    throw new CanvasError(
      'GC-AI-007',
      'HTML 분석 입력 모드가 올바르지 않습니다.',
    );
  const source = prepareHtmlSource(files, input.inputPaths, input.sourceMode);
  const htmlInputs =
    source &&
    (input.sourceMode === 'html-compose' ||
      input.thenImplement ||
      input.kind === 'implement')
      ? source.descriptors.map((descriptor) =>
          describeHtmlInput(files, descriptor.path),
        )
      : undefined;
  if (source) {
    files = { ...files, ...source.additions };
    input = {
      ...input,
      inputPaths: [
        ...new Set([
          ...input.inputPaths,
          ...source.recordPaths,
          ...(htmlInputs?.flatMap((source) =>
            source.files.map((file) => file.path),
          ) ?? []),
        ]),
      ],
    };
  }
  if (
    !['organize', 'implement'].includes(input.kind) ||
    (input.thenImplement !== undefined &&
      (input.kind !== 'organize' ||
        !input.thenImplement ||
        typeof input.thenImplement !== 'object' ||
        Array.isArray(input.thenImplement)))
  )
    throw new CanvasError('GC-AI-001', 'AI 작업 종류가 올바르지 않습니다.');
  const reserved = reservePaths(
    files,
    (raw) => matter(raw).data.expected_outputs,
  );
  const documents = input.kind === 'organize';
  const docChoice = input.documentResult;
  if (
    documents &&
    docChoice?.baseDir &&
    !Object.keys(files).some((path) => path.startsWith(`${docChoice.baseDir}/`))
  )
    throw new CanvasError('GC-AI-004', '갱신할 기존 문서를 찾을 수 없습니다.');
  const docOutputs = documents
    ? resolveDocumentOutputs(reserved, docChoice, input.resultName)
    : [];
  const htmlInput = input.thenImplement ?? input;
  const choice = {
    ...(source && source.descriptors.length > 1
      ? { category: 'prototypes' as const }
      : {}),
    ...(htmlInput.htmlResult ?? {
      mode:
        input.sourceMode === 'html-compose'
          ? ('new' as const)
          : ('update' as const),
    }),
  };
  if (!['new', 'update'].includes(choice.mode))
    throw new CanvasError('GC-AI-004', 'HTML 결과 방식이 올바르지 않습니다.');
  const base = choice.basePath;
  if (
    base &&
    choice.mode === 'update' &&
    files[htmlSourcePath(base)] &&
    matter(files[htmlSourcePath(base)]).data.imported_from
  )
    throw new CanvasError(
      'GC-AI-007',
      '불러온 원본 HTML은 유지해야 합니다. 새 HTML 결과를 선택해주세요.',
    );
  if (base !== undefined && (!isPreviewPath(base) || files[base] === undefined))
    throw new CanvasError(
      'GC-AI-004',
      '기준 HTML 결과 파일을 찾을 수 없습니다. 다시 선택해주세요.',
    );
  const resolved = resolvePreviewOutput(
    Object.keys(files).filter(
      (relative) =>
        !files[htmlSourcePath(relative)] ||
        !matter(files[htmlSourcePath(relative)]).data.imported_from,
    ),
    reserved,
    choice,
    htmlInput.resultName,
  );
  const htmlTarget = resolved.path;
  if (
    source &&
    (input.thenImplement || input.kind === 'implement') &&
    source.descriptors.some((source) => htmlTarget === source.path)
  )
    throw new CanvasError(
      'GC-AI-007',
      '분석 대상 원본 HTML은 덮어쓸 수 없습니다. 새 HTML 버전을 선택해주세요.',
    );
  const outputs = documents ? docOutputs : [htmlTarget];
  if (outputs.some((path) => input.inputPaths.includes(path)))
    throw new CanvasError(
      'GC-AI-004',
      '입력 문서를 동시에 덮어쓸 수 없습니다. 새 문서 버전을 선택해주세요.',
    );
  const first = createTaskSpecification(
    documents ? input : { ...input, htmlResult: resolved.choice },
    id,
    outputs,
    input.sourceMode === 'html' ? source?.descriptor : undefined,
    htmlInputs,
  );
  if (!input.thenImplement) return first;
  const imageInputs = input.inputPaths.filter(
    (path) => files[path] && matter(files[path]).data.type === 'image',
  );
  const second = createTaskSpecification(
    {
      kind: 'implement',
      inputPaths: [
        ...new Set([
          ...docOutputs,
          ...imageInputs,
          ...(source?.descriptors.map((source) => source.path) ?? []),
          ...(source?.recordPaths ?? []),
          ...(htmlInputs?.flatMap((source) =>
            source.files.map((file) => file.path),
          ) ?? []),
        ]),
      ],
      ...(htmlInputs ? { sourceMode: 'html-compose' as const } : {}),
      x: input.x,
      y: input.y,
      instructions: input.thenImplement.instructions,
      resultName: input.thenImplement.resultName,
      htmlResult: resolved.choice,
    },
    `${id}-implement`,
    [htmlTarget],
    undefined,
    htmlInputs,
  );
  const parsed = matter(first);
  const secondData = matter(second).data;
  const provenance = htmlInputs
    ? `\n## 입력 HTML 출처와 지원 파일 상태\n\n${JSON.stringify(htmlInputs, null, 2)}\n`
    : '';
  return matter.stringify(
    `# gamejam! · 문서 정리 → HTML 구현\n\n문서 정리를 먼저 실행·검증한 다음, 이번에 정리한 문서를 기반으로 HTML을 구현합니다.\n두 단계 전체가 성공해야 결과를 반영합니다. 실패·중지 시 기존 결과는 유지합니다.\n\n## 입력 문서\n\n${input.inputPaths.map((path) => `- \`${path}\``).join('\n')}\n\n## 1. 문서 정리 지시\n\n${taskInstructions('organize', input.instructions)}\n\n## 2. HTML 구현 지시\n\n${taskInstructions('implement', input.thenImplement.instructions)}\n\n## 출력\n\n${[...docOutputs, htmlTarget].map((path) => `- \`${path}\``).join('\n')}\n${provenance}`,
    {
      ...parsed.data,
      title: `gamejam! · ${input.thenImplement.resultName || input.resultName || '문서 정리 → HTML 구현'}`,
      expected_outputs: [...docOutputs, htmlTarget],
      html_output_mode: secondData.html_output_mode,
      base_html: secondData.base_html,
      gamejam_workflow_version: 1,
      workflow_steps: [first, second],
    },
  );
}

export function workflowStages(raw: string): string[] {
  const data = matter(raw).data;
  if (data.gamejam_workflow_version === undefined) return [];
  const stages = data.workflow_steps;
  if (
    data.gamejam_workflow_version !== 1 ||
    !Array.isArray(stages) ||
    stages.length !== 2 ||
    stages.some((stage) => typeof stage !== 'string')
  )
    throw new CanvasError(
      'GC-AI-004',
      'gamejam! 단계 명세가 올바르지 않습니다. 새 작업을 만들어주세요.',
    );
  const first = expectedArtifacts(stages[0]),
    second = expectedArtifacts(stages[1]);
  const all = expectedArtifacts(raw);
  const original = data.inputs,
    firstInputs = matter(stages[0]).data.inputs,
    secondInputs = matter(stages[1]).data.inputs;
  if (
    !Array.isArray(original) ||
    !original.length ||
    original.some(
      (path) => typeof path !== 'string' || path.split('/').includes('..'),
    ) ||
    !Array.isArray(firstInputs) ||
    firstInputs.length !== original.length ||
    firstInputs.some((path) => !original.includes(path)) ||
    !Array.isArray(secondInputs) ||
    secondInputs.some(
      (path) => !first.includes(path) && !original.includes(path),
    )
  )
    throw new CanvasError(
      'GC-AI-004',
      'gamejam! 단계의 입력 범위가 일치하지 않습니다.',
    );
  if (
    first.length !== 3 ||
    first.some((path) => !path.endsWith('.md')) ||
    second.length !== 1 ||
    !isPreviewPath(second[0]) ||
    all.length !== 4 ||
    [...first, ...second].some((path) => !all.includes(path)) ||
    first.some((path) => !secondInputs.includes(path))
  )
    throw new CanvasError(
      'GC-AI-004',
      'gamejam!의 정리 문서와 HTML 출력 범위가 일치하지 않습니다.',
    );
  return stages;
}

export function newOutputsAlreadyExist(raw: string, files: Snapshot) {
  const data = matter(raw).data;
  return expectedArtifacts(raw).some(
    (path) =>
      files[path] !== undefined &&
      (path.endsWith('.md')
        ? data.document_output_mode === 'new'
        : data.html_output_mode === 'new'),
  );
}

/** Protect organized documents as immutable input during the HTML stage. */
export function assertStageInputs(
  before: Snapshot,
  after: Snapshot,
  outputs: string[],
) {
  const changed = Object.keys({ ...before, ...after }).find(
    (path) => !outputs.includes(path) && before[path] !== after[path],
  );
  if (changed)
    throw new CanvasError(
      'GC-AI-003',
      `AI가 입력 문서를 변경했습니다. 결과를 반영하지 않습니다: ${changed}`,
    );
}
