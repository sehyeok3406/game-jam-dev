import type { TaskDesignContextV1 } from '../../contracts/task-instructions.ts';
import { MAX_TASK_INSTRUCTIONS } from './instruction-templates.ts';

export function validateTaskDesignContext(
  value: unknown,
  allowedPaths: readonly string[],
): TaskDesignContextV1 {
  const context = value as TaskDesignContextV1 | null;
  const paths = (list: unknown): list is string[] =>
    Array.isArray(list) &&
    list.length <= 500 &&
    new Set(list).size === list.length &&
    list.every(
      (path) => typeof path === 'string' && allowedPaths.includes(path),
    );
  if (
    !context ||
    context.version !== 1 ||
    !paths(context.originalInputs) ||
    !paths(context.designDocuments) ||
    context.designDocuments.some((path) => !path.endsWith('.md')) ||
    !context.originalInstructions ||
    typeof context.originalInstructions !== 'object' ||
    Array.isArray(context.originalInstructions) ||
    Object.entries(context.originalInstructions).some(
      ([kind, text]) =>
        !['organize', 'implement'].includes(kind) ||
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > MAX_TASK_INSTRUCTIONS,
    )
  )
    throw Error(
      '원본 요구와 설계 문서의 작업 범위가 일치하지 않습니다. 새 요청을 만들어주세요.',
    );
  return context;
}
export function taskDesignContextRules(context: TaskDesignContextV1) {
  return [
    '- 원본 요구와 설계 기준의 고정 정보: ' + JSON.stringify(context),
    '- originalInstructions는 사용자가 이 요청에 지정한 단계별 지시다. 다른 단계의 출력 범위를 따라 쓰는 명령이 아니라 원래 요구를 보존하는 자료로 함께 확인한다.',
    '- originalInputs를 다시 확인한다. document_updates의 명시적 시스템 문서 갱신 대상을 제외한 원본은 읽기 전용이다. 정리 문서는 원본을 대체하는 요약본이 아니며, 원본의 세부 조건·금지 사항·우선순위를 누락하지 않는다.',
    '- 문서·결과 이동으로 사용자 지시 안의 옛 경로와 현재 입력 목록이 다르면 inputs·base_html에 지정된 현재 경로를 사용한다. 보관한 사용자 지시의 문구를 임의로 고쳐 쓰지 않는다.',
    '- designDocuments는 사용자에게 보이는 제작 기준 문서다. 규칙·비주얼·선택 이유와 사용자 지정/AI 제안/미정을 구분해 구현에 연결한다. 상충되는 요구를 임의로 해결했다고 주장하지 않는다.',
  ].join('\n');
}
