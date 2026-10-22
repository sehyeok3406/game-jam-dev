import type { AiProviderId, AiReasoningEffort } from '../../../contracts/ai.ts';
import { reasoningError } from '../../../core/ai/catalog.ts';
import { codexArguments } from './codex.ts';
import { claudeArguments, claudeEvent } from './claude.ts';
import { geminiArguments, geminiEvent } from './gemini.ts';
export { GEMINI_RUN_SETTINGS, geminiRunSettings } from './gemini.ts';

export function aiArguments(
  provider: AiProviderId,
  model: string | null,
  stage: string,
  reasoningEffort?: AiReasoningEffort | null,
) {
  const error = reasoningError(provider, model, reasoningEffort);
  if (error) throw Error(error);
  return (
    provider === 'codex-cli'
      ? codexArguments
      : provider === 'claude-cli'
        ? claudeArguments
        : geminiArguments
  )(model, stage, reasoningEffort);
}

/** Preserve the old event API; Codex JSON events use describeCodexJsonEvent. */
export function providerEvent(provider: AiProviderId, value: unknown) {
  return (provider === 'claude-cli' ? claudeEvent : geminiEvent)(value);
}
