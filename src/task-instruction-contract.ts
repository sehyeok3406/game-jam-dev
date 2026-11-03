import matter from './markdown.ts';
import { CanvasError } from './app-errors.ts';
import { taskInstructionDigest } from './adapters/node/task-instruction-digest.ts';
import { validateEffectiveInstructions } from './core/ai/task-instructions.ts';
import { validateTaskDesignContext } from './core/ai/task-context.ts';

/** Existing v1 tasks remain frozen and readable. New records must agree with their body and scope. */
export function taskInstructionContract(raw: string) {
  const { data, content } = matter(raw);
  if (
    data.effective_instructions === undefined &&
    data.task_context === undefined &&
    data.instruction_template_version !== 2
  )
    return null;
  try {
    const effective = validateEffectiveInstructions(
      data.effective_instructions,
      taskInstructionDigest,
    );
    const from = content.indexOf('## 사용자 작업 지시\n\n'),
      to = content.lastIndexOf('\n\n## 고정 보호 규칙\n');
    if (
      from < 0 ||
      to <= from ||
      content.slice(from + '## 사용자 작업 지시\n\n'.length, to) !==
        effective.effectiveText
    )
      throw Error('작업 지시 본문과 고정 기록이 일치하지 않습니다.');
    const inputs = Array.isArray(data.inputs) ? data.inputs : [];
    const outputs = Array.isArray(data.expected_outputs)
      ? data.expected_outputs
      : [];
    const context = validateTaskDesignContext(data.task_context, [
      ...inputs,
      ...outputs,
    ]);
    if (
      context.originalInstructions[effective.kind] !== effective.effectiveText
    )
      throw Error('원본 작업 지시가 변경되었습니다.');
    return { effective, context };
  } catch (error) {
    throw new CanvasError('GC-AI-004', (error as Error).message);
  }
}
