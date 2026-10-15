import { assertCanvas } from './canvas-sheets.ts';
import { multiplayerIntent } from './multiplayer/intent.ts';
import {
  multiplayerSettings,
  readMultiplayerManifest,
} from './multiplayer/contract.ts';
import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { reservePaths, resolveDocumentOutputs } from './document-output.ts';
import { isPreviewPath, resolvePreviewOutput } from './preview-output.ts';
import { createTaskSpecification } from './task-specification.ts';
import { expectedArtifacts } from './ai-artifacts.ts';
import { taskInstructions } from './task-instructions.ts';
import { gamejamSnapshotFromInput } from './gamejam-history.ts';
import type { CreateTaskInput } from './shared.ts';
import type { Snapshot } from './project-store.ts';
import { prepareHtmlSource, htmlSourcePath } from './html-source.ts';
import { describeHtmlInput } from './html-inputs.ts';
import {
  documentTemplates,
  taskDocumentFormat,
  type DocumentOutputFormat,
} from './document-format.ts';
import {
  documentBundleContract,
  MAX_SYSTEM_DOCUMENTS,
  type DocumentBundleContract,
} from './document-bundle.ts';

/** Source records and tasks are committed together under the same user history. */
export function createTaskFiles(
  input: CreateTaskInput,
  id: string,
  files: Snapshot,
): Snapshot {
  assertCanvas(files, input.canvasId);
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
  const htmlChoice = input.thenImplement ?? input;
  const baseline =
    htmlChoice.htmlResult?.basePath ??
    (htmlChoice.htmlResult?.mode !== 'new' ? 'output/index.html' : undefined);
  const explicitMultiplayer =
    htmlChoice.multiplayer !== undefined
      ? htmlChoice.multiplayer
      : input.multiplayer;
  const implementing = input.kind === 'implement' || !!input.thenImplement;
  const instructionIntent =
    implementing && explicitMultiplayer === undefined
      ? multiplayerIntent(
          input.thenImplement?.instructions ?? input.instructions ?? '',
        )
      : undefined;
  const requestedMultiplayer =
    explicitMultiplayer !== undefined ? explicitMultiplayer : instructionIntent;
  const inheritedMultiplayer =
    requestedMultiplayer === undefined && baseline && files[baseline]
      ? readMultiplayerManifest(files[baseline])
      : undefined;
  const documentIntent =
    implementing && requestedMultiplayer === undefined && !inheritedMultiplayer
      ? input.inputPaths
          .filter((path) => path.endsWith('.md') && files[path])
          .map((path) => multiplayerIntent(matter(files[path]).content))
          .find((value) => value !== undefined && value !== null)
      : undefined;
  const resolvedMultiplayer = multiplayerSettings(
    requestedMultiplayer !== undefined
      ? requestedMultiplayer
      : (inheritedMultiplayer ?? documentIntent),
  );
  input = {
    ...input,
    multiplayer: resolvedMultiplayer,
    ...(input.thenImplement
      ? {
          thenImplement: {
            ...input.thenImplement,
            multiplayer: resolvedMultiplayer,
          },
        }
      : {}),
  };
  input = { ...input, requestSnapshot: gamejamSnapshotFromInput(input) };
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
  if (
    htmlInputs &&
    htmlInputs.length > 1 &&
    !htmlChoice.htmlResult?.basePath &&
    resolvedMultiplayer === undefined &&
    htmlInputs.some((source) => readMultiplayerManifest(files[source.path]))
  )
    throw new Error(
      '[GC-MP-001] 멀티 게임을 통합할 때는 기능 라이브러리에서 온라인 모듈 추가 또는 개인 게임을 선택해주세요.',
    );
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
  let docOutputs = documents
    ? resolveDocumentOutputs(reserved, docChoice, input.resultName)
    : [];
  const previousBundle =
    documents && files[docOutputs[0]]
      ? matter(files[docOutputs[0]]).data.document_bundle
      : undefined;
  const previousFormat =
    documents && files[docOutputs[0]]
      ? matter(files[docOutputs[0]]).data.document_output
      : undefined;
  if (previousFormat && docChoice?.structure !== 'custom')
    throw new CanvasError('GC-AI-004', '기존 문서의 출력 구성을 지정해주세요.');
  const documentFormat: DocumentOutputFormat | undefined =
    documents && docChoice?.structure === 'custom'
      ? {
          version: 1,
          id: files[docOutputs[0]]
            ? (matter(files[docOutputs[0]]).data.document_bundle_id ??
              `format-${id}`)
            : `format-${id}`,
          documents: documentTemplates(docChoice.documents).map(
            (doc, index) => ({ ...doc, path: docOutputs[index] }),
          ),
        }
      : undefined;
  if (previousBundle?.version === 1) {
    const prefix =
      docOutputs[0].slice(0, -'game-overview.md'.length) + 'system-';
    if (
      !Array.isArray(previousBundle.systems) ||
      !previousBundle.systems.length ||
      previousBundle.systems.length > MAX_SYSTEM_DOCUMENTS ||
      previousBundle.systems.some(
        (system: { key?: string; path?: string }) =>
          typeof system?.key !== 'string' ||
          !/^[a-z0-9][a-z0-9-]{0,63}$/.test(system.key) ||
          system.path !== `${prefix}${system.key}.md`,
      )
    )
      throw new CanvasError(
        'GC-AI-004',
        '갱신할 시스템 문서 목록을 확인해주세요.',
      );
    docOutputs = [
      docOutputs[0],
      ...previousBundle.systems.map((system: { path: string }) => system.path),
    ];
  }
  const systemDocuments =
    documents &&
    (previousBundle?.version === 1 ||
      (docChoice?.structure === 'systems' &&
        (docChoice.mode !== 'update' || docOutputs.length === 1)));
  const documentBundle: DocumentBundleContract | undefined = systemDocuments
    ? {
        version: 1,
        id: previousBundle?.id ?? `bundle-${id}`,
        overview: docOutputs[0],
        systemPrefix:
          docOutputs[0].slice(0, -'game-overview.md'.length) + 'system-',
        maxSystems: MAX_SYSTEM_DOCUMENTS,
      }
    : undefined;
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
    documentBundle,
    documentFormat,
  );
  taskDocumentFormat(first);
  if (!input.thenImplement) return first;
  const imageInputs = input.inputPaths.filter(
    (path) => files[path] && matter(files[path]).data.type === 'image',
  );
  const second = createTaskSpecification(
    {
      kind: 'implement',
      multiplayer: resolvedMultiplayer,
      canvasId: input.canvasId,
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
      ...(secondData.multiplayer !== undefined
        ? { multiplayer: secondData.multiplayer }
        : {}),
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
  const bundle = documentBundleContract(raw);
  const format = taskDocumentFormat(raw);
  if (JSON.stringify(format) !== JSON.stringify(taskDocumentFormat(stages[0])))
    throw new CanvasError(
      'GC-AI-004',
      '단계별 문서 출력 구성이 일치하지 않습니다.',
    );
  if (
    JSON.stringify(bundle) !== JSON.stringify(documentBundleContract(stages[0]))
  )
    throw new CanvasError(
      'GC-AI-004',
      '단계별 시스템 문서 묶음 명세가 일치하지 않습니다.',
    );
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
    (bundle || format
      ? first.length < 1 || first.length > MAX_SYSTEM_DOCUMENTS + 1
      : first.length !== 3) ||
    first.some((path) => !path.endsWith('.md')) ||
    second.length !== 1 ||
    !isPreviewPath(second[0]) ||
    all.length !== first.length + second.length ||
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
  const bundle = documentBundleContract(raw);
  if (
    bundle &&
    data.document_output_mode === 'new' &&
    Object.keys(files).some((path) => path.startsWith(bundle.systemPrefix))
  )
    return true;
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
