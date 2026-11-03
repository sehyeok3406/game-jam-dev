import { CanvasError } from './app-errors.ts';
import {
  DEFAULT_TASK_INSTRUCTIONS,
  MAX_TASK_INSTRUCTIONS,
} from './core/ai/instruction-templates.ts';
export {
  DEFAULT_TASK_INSTRUCTIONS,
  MAX_TASK_INSTRUCTIONS,
  HTML_ANALYSIS_INSTRUCTIONS,
  defaultTaskInstructions,
} from './core/ai/instruction-templates.ts';

export function taskInstructions(
  kind: 'organize' | 'implement',
  value?: unknown,
) {
  if (!Object.hasOwn(DEFAULT_TASK_INSTRUCTIONS, kind))
    throw new CanvasError('GC-AI-001', 'AI 작업 종류가 올바르지 않습니다.');
  // Older clients still receive the same defaults; an explicitly empty edit
  // must not silently discard the user's intent and substitute the template.
  if (value === undefined) return DEFAULT_TASK_INSTRUCTIONS[kind];
  if (typeof value !== 'string')
    throw new CanvasError('GC-AI-001', '작업 지시는 텍스트로 입력해주세요.');
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text)
    throw new CanvasError(
      'GC-AI-001',
      '작업 지시를 입력하거나 기본값으로 복원해주세요.',
    );
  if (value.length > MAX_TASK_INSTRUCTIONS)
    throw new CanvasError(
      'GC-AI-001',
      `작업 지시는 ${MAX_TASK_INSTRUCTIONS.toLocaleString()}자 이하로 입력해주세요.`,
    );
  if (
    [...text].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127;
    })
  )
    throw new CanvasError(
      'GC-AI-001',
      '작업 지시에 사용할 수 없는 제어 문자가 있습니다.',
    );
  return text;
}
