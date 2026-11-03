import type { GamejamRequest } from '../../contracts/gamejam-request.ts';
import type {
  EffectiveInstructionsV2,
  TaskInstructionKind,
  TaskInstructionOriginV1,
} from '../../contracts/task-instructions.ts';
import {
  instructionTemplate,
  instructionTemplateId,
  TASK_INSTRUCTION_TEMPLATE_VERSION,
  MAX_TASK_INSTRUCTIONS,
} from './instruction-templates.ts';

const normalize = (text: string) => text.replace(/\r\n?/g, '\n').trim();
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function readInstructionOrigin(
  value: unknown,
): TaskInstructionOriginV1 | null {
  if (
    !object(value) ||
    value.version !== 1 ||
    !['default', 'custom', 'legacy'].includes(String(value.source)) ||
    ![
      'implement',
      'organize-markdown',
      'organize-html',
      'organize-html-compose',
    ].includes(String(value.templateId)) ||
    typeof value.templateVersion !== 'number' ||
    typeof value.defaultText !== 'string' ||
    instructionTemplate(
      value.templateId as TaskInstructionOriginV1['templateId'],
      value.templateVersion,
    ) !== value.defaultText
  )
    return null;
  return value as TaskInstructionOriginV1;
}
function origin(
  kind: TaskInstructionKind,
  sourceMode?: 'html' | 'html-compose',
  version = TASK_INSTRUCTION_TEMPLATE_VERSION,
  source: TaskInstructionOriginV1['source'] = 'default',
): TaskInstructionOriginV1 {
  const templateId = instructionTemplateId(kind, sourceMode);
  return {
    version: 1,
    templateId,
    templateVersion: version,
    defaultText: instructionTemplate(templateId, version)!,
    source,
  };
}
/** Capturing/reading never upgrades a frozen request. Only explicit reuse does. */
export function identifyInstructionOrigin(
  kind: TaskInstructionKind,
  text: string,
  supplied?: unknown,
  sourceMode?: 'html' | 'html-compose',
): TaskInstructionOriginV1 {
  const saved = readInstructionOrigin(supplied),
    id = instructionTemplateId(kind, sourceMode);
  if (saved && saved.templateId === id) {
    if (saved.source !== 'default') return { ...saved };
    return {
      ...saved,
      source: normalize(text) === saved.defaultText ? 'default' : 'custom',
    };
  }
  if (supplied !== undefined)
    return origin(
      kind,
      sourceMode,
      TASK_INSTRUCTION_TEMPLATE_VERSION,
      'legacy',
    );
  for (const version of [TASK_INSTRUCTION_TEMPLATE_VERSION, 1])
    if (normalize(text) === instructionTemplate(id, version))
      return origin(kind, sourceMode, version);
  return origin(kind, sourceMode, TASK_INSTRUCTION_TEMPLATE_VERSION, 'legacy');
}
/** Text stays a full replacement, so restoring a draft does not append a second default. */
export function editRequestInstructions(
  request: GamejamRequest,
  kind: TaskInstructionKind,
  text: string,
  reset = false,
): GamejamRequest {
  return {
    ...request,
    instructions: { ...request.instructions, [kind]: text },
    instructionOrigins: {
      ...request.instructionOrigins,
      [kind]: {
        ...origin(kind, request.sourceMode),
        source: reset ? 'default' : 'custom',
      },
    },
  };
}
export function prepareRequestInstructions(
  request: GamejamRequest,
  refreshDefaults: boolean,
) {
  const next = {
    ...request,
    instructions: { ...request.instructions },
    instructionOrigins: { ...request.instructionOrigins },
  };
  const updated: TaskInstructionKind[] = [],
    review: TaskInstructionKind[] = [];
  for (const kind of ['organize', 'implement'] as const) {
    const saved = identifyInstructionOrigin(
      kind,
      request.instructions[kind],
      request.instructionOrigins?.[kind],
      request.sourceMode,
    );
    if (refreshDefaults && saved.source === 'default') {
      const current = origin(kind, request.sourceMode);
      if (saved.templateVersion !== current.templateVersion) updated.push(kind);
      next.instructions[kind] = current.defaultText;
      next.instructionOrigins[kind] = current;
    } else {
      next.instructionOrigins[kind] = saved;
      if (saved.source === 'legacy') review.push(kind);
    }
  }
  return { request: next, updated, review };
}
export function freezeEffectiveInstructions(
  kind: TaskInstructionKind,
  text: string,
  supplied: unknown,
  sourceMode: 'html' | 'html-compose' | undefined,
  digest: (text: string) => string,
): EffectiveInstructionsV2 {
  if (supplied !== undefined && !readInstructionOrigin(supplied))
    throw Error(
      '작업 지시의 기본값 정보를 확인해주세요. 내용을 보존한 새 요청을 만들어주세요.',
    );
  const saved = identifyInstructionOrigin(kind, text, supplied, sourceMode);
  return {
    version: 2,
    kind,
    templateId: saved.templateId,
    templateVersion: saved.templateVersion,
    defaultText: saved.defaultText,
    defaultSha256: digest(saved.defaultText),
    source: saved.source,
    userText: saved.source === 'default' ? null : text,
    effectiveText: text,
    effectiveSha256: digest(text),
  };
}
export function validateEffectiveInstructions(
  value: unknown,
  digest: (text: string) => string,
): EffectiveInstructionsV2 {
  if (
    !object(value) ||
    value.version !== 2 ||
    !['organize', 'implement'].includes(String(value.kind)) ||
    !readInstructionOrigin({ ...value, version: 1 }) ||
    typeof value.effectiveText !== 'string' ||
    !value.effectiveText.trim() ||
    value.effectiveText.length > MAX_TASK_INSTRUCTIONS ||
    normalize(value.effectiveText) !== value.effectiveText ||
    [...value.effectiveText].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127;
    }) ||
    value.defaultSha256 !== digest(String(value.defaultText)) ||
    value.effectiveSha256 !== digest(value.effectiveText) ||
    (value.source === 'default'
      ? value.userText !== null || value.effectiveText !== value.defaultText
      : value.userText !== value.effectiveText) ||
    (value.kind === 'implement'
      ? value.templateId !== 'implement'
      : value.templateId === 'implement')
  )
    throw Error(
      '저장된 작업 지시의 버전·내용·해시가 일치하지 않습니다. 새 요청을 만들어주세요.',
    );
  return value as EffectiveInstructionsV2;
}
