import type { AiProviderId, AiReasoningEffort } from './ai.ts';
export type DiscordApprovalStatus = {
  configured: boolean;
  connected: boolean;
  message: string;
  settings?: DiscordApprovalSettings;
  projectName?: string;
};
export type DiscordApprovalSettings = {
  channelId: string;
  userId: string;
  providerId: AiProviderId;
  modelId: string;
  reasoningEffort?: AiReasoningEffort | null;
  threads: boolean;
};
export type DiscordApprovalInput = DiscordApprovalSettings & {
  token?: string;
};
