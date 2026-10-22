import type { AiReasoningEffort } from '../../../contracts/ai.ts';

export function claudeArguments(
  model: string | null,
  stage: string,
  reasoningEffort?: AiReasoningEffort | null,
) {
  const choice = model ? ['--model', model] : [];
  return [
    '--print',
    ...choice,
    ...(reasoningEffort ? ['--effort', reasoningEffort] : []),
    '--restricted',
    '--tools',
    'Read,Glob,Grep,Edit,Write',
    '--allowedTools',
    'Read,Glob,Grep,Edit,Write',
    '--permission-mode',
    'acceptEdits',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--no-session-persistence',
    '--output-format',
    'stream-json',
    '--verbose',
  ];
}

export function claudeEvent(
  value: unknown,
): { message: string; error?: boolean; result?: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, any>;
  if (event.type === 'system')
    return { message: 'Claude 세션을 시작했습니다.' };
  if (event.type === 'assistant') {
    const parts = event.message?.content;
    if (!Array.isArray(parts)) return null;
    const message = parts
      .map((part: any) =>
        part.type === 'text'
          ? part.text
          : part.type === 'tool_use'
            ? `도구 실행 · ${part.name}`
            : '',
      )
      .filter(Boolean)
      .join('\n');
    return message ? { message } : null;
  }
  if (event.type === 'result')
    return {
      message:
        typeof event.result === 'string'
          ? event.result
          : event.is_error
            ? 'Claude 실행 실패'
            : 'Claude 실행 완료',
      error: !!event.is_error,
      result: !event.is_error,
    };

  return null;
}
