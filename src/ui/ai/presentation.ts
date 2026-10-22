import { AI_PROVIDERS } from '../../core/ai/catalog.ts';
import type { AiProviderId } from '../../contracts/ai';

export const getAiProvider = (providerId: AiProviderId) =>
  AI_PROVIDERS.find((provider) => provider.id === providerId) ??
  AI_PROVIDERS[0];

export const getAiModelLabel = (
  providerId: AiProviderId,
  modelId: string | null,
) =>
  getAiProvider(providerId).models.find((model) => model.id === (modelId ?? ''))
    ?.label ??
  modelId ??
  '자동 선택';
