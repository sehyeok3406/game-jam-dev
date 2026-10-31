import type { AiProviderId, AiReasoningEffort } from '../../../contracts/ai.ts';
import { reasoningError } from '../../../core/ai/catalog.ts';
import { codexArguments } from './codex.ts';
import { claudeArguments, claudeEvent } from './claude.ts';
import { geminiArguments, geminiEvent } from './gemini.ts';
import { grokArguments, grokEvent } from './grok.ts';
export { GEMINI_RUN_SETTINGS, geminiRunSettings } from './gemini.ts';

export function aiArguments(
  provider: AiProviderId,
  model: string | null,
  stage: string,
  reasoningEffort?: AiReasoningEffort | null,
) {
  const error = reasoningError(provider, model, reasoningEffort);
  if (error) throw Error(error);
  switch (provider) {
    case 'codex-cli':
      return codexArguments(model, stage, reasoningEffort);
    case 'claude-cli':
      return claudeArguments(model, stage, reasoningEffort);
    case 'gemini-cli':
      return geminiArguments(model, stage, reasoningEffort);
    case 'grok-cli':
      return grokArguments(model, stage, reasoningEffort);
    default:
      throw Error('지원하지 않는 AI 제공자입니다.');
  }
}

/** Preserve the old event API; Codex JSON events use describeCodexJsonEvent. */
export function providerEvent(provider: AiProviderId, value: unknown) {
  switch (provider) {
    case 'claude-cli':
      return claudeEvent(value);
    case 'gemini-cli':
      return geminiEvent(value);
    case 'grok-cli':
      return grokEvent(value);
    default:
      return null;
  }
}
