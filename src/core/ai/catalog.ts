import type { AiProviderId, AiReasoningEffort } from '../../contracts/ai.ts';

type AiModel = {
  id: string;
  label: string;
  reasoning?: readonly AiReasoningEffort[];
};
const standard = ['low', 'medium', 'high'] as const;
const deep = [...standard, 'xhigh', 'max'] as const;
const ultra = [...deep, 'ultra'] as const;

// Official client capabilities, not account entitlements. Unknown models and
// moving aliases keep their CLI defaults instead of guessing supported levels.
// Sources: learn.chatgpt.com/docs/models, code.claude.com/docs/en/model-config,
// geminicli.com/docs/reference/configuration, ai.google.dev/gemini-api/docs/thinking.
// Reviewed 2026-10-20. Keep this table shared by UI and execution validation.
export const AI_REASONING_LABELS: Record<AiReasoningEffort, string> = {
  minimal: '최소',
  low: '낮음',
  medium: '보통',
  high: '높음',
  xhigh: '매우 높음',
  max: '최대',
  ultra: 'Ultra · 병렬 에이전트',
};

export function reasoningLabel(value?: AiReasoningEffort | null) {
  return value ? `${AI_REASONING_LABELS[value]} (${value})` : '기본값';
}

export const AI_PROVIDERS: {
  id: AiProviderId;
  label: string;
  description: string;
  install: string;
  login: string;
  models: AiModel[];
}[] = [
  {
    id: 'codex-cli' as AiProviderId,
    label: 'GPT · Codex',
    description: '이 PC의 Codex CLI 로그인으로 실행합니다.',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
    models: [
      { id: '', label: '자동 선택' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', reasoning: ultra },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', reasoning: ultra },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol', reasoning: ultra },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', reasoning: deep },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', reasoning: ultra },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', reasoning: ultra },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', reasoning: deep },
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
      { id: 'claude-fable-5-1', label: 'Fable 5.1', reasoning: deep },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', reasoning: deep },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', reasoning: deep },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5', reasoning: deep },
      { id: 'fable', label: 'Fable (CLI 별칭)' },
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
    models: [
      { id: '', label: '자동 선택' },
      {
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro Preview',
        reasoning: standard,
      },
      {
        id: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        reasoning: standard,
      },
      {
        id: 'gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        reasoning: ['minimal', ...standard],
      },
      {
        id: 'gemini-3.5-flash-lite',
        label: 'Gemini 3.5 Flash-Lite',
        reasoning: ['minimal', ...standard],
      },
      {
        id: 'gemini-3.1-flash-lite',
        label: 'Gemini 3.1 Flash-Lite',
        reasoning: ['minimal', ...standard],
      },
      {
        id: 'gemini-3-pro-preview',
        label: 'Gemini 3 Pro Preview',
        reasoning: ['low', 'high'],
      },
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash Preview',
        reasoning: ['minimal', ...standard],
      },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
  },
  {
    id: 'grok-cli',
    label: 'Grok · Grok Build',
    description: '이 PC의 Grok Build CLI 인증으로 실행합니다.',
    install: 'npm install -g @xai-official/grok',
    login: 'grok login (또는 XAI_API_KEY 환경 변수)',
    models: [{ id: '', label: '자동 선택 · Grok Build' }],
  },
];

/** Older servers advertised a boolean before provider IDs were negotiated. */
export function supportsSharedAiProvider(
  state: { multiProviderAi?: boolean; supportedAiProviders?: AiProviderId[] },
  provider: AiProviderId,
) {
  if (Array.isArray(state.supportedAiProviders))
    return state.supportedAiProviders.includes(provider);
  return (
    provider === 'codex-cli' ||
    (!!state.multiProviderAi &&
      (provider === 'claude-cli' || provider === 'gemini-cli'))
  );
}

export function isAiProvider(value: unknown): value is AiProviderId {
  return AI_PROVIDERS.some((provider) => provider.id === value);
}
export function aiProvider(value: AiProviderId) {
  return (
    AI_PROVIDERS.find((provider) => provider.id === value) ?? AI_PROVIDERS[0]
  );
}
export function reasoningOptions(
  provider: AiProviderId,
  model?: string | null,
) {
  return (
    aiProvider(provider).models.find((entry) => entry.id === model?.trim())
      ?.reasoning ?? []
  );
}

export function isReasoningEffort(value: unknown): value is AiReasoningEffort {
  return typeof value === 'string' && Object.hasOwn(AI_REASONING_LABELS, value);
}

export function reasoningError(
  provider: AiProviderId,
  model: string | null | undefined,
  value: unknown,
): string | null {
  if (value === undefined || value === null) return null;
  if (
    !isReasoningEffort(value) ||
    !reasoningOptions(provider, model).includes(value)
  )
    return '선택한 모델에서 지원하지 않는 추론 수준입니다. 모델과 추론 수준을 다시 선택해주세요.';
  return null;
}
