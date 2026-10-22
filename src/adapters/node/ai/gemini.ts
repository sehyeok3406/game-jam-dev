import { reasoningError } from '../../../core/ai/catalog.ts';
import type { AiReasoningEffort } from '../../../contracts/ai.ts';

export function geminiArguments(
  model: string | null,
  stage: string,
  _reasoningEffort?: AiReasoningEffort | null,
) {
  const choice = model ? ['--model', model] : [];

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

export function geminiEvent(
  value: unknown,
): { message: string; error?: boolean; result?: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, any>;
  if (event.type === 'init') return { message: 'Gemini 세션을 시작했습니다.' };
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

  return null;
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

export function geminiRunSettings(
  model: string | null,
  reasoningEffort?: AiReasoningEffort | null,
) {
  const error = reasoningError('gemini-cli', model, reasoningEffort);
  if (error) throw new Error(error);
  return {
    ...GEMINI_RUN_SETTINGS,
    ...(reasoningEffort
      ? {
          modelConfigs: {
            customOverrides: [
              {
                match: { model: model!.trim() },
                modelConfig: {
                  generateContentConfig: {
                    thinkingConfig: {
                      thinkingLevel: reasoningEffort.toUpperCase(),
                    },
                  },
                },
              },
            ],
          },
        }
      : {}),
  };
}
