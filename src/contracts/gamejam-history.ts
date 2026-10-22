import type { GamejamRequest } from './gamejam-request.ts';
import type { AiProviderId, AiReasoningEffort } from './ai.ts';
export type GamejamSavedRequest = {
  version: 1;
  request: GamejamRequest;
  providerId: AiProviderId;
  modelId: string;
  reasoningEffort?: AiReasoningEffort | null;
  retryOf?: string;
};
