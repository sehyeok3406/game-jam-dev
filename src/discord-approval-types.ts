import type { AiProviderId } from './shared.ts';

export type DiscordApprovalSettings = {
  channelId: string;
  userId: string;
  providerId: AiProviderId;
  modelId: string;
  threads: boolean;
};
export type DiscordApprovalInput = DiscordApprovalSettings & { token?: string };
export type DiscordApprovalStatus = {
  configured: boolean;
  connected: boolean;
  message: string;
  settings?: DiscordApprovalSettings;
  projectName?: string;
};
export type DiscordProjectBinding = {
  serverUrl: string;
  projectId: string;
  memberId: string;
  projectName: string;
};
