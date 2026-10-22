export type { DiscordApprovalStatus } from './contracts/discord-approval-types.ts';
export type { DiscordApprovalSettings } from './contracts/discord-approval-types.ts';
export type { DiscordApprovalInput } from './contracts/discord-approval-types.ts';

export type DiscordProjectBinding = {
  serverUrl: string;
  projectId: string;
  memberId: string;
  projectName: string;
};
