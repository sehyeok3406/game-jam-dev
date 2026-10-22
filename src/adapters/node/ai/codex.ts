import type { AiReasoningEffort } from '../../../contracts/ai.ts';

export function codexArguments(
  model: string | null,
  stage: string,
  reasoningEffort?: AiReasoningEffort | null,
) {
  const choice = model ? ['--model', model] : [];
  return [
    'exec',
    ...choice,
    ...(reasoningEffort
      ? ['--config', `model_reasoning_effort="${reasoningEffort}"`]
      : []),
    '--ignore-user-config',
    // Codex 0.160.1 leaves the permission profile read-only when user config
    // is ignored, even with --approve-for-me. Set the profile explicitly.
    '--config',
    'default_permissions=":workspace"',
    '--json',
    '--color',
    'never',
    '--approve-for-me',
    '--cd',
    stage,
    '--skip-git-repo-check',
    '--ephemeral',
    '-',
  ];
}

export const describeCodexJsonEvent = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : 'event';
  const item =
    event.item && typeof event.item === 'object'
      ? (event.item as Record<string, unknown>)
      : null;
  const itemType = typeof item?.type === 'string' ? item.type : null;

  if (itemType === 'command_execution') {
    const command = typeof item?.command === 'string' ? item.command : '';
    return command ? `명령 실행 · ${command}` : '명령을 실행하고 있습니다.';
  }
  if (itemType === 'file_change') {
    const changes = Array.isArray(item?.changes) ? item.changes.length : 0;
    return changes > 0
      ? `파일 변경 · ${changes}개 항목`
      : '파일을 변경하고 있습니다.';
  }
  if (itemType === 'agent_message') {
    const text =
      typeof item?.text === 'string'
        ? item.text
        : typeof item?.message === 'string'
          ? item.message
          : '';
    return text || 'Codex가 결과를 정리하고 있습니다.';
  }
  if (itemType === 'error') {
    const message = typeof item?.message === 'string' ? item.message : '';
    return message || 'Codex 작업 항목에서 오류가 발생했습니다.';
  }
  if (type === 'thread.started') return 'Codex 세션을 시작했습니다.';
  if (type === 'turn.started') return '작업 내용을 분석하고 있습니다.';
  if (type === 'turn.completed') return 'Codex 실행이 완료되었습니다.';
  if (type === 'turn.failed') return 'Codex 실행이 실패했습니다.';
  if (type.startsWith('item.'))
    return itemType ? `${itemType.replaceAll('_', ' ')} 처리 중` : null;
  if (type === 'error') {
    const message = typeof event.message === 'string' ? event.message : '';
    return message || 'Codex 실행 중 오류가 발생했습니다.';
  }
  return null;
};
