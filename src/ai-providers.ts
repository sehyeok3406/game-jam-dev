import type { AiProviderId } from './shared.ts';

export const AI_PROVIDERS = [
  {
    id: 'codex-cli' as AiProviderId,
    label: 'GPT · Codex',
    description: '이 PC의 Codex CLI 로그인으로 실행합니다.',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
    models: [
      { id: '', label: '자동 선택' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ],
  },
  {
    id: 'claude-cli' as AiProviderId,
    label: 'Claude · Claude Code',
    description: '이 PC의 Claude Code 로그인으로 실행합니다.',
    install: '공식 Claude Code 설치: https://code.claude.com/docs/en/setup',
    login: 'claude auth login',
    models: [
      { id: '', label: '자동 선택' },
      { id: 'sonnet', label: 'Sonnet (CLI 별칭)' },
      { id: 'opus', label: 'Opus (CLI 별칭)' },
      { id: 'haiku', label: 'Haiku (CLI 별칭)' },
    ],
  },
  {
    id: 'gemini-cli' as AiProviderId,
    label: 'Gemini · Gemini CLI',
    description: '이 PC의 Gemini CLI 로그인으로 실행합니다.',
    install: 'npm install -g @google/gemini-cli',
    login: 'gemini (실행 후 Google 로그인)',
    models: [{ id: '', label: '자동 선택' }],
  },
];

export function isAiProvider(value: unknown): value is AiProviderId {
  return AI_PROVIDERS.some((provider) => provider.id === value);
}
export function aiProvider(value: AiProviderId) {
  return (
    AI_PROVIDERS.find((provider) => provider.id === value) ?? AI_PROVIDERS[0]
  );
}
export function aiArguments(
  provider: AiProviderId,
  model: string | null,
  stage: string,
) {
  const choice = model ? ['--model', model] : [];
  if (provider === 'codex-cli')
    return [
      'exec',
      ...choice,
      '--ignore-user-config',
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
  if (provider === 'claude-cli')
    return [
      '--print',
      ...choice,
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
  return [
    ...choice,
    '--prompt',
    'Follow the task specification provided on stdin and write the required output files.',
    '--approval-mode',
    'auto_edit',
    '--extensions',
    'none',
    '--skip-trust',
    '--allowed-mcp-server-names',
    `__gamecanvas_no_mcp_${stage.split(/[\\/]/).at(-2) ?? 'isolated'}__`,
    '--output-format',
    'stream-json',
  ];
}

// Each invocation gets its own overrides; never rewrite the user's CLI settings.
export const GEMINI_RUN_SETTINGS = {
  tools: {
    core: [
      'read_file',
      'read_many_files',
      'list_directory',
      'search_file_content',
      'glob',
      'write_file',
      'replace',
    ],
    allowed: [],
    exclude: [
      'run_shell_command',
      'web_fetch',
      'google_web_search',
      'activate_skill',
      'save_memory',
    ],
    discoveryCommand: '',
    callCommand: '',
  },
  admin: {
    mcp: { enabled: false },
    extensions: { enabled: false },
    skills: { enabled: false },
  },
  hooksConfig: { enabled: false },
  skills: { enabled: false },
  mcp: { allowed: [] },
  security: { disableYoloMode: true },
  context: {
    fileName: [],
    includeDirectories: [],
    memoryBoundaryMarkers: [],
    loadFromIncludeDirectories: false,
  },
  advanced: { ignoreLocalEnv: true },
  telemetry: { enabled: false },
};

export function providerEvent(
  provider: AiProviderId,
  value: unknown,
): { message: string; error?: boolean; result?: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, any>;
  if (provider === 'claude-cli') {
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
  } else {
    if (event.type === 'init')
      return { message: 'Gemini 세션을 시작했습니다.' };
    if (event.type === 'message' && event.role === 'assistant')
      return { message: String(event.content ?? '') };
    if (event.type === 'tool_use')
      return { message: `도구 실행 · ${event.tool_name ?? '파일 처리'}` };
    if (event.type === 'error')
      return {
        message: String(event.message ?? 'Gemini 실행 오류'),
        error: event.severity !== 'warning',
      };
    if (event.type === 'result')
      return {
        message:
          event.status === 'error'
            ? String(event.error?.message ?? 'Gemini 실행 실패')
            : 'Gemini 실행 완료',
        error: event.status === 'error',
        result: event.status !== 'error',
      };
  }
  return null;
}
